import path from "node:path";
import type { Locator, Page, Response } from "playwright";
import {
  resolveVariables,
  type ApiExpectedValue,
  type ApiResponseDiagnostic,
  type LocationDefinition,
  type LocationMap,
  type ScenarioSession,
  type ScenarioStep,
  type SessionName,
  type StepResult
} from "@ai-e2e/shared";
import type { RuntimeContext } from "../context/runtime-context";
import type { RunLogger } from "../utils/logger";
import { buildLoginStillPendingMessage, isLoginUrl } from "./login-result";
import { createLocatorPlans, type LocatorPlan } from "./locator-candidates";
import type { VisualExecutor } from "./visual-executor";
import { resolveUploadFilePath } from "../utils/upload-file";
import { navigatePage, splitHashUrl } from "../utils/hash-navigation";
import { buildInputValueDiagnostic, type InputValueDiagnostic, type TrackedInput } from "./action-diagnostics";

export class WebExecutor {
  private readonly recordedPages = new WeakSet<Page>();
  private readonly pageDiagnostics = new WeakMap<Page, ApiResponseDiagnostic[]>();
  private readonly pageActionDiagnostics = new WeakMap<Page, InputValueDiagnostic[]>();
  private readonly pageTrackedInputs = new WeakMap<Page, TrackedInput[]>();

  constructor(
    private readonly input: {
      rootDir: string;
      locations: LocationMap;
      context: RuntimeContext;
      logger: RunLogger;
      visual: VisualExecutor;
      screenshotDir: string;
      defaults?: {
        step_timeout_ms?: number;
        wait_for_network?: boolean;
      };
      getPage?: (session: SessionName) => Promise<Page>;
      newPage?: (session: SessionName) => Promise<Page>;
    }
  ) {}

  async execute(page: Page, step: ScenarioStep): Promise<Partial<StepResult>> {
    this.ensureNetworkRecorder(page);
    await this.input.visual.ensure(page);
    await this.input.visual.updateStep(page, step, "running");
    await this.input.logger.info(`开始执行步骤：${step.step_id}`, { step });

    switch (step.type) {
      case "web_open":
        return this.withApiWait(page, step, async () => {
          await this.openPage(page, step);
        }, async () => {
          await this.waitForNetworkIfNeeded(page, step);
          return { message: `已打开 ${this.resolve(step.url)}` };
        });
      case "web_reload":
        return this.withApiWait(page, step, async () => {
          await page.reload({ waitUntil: "domcontentloaded" });
        }, async () => {
          await this.waitForNetworkIfNeeded(page, step);
          return { message: "页面已刷新" };
        });
      case "web_click":
        return this.withApiWait(page, step, async () => {
          await this.click(page, step);
        }, async () => {
          await this.waitForNetworkIfNeeded(page, step);
          return { message: "点击完成" };
        });
      case "web_input":
        await this.inputText(page, step);
        return { message: "输入完成" };
      case "web_select":
        await this.selectOption(page, step);
        return { message: "选择完成" };
      case "web_upload":
        return this.withApiWait(page, step, async () => {
          await this.upload(page, step);
        }, async () => ({ message: "上传完成" }));
      case "web_wait_text":
        await (await this.locator(page, step)).filter({ hasText: this.resolve(this.stringField(step.expected, "expected")) }).waitFor({ timeout: this.timeoutMs(step) });
        return { message: `已等待文本：${this.resolve(this.stringField(step.expected, "expected"))}` };
      case "web_wait_element":
        await (await this.locator(page, step)).waitFor({ state: "visible", timeout: this.timeoutMs(step) });
        return { message: "元素已出现" };
      case "web_assert_text":
        await this.assertText(page, step);
        return { message: "文本断言通过" };
      case "web_assert_visible": {
        const locator = await this.locator(page, step);
        await locator.waitFor({ state: "visible", timeout: this.timeoutMs(step) });
        await this.input.visual.highlight(page, locator, "passed");
        return { message: "可见性断言通过" };
      }
      case "web_assert_url":
        await page.waitForURL(new RegExp(this.resolve(this.stringField(step.expected, "expected"))), { timeout: this.timeoutMs(step) });
        return { message: "URL 断言通过" };
      case "web_extract":
        await this.extract(page, step);
        return { message: `已提取变量：${step.variable}` };
      case "web_screenshot":
        return { screenshot: await this.screenshot(page, step.step_id), message: "截图完成" };
      case "flow_login":
        await this.flowLogin(page, step);
        return { message: "登录流程已提交" };
      case "flow_submit_kyc":
        await this.flowSubmitKyc(page, step);
        return { message: "KYC 提交流程已提交" };
      case "flow_admin_approve_kyc":
        await this.flowAdminApproveKyc(page, step);
        return { message: "KYC 审核流程已提交" };
      default:
        throw new Error(`P0 暂不支持步骤类型：${step.type}`);
    }
  }

  async captureFailure(page: Page, stepId: string): Promise<Partial<StepResult>> {
    const screenshot = await this.screenshot(page, `${stepId}-failed`);
    const diagnostics = this.pageDiagnostics.get(page)?.slice(-10);
    const actionDiagnostics = this.pageActionDiagnostics.get(page)?.slice(-20);
    if (diagnostics?.length) {
      await this.input.logger.error("失败时捕获到最近异常接口响应", { stepId, apiResponses: diagnostics });
    }
    return {
      screenshot,
      url: page.url(),
      title: await page.title().catch(() => ""),
      data: diagnostics?.length || actionDiagnostics?.length
        ? {
          diagnostics: {
            ...(diagnostics?.length ? { recentApiResponses: diagnostics } : {}),
            ...(actionDiagnostics?.length ? { recentActionDiagnostics: actionDiagnostics } : {})
          }
        }
        : undefined
    };
  }

  private async withApiWait(
    page: Page,
    step: ScenarioStep,
    action: () => Promise<void>,
    afterAction: () => Promise<Partial<StepResult>>
  ): Promise<Partial<StepResult>> {
    const diagnosticStart = this.pageDiagnostics.get(page)?.length ?? 0;
    const apiWait = this.createApiWait(page, step);
    await action();
    let cancelFailureWait = false;
    const failureWait = this.waitForStepApiFailure(page, step, diagnosticStart, () => cancelFailureWait);
    try {
      const partial = await Promise.race([afterAction(), failureWait]);
      if (!apiWait) {
        return partial;
      }

      const api = await Promise.race([apiWait, failureWait]);
      await this.input.logger.info("已捕获步骤关联接口返回", { stepId: step.step_id, api });
      this.assertApiResponse(step, api);
      return { ...partial, data: { ...(isRecord(partial.data) ? partial.data : {}), api } };
    } finally {
      cancelFailureWait = true;
    }
  }

  private createApiWait(page: Page, step: ScenarioStep): Promise<ApiResponseDiagnostic> | undefined {
    if (!step.wait_for_api) {
      return undefined;
    }

    const config = step.wait_for_api;
    const expectedUrl = this.resolve(config.url);
    const expectedMethod = config.method?.toUpperCase();
    const timeout = config.timeout_ms ?? this.timeoutMs(step);

    return page
      .waitForResponse((response) => {
        const request = response.request();
        return response.url().includes(expectedUrl) && (!expectedMethod || request.method().toUpperCase() === expectedMethod);
      }, { timeout })
      .then((response) => this.readApiResponse(response));
  }

  private assertApiResponse(step: ScenarioStep, api: ApiResponseDiagnostic): void {
    const config = step.wait_for_api;
    if (!config) {
      return;
    }
    const expectedStatus = config.expected_status ?? 200;
    if (api.status !== expectedStatus) {
      throw apiAssertionError(`接口返回状态不符合预期：${api.method} ${api.url}，期望 HTTP ${expectedStatus}，实际 HTTP ${api.status}，响应：${api.bodyText ?? "-"}`, api);
    }
    const businessCode = readConfiguredBusinessCode(api.bodyJson, config.business_code_path);
    if (businessCode !== undefined) {
      const failureCodes = config.failure_codes ?? apiBusinessConfig().failureCodes;
      if (failureCodes.some((code) => isExpectedApiValue(businessCode, code))) {
        throw apiAssertionError(`接口业务码为失败：${config.business_code_path ?? apiBusinessConfig().codePaths.join("|")}=${String(businessCode)}，响应：${api.bodyText ?? "-"}`, api);
      }

      const successCodes = config.success_codes;
      if (successCodes?.length && !successCodes.some((code) => isExpectedApiValue(businessCode, code))) {
        throw apiAssertionError(`接口业务码不符合预期：${config.business_code_path ?? apiBusinessConfig().codePaths.join("|")} 期望 ${successCodes.join("/")}，实际 ${String(businessCode)}，响应：${api.bodyText ?? "-"}`, api);
      }
    }
    if (!config.success) {
      return;
    }
    const bodyValue = config.success.body_path ? readPath(api.bodyJson, config.success.body_path) : api.bodyJson ?? api.bodyText;
    if ("equals" in config.success && !isExpectedApiValue(bodyValue, config.success.equals)) {
      throw apiAssertionError(`接口业务结果不符合预期：${config.success.body_path ?? "body"} 期望 ${String(config.success.equals)}，实际 ${String(bodyValue)}，响应：${api.bodyText ?? "-"}`, api);
    }
    if (config.success.includes && !String(bodyValue ?? "").includes(config.success.includes)) {
      throw apiAssertionError(`接口业务结果不包含预期内容：${config.success.body_path ?? "body"} 未包含 ${config.success.includes}，响应：${api.bodyText ?? "-"}`, api);
    }
  }

  private ensureNetworkRecorder(page: Page): void {
    if (this.recordedPages.has(page)) {
      return;
    }
    this.recordedPages.add(page);
    this.pageDiagnostics.set(page, []);

    page.on("response", (response) => {
      const request = response.request();
      const resourceType = request.resourceType();
      if (!["fetch", "xhr", "document"].includes(resourceType) || (response.status() < 400 && request.method().toUpperCase() === "GET")) {
        return;
      }
      void this.readApiResponse(response).then(async (api) => {
        if (!api.failed) {
          return;
        }
        this.pushDiagnostic(page, api);
        await this.input.logger.error("捕获到异常接口响应", { api });
      }).catch(() => undefined);
    });

    page.on("requestfailed", (request) => {
      const api: ApiResponseDiagnostic = {
        url: request.url(),
        method: request.method(),
        status: 0,
        statusText: request.failure()?.errorText ?? "request failed",
        ok: false,
        matchedAt: new Date().toISOString()
      };
      this.pushDiagnostic(page, api);
      void this.input.logger.error("捕获到接口请求失败", { api });
    });
  }

  private pushDiagnostic(page: Page, api: ApiResponseDiagnostic): void {
    const diagnostics = this.pageDiagnostics.get(page) ?? [];
    diagnostics.push(api);
    this.pageDiagnostics.set(page, diagnostics.slice(-20));
  }

  private findStepApiFailure(page: Page, startIndex: number): ApiResponseDiagnostic | undefined {
    const diagnostics = this.pageDiagnostics.get(page) ?? [];
    return diagnostics.slice(startIndex).find((api) => api.failed);
  }

  private async waitForStepApiFailure(page: Page, step: ScenarioStep, startIndex: number, isCanceled: () => boolean): Promise<never> {
    const timeout = step.wait_for_api?.timeout_ms ?? this.timeoutMs(step);
    const startedAt = Date.now();
    while (!isCanceled() && Date.now() - startedAt < timeout) {
      const failure = this.findStepApiFailure(page, startIndex);
      if (failure) {
        await this.input.logger.error("步骤触发接口业务失败", { stepId: step.step_id, api: failure });
        throw apiAssertionError(`步骤触发接口业务失败：${failure.method} ${failure.url}，${failure.failureReason ?? "后端返回失败"}，响应：${failure.bodyText ?? "-"}`, failure);
      }
      await page.waitForTimeout(100).catch(() => undefined);
    }
    return new Promise<never>(() => undefined);
  }

  private async readApiResponse(response: Response): Promise<ApiResponseDiagnostic> {
    const contentType = response.headers()["content-type"];
    const rawPostData = response.request().postData() ?? "";
    const requestPostData = rawPostData ? redactSensitiveText(truncateText(rawPostData, 20_000)) : undefined;
    const rawText = await response.text().catch(() => "");
    const bodyText = redactSensitiveText(truncateText(rawText, 20_000));
    const bodyJson = parseJson(bodyText);
    const businessFailure = detectBusinessFailure(bodyJson, bodyText);
    return {
      url: response.url(),
      method: response.request().method(),
      status: response.status(),
      statusText: response.statusText(),
      ok: response.ok(),
      failed: !response.ok() || businessFailure.failed,
      failureReason: !response.ok() ? `HTTP ${response.status()}` : businessFailure.reason,
      contentType,
      requestPostData,
      requestJson: requestPostData ? parseJson(requestPostData) : undefined,
      bodyText,
      bodyJson,
      matchedAt: new Date().toISOString()
    };
  }

  private async flowLogin(page: Page, step: ScenarioStep): Promise<void> {
    this.ensureNetworkRecorder(page);
    const prefix = step.session === "admin" ? "admin_login" : "user_login";
    const session = step.session ? this.input.context.state.sessions[step.session] : undefined;
    const username = step.username ?? session?.username;
    const password = step.password ?? session?.password;
    const diagnostics = this.collectLoginDiagnostics(page);
    try {
      const usernameStep = { ...step, target: `${prefix}_username`, value: this.resolve(username) };
      const usernameLocator = await this.locator(page, usernameStep);
      await this.input.visual.highlight(page, usernameLocator);
      await usernameLocator.fill(this.resolve(username), { timeout: this.timeoutMs(step) });
      this.recordInputDiagnostic(page, buildInputValueDiagnostic({
        phase: "after_input",
        stepId: step.step_id,
        stepName: step.name,
        stepType: step.type,
        target: usernameStep.target,
        expectedValue: this.resolve(username),
        actualValue: await readLocatorValue(usernameLocator)
      }));
      this.trackInput(page, { step: usernameStep, expectedValue: this.resolve(username) });
      await this.inputText(page, { ...step, target: `${prefix}_password`, value: this.resolve(password) });
      await this.click(page, { ...step, target: `${prefix}_submit` });
      await this.completeOptionalDeviceVerification(page, step);
      await this.waitForLoginCompleted(page, usernameLocator, step, diagnostics);
    } finally {
      diagnostics.dispose();
    }
  }

  private async completeOptionalDeviceVerification(page: Page, step: ScenarioStep): Promise<void> {
    if (step.session !== "user") {
      return;
    }

    const dialogTitle = page.getByText("设备二次验证", { exact: true });
    const hasVerificationDialog = await dialogTitle.waitFor({ state: "visible", timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (!hasVerificationDialog) {
      return;
    }

    await this.input.logger.info("检测到 user 设备二次验证，准备从 admin 短信记录获取验证码");
    const emailRadio = page.getByRole("radio", { name: "邮箱验证码" });
    if (await emailRadio.isVisible().catch(() => false)) {
      await emailRadio.click({ timeout: 3_000 }).catch(() => undefined);
    }
    await page.getByRole("button", { name: "获取验证码" }).click({ timeout: 10_000 });
    await page.waitForTimeout(8_000);

    const filterTarget = this.resolve(String(step.username ?? ""))
      || (this.input.context.state.sessions.user as ScenarioSession | undefined)?.username
      || "";
    const code = await this.fetchLatestAdminMessageVerificationCode(filterTarget);
    await page.bringToFront().catch(() => undefined);
    const codeInput = page.getByPlaceholder("请输入验证码").first();
    await this.input.visual.highlight(page, codeInput);
    await codeInput.fill(code, { timeout: 10_000 });

    await page.getByText(/信任\s*30\s*天/).click({ timeout: 2_000 }).catch(() => undefined);
    const verifyButton = page.getByRole("button", { name: "立即验证" });
    await this.input.visual.highlight(page, verifyButton);
    await verifyButton.click({ timeout: 10_000 });
  }

  private adminSmsLogUrl(adminLoginUrl: string): string {
    const { pageUrl } = splitHashUrl(adminLoginUrl);
    return `${pageUrl}#/admin/sys/log?activeName=sms-record`;
  }

  private parseVerificationCodeFromText(text: string): string | undefined {
    const patterns = [
      /(?:验证码|校验码)\s*(?:是|为)?\s*[:：]?\s*(\d{4,8})/,
      /(?:验证码|校验码)[:：\s]*(\d{4,8})/
    ];
    for (const pattern of patterns) {
      const matched = text.match(pattern);
      if (!matched?.[1]) {
        continue;
      }
      if (/^20\d{4}$/.test(matched[1])) {
        continue;
      }
      return matched[1];
    }
    return undefined;
  }

  private normalizeSmsMatchTarget(value?: string): string {
    return (value ?? "").replace(/\s+/g, "").toLowerCase();
  }

  private digitsOnly(value?: string): string {
    return (value ?? "").replace(/\D+/g, "");
  }

  private smsTargetMatches(filterTarget?: string, rowTarget?: string): boolean {
    const normalizedFilter = this.normalizeSmsMatchTarget(filterTarget);
    const normalizedRowTarget = this.normalizeSmsMatchTarget(rowTarget);
    if (!normalizedFilter || !normalizedRowTarget) {
      return false;
    }
    if (normalizedRowTarget.includes(normalizedFilter) || normalizedFilter.includes(normalizedRowTarget)) {
      return true;
    }
    const filterDigits = this.digitsOnly(filterTarget);
    const rowDigits = this.digitsOnly(rowTarget);
    if (!filterDigits || !rowDigits) {
      return false;
    }
    return rowDigits.includes(filterDigits) || filterDigits.includes(rowDigits);
  }

  private resolveAdminSmsFilterTarget(step?: ScenarioStep): string {
    const explicit = step?.filter_target?.trim();
    if (explicit && !/\$\{[^}]+\}/.test(explicit)) {
      return this.resolve(explicit);
    }
    return this.input.context.getVariable("phone")
      ?? this.input.context.getVariable("email")
      ?? "";
  }

  private async scanAdminSmsForVerificationCode(adminPage: Page, filterTarget?: string): Promise<string> {
    const rows = adminPage.locator(".el-table__body-wrapper tbody tr.el-table__row");
    const count = await rows.count().catch(() => 0);
    const normalizedFilter = this.normalizeSmsMatchTarget(filterTarget);
    let fallbackCode: string | undefined;

    for (let index = 0; index < Math.min(count, 20); index += 1) {
      const row = rows.nth(index);
      const targetNo = ((await row.locator("td").first().textContent()) ?? "").trim();
      const content = ((await row.locator("td:nth-child(5)").textContent()) ?? "").trim();
      const rowText = ((await row.textContent()) ?? "").trim();
      const code = this.parseVerificationCodeFromText(content);
      if (!code) {
        continue;
      }
      if (!normalizedFilter) {
        return code;
      }
      if (this.smsTargetMatches(filterTarget, `${targetNo} ${content} ${rowText}`)) {
        return code;
      }
      fallbackCode ??= code;
    }

    if (!normalizedFilter && fallbackCode) {
      return fallbackCode;
    }

    const latestContent = ((await adminPage.locator(".el-table__body-wrapper tbody tr.el-table__row:first-child td:nth-child(5)").first().textContent()) ?? "").trim();
    throw new Error(`admin 短信记录未找到验证码${filterTarget ? `（目标：${filterTarget}）` : ""}，最新内容：${latestContent}`);
  }

  private async fetchLatestAdminMessageVerificationCode(filterTarget?: string): Promise<string> {
    if (!this.input.getPage) {
      throw new Error("user 二次验证需要 admin 会话，但当前执行器未提供会话访问能力");
    }

    const adminSession = this.input.context.state.sessions.admin as ScenarioSession | undefined;
    if (!adminSession?.login_url || !adminSession.username || !adminSession.password) {
      throw new Error("user 二次验证需要配置 admin session 的登录地址、账号和密码");
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const adminPage = await this.openAdminVerificationPage();
        await navigatePage(adminPage, this.adminSmsLogUrl(adminSession.login_url), 15_000);
        await adminPage.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);

        if (await this.isAdminLoginPage(adminPage)) {
          await this.performAdminLogin(adminPage, adminSession);
          await navigatePage(adminPage, this.adminSmsLogUrl(adminSession.login_url), 15_000);
          await adminPage.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
        }

        if (attempt > 1) {
          await adminPage.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
          await adminPage.waitForTimeout(4_000);
        }

        await adminPage.locator(".el-table__body-wrapper tbody tr.el-table__row").first()
          .waitFor({ state: "visible", timeout: 10_000 })
          .catch(() => undefined);

        const code = await this.scanAdminSmsForVerificationCode(adminPage, filterTarget);
        await this.input.logger.info("已从 admin 短信记录获取 user 二次验证验证码");
        return code;
      } catch (error) {
        if (attempt < 3 && isTargetClosedError(error)) {
          await this.input.logger.info("admin 会话页面已关闭，重新打开页面后重试获取验证码");
          continue;
        }
        if (attempt < 3) {
          await this.input.logger.info(`admin 短信记录第 ${attempt} 次取码失败，刷新后重试`);
          continue;
        }
        throw error;
      }
    }

    throw new Error("admin 短信记录获取验证码失败");
  }

  private async openAdminVerificationPage(): Promise<Page> {
    if (this.input.getPage) {
      return await this.input.getPage("admin");
    }
    if (this.input.newPage) {
      return await this.input.newPage("admin");
    }
    throw new Error("user 二次验证需要 admin 会话，但当前执行器未提供会话访问能力");
  }

  private async isAdminLoginPage(page: Page): Promise<boolean> {
    if (page.url() === "about:blank" || isLoginUrl(page.url())) {
      return true;
    }

    const usernameField = page.locator('input[name="username"], [placeholder*="手机号或邮箱"], [placeholder*="账号"]').first();
    const passwordField = page.locator('input[type="password"], [placeholder*="密码"]').first();
    const [usernameVisible, passwordVisible] = await Promise.all([
      usernameField.isVisible().catch(() => false),
      passwordField.isVisible().catch(() => false)
    ]);
    return usernameVisible && passwordVisible;
  }

  private async performAdminLogin(page: Page, adminSession: ScenarioSession): Promise<void> {
    await navigatePage(page, adminSession.login_url, 15_000);
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);

    const usernameStep = { type: "flow_login", target: "admin_login_username", value: adminSession.username } as ScenarioStep;
    const usernameLocator = await this.locator(page, usernameStep);
    await usernameLocator.waitFor({ state: "visible", timeout: 15_000 });
    await this.input.visual.highlight(page, usernameLocator);
    await usernameLocator.fill(adminSession.username ?? "", { timeout: 15_000 });
    this.recordInputDiagnostic(page, buildInputValueDiagnostic({
      phase: "after_input",
      stepId: usernameStep.step_id,
      stepName: usernameStep.name,
      stepType: usernameStep.type,
      target: usernameStep.target,
      expectedValue: adminSession.username ?? "",
      actualValue: await readLocatorValue(usernameLocator)
    }));
    this.trackInput(page, { step: usernameStep, expectedValue: adminSession.username ?? "" });
    await this.inputText(page, { type: "flow_login", target: "admin_login_password", value: adminSession.password } as ScenarioStep);
    await this.click(page, { type: "flow_login", target: "admin_login_submit" } as ScenarioStep);

    await Promise.race([
      page.waitForURL((url) => !isLoginUrl(url.toString()), { timeout: 20_000 }),
      usernameLocator.waitFor({ state: "hidden", timeout: 20_000 })
    ]).catch(() => undefined);
  }

  private async ensureAdminLoggedIn(page: Page, adminSession: ScenarioSession): Promise<void> {
    if (!(await this.isAdminLoginPage(page))) {
      return;
    }
    await this.performAdminLogin(page, adminSession);
  }

  private async extractVerificationCode(page: Page): Promise<string> {
    const codePattern = /验证码[:：]\s*(\d{4,8})/;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const text = await page.locator("body").innerText({ timeout: 10_000 });
      const match = text.match(codePattern);
      if (match?.[1]) {
        return match[1];
      }
      await page.waitForTimeout(1_000);
    }
    throw new Error("admin 消息中心未找到邮箱验证码");
  }

  private async flowSubmitKyc(page: Page, step: ScenarioStep): Promise<void> {
    const { runKycSubmitFlow } = await import("./kyc-flow");
    await runKycSubmitFlow(page, step, {
      rootDir: this.input.rootDir,
      locations: this.input.locations,
      scenario: this.input.context.state.scenario,
      resolve: (value) => this.resolve(value),
      timeoutMs: (currentStep) => this.timeoutMs(currentStep),
      click: (currentPage, currentStep) => this.click(currentPage, currentStep),
      inputText: (currentPage, currentStep) => this.inputText(currentPage, currentStep),
      upload: (currentPage, currentStep) => this.upload(currentPage, currentStep),
      optionalInput: (currentPage, base, target, value) => this.optionalInput(currentPage, base, target, value),
      optionalUpload: (currentPage, base, target, value) => this.optionalUpload(currentPage, base, target, value),
      optionalClick: (currentPage, base, target) => this.optionalClick(currentPage, base, target)
    });
  }

  private async flowAdminApproveKyc(page: Page, step: ScenarioStep): Promise<void> {
    await this.optionalInput(page, step, "admin_kyc_search_input", "${var.enterprise_name}");
    await this.optionalClick(page, step, "admin_kyc_search_submit");
    await this.optionalClick(page, step, "admin_kyc_review_button");
    await this.optionalInput(page, step, "admin_kyc_review_remark", "${var.review_remark}");
    await this.click(page, { ...step, target: "admin_kyc_approve_button" });
    await this.optionalClick(page, step, "admin_kyc_confirm");
  }

  private async inputText(page: Page, step: ScenarioStep): Promise<void> {
    const expectedValue = this.resolve(step.value);
    if (step.target === "register_input_phone") {
      await this.inputRegisterPhoneNumber(page, step, expectedValue);
      return;
    }

    const locator = await this.locator(page, step);
    await this.input.visual.highlight(page, locator);
    await locator.fill(expectedValue, { timeout: this.timeoutMs(step) });
    const actualValue = await readLocatorValue(locator);
    this.recordInputDiagnostic(page, buildInputValueDiagnostic({
      phase: "after_input",
      stepId: step.step_id,
      stepName: step.name,
      stepType: step.type,
      target: step.target,
      expectedValue,
      actualValue
    }));
    this.trackInput(page, { step, expectedValue });
  }

  private async selectOption(page: Page, step: ScenarioStep): Promise<void> {
    const locator = await this.locator(page, step);
    await this.input.visual.highlight(page, locator);
    await locator.selectOption(this.resolve(step.value), { timeout: this.timeoutMs(step) });
  }

  private async click(page: Page, step: ScenarioStep): Promise<void> {
    await this.recordTrackedInputsBeforeClick(page, step);
    if (step.target === "register_agree_checkbox") {
      await this.checkRegisterAgreeCheckbox(page, step);
      return;
    }

    const locator = await this.locator(page, step);
    await this.input.visual.highlight(page, locator);
    await this.input.visual.clickRipple(page, locator);
    await locator.click({ timeout: this.timeoutMs(step) });
  }

  private async inputRegisterPhoneNumber(page: Page, step: ScenarioStep, expectedValue: string): Promise<void> {
    const phoneInput = await this.locator(page, step);
    await this.input.visual.highlight(page, phoneInput);
    await phoneInput.click({ timeout: this.timeoutMs(step) });
    await phoneInput.fill("", { timeout: this.timeoutMs(step) });
    await phoneInput.pressSequentially(expectedValue, { delay: 40 });
    await phoneInput.evaluate((element, value) => {
      if (!(element instanceof HTMLInputElement)) {
        return;
      }
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, expectedValue);
    await phoneInput.press("Tab");
    await phoneInput.evaluate((element) => {
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.blur();
    });
    await page.waitForTimeout(400);

    const actualValue = await readLocatorValue(phoneInput);
    this.recordInputDiagnostic(page, buildInputValueDiagnostic({
      phase: "after_input",
      stepId: step.step_id,
      stepName: step.name,
      stepType: step.type,
      target: step.target,
      expectedValue,
      actualValue
    }));
    this.trackInput(page, { step, expectedValue });
  }

  private async checkRegisterAgreeCheckbox(page: Page, step: ScenarioStep): Promise<void> {
    const anchor = page.locator("[data-testid='register-agree-checkbox']").first();
    await anchor.waitFor({ state: "attached", timeout: this.timeoutMs(step) });
    await anchor.scrollIntoViewIfNeeded({ timeout: this.timeoutMs(step) });
    await this.input.visual.highlight(page, anchor);

    const checkboxInput = anchor.locator("input[type='checkbox'], .el-checkbox__original").first();
    const checked = await checkboxInput.isChecked().catch(() => false);
    if (checked) {
      return;
    }

    const visibleTarget = anchor.locator(".el-checkbox__input, .el-checkbox__inner, .el-checkbox__label").first();
    await visibleTarget.click({ force: true, timeout: this.timeoutMs(step) }).catch(async () => {
      await checkboxInput.evaluate((element: HTMLInputElement) => {
        element.click();
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });

    const checkedAfterClick = await checkboxInput.isChecked().catch(() => false);
    if (!checkedAfterClick) {
      await checkboxInput.evaluate((element: HTMLInputElement) => {
        element.checked = true;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
  }

  private async upload(page: Page, step: ScenarioStep): Promise<void> {
    const locator = await this.uploadLocator(page, step);
    await this.input.visual.highlight(page, locator).catch(() => undefined);
    const filePath = resolveUploadFilePath(this.input.rootDir, this.resolve(step.file));
    await locator.setInputFiles(filePath, { timeout: this.timeoutMs(step) });
  }

  private async assertText(page: Page, step: ScenarioStep): Promise<void> {
    const locator = await this.locator(page, step);
    await this.input.visual.highlight(page, locator);
    const expected = this.resolve(this.stringField(step.expected, "expected"));
    const text = (await locator.textContent({ timeout: this.timeoutMs(step) })) ?? "";
    if (!text.includes(expected)) {
      await this.input.visual.highlight(page, locator, "failed");
      throw new Error(`文本断言失败：期望包含「${expected}」，实际为「${text.trim()}」`);
    }
    await this.input.visual.highlight(page, locator, "passed");
  }

  private async extract(page: Page, step: ScenarioStep): Promise<void> {
    const variableName = step.variable ?? step.save_as;
    if (!variableName) {
      throw new Error("web_extract 必须指定 variable 或 save_as");
    }

    let value: string;
    if (step.target === "admin_message_content") {
      const filterTarget = this.resolveAdminSmsFilterTarget(step);
      value = await this.scanAdminSmsForVerificationCode(page, filterTarget);
    } else {
      value = ((await (await this.locator(page, step)).textContent({ timeout: this.timeoutMs(step) })) ?? "").trim();
      const extractConfig = step.extract;
      const pattern = extractConfig?.pattern;
      if (pattern) {
        const matched = value.match(new RegExp(pattern));
        if (!matched) {
          throw new Error(`提取失败：文本「${value}」未匹配 pattern ${pattern}`);
        }
        const groupIndex = extractConfig?.group ?? (matched.length > 1 ? 1 : 0);
        value = matched[groupIndex] ?? matched[0] ?? "";
      }
    }

    this.input.context.setVariable(this.resolve(variableName), value);
  }

  private static readonly REGISTER_PHONE_INPUT_SELECTOR = [
    "[data-testid='register-input-phone'] .m-input-phone-number__phone-input input",
    "[data-testid='register-input-phone'] input[name='phone']:not([readonly])",
    ".phone-item .m-input-phone-number__phone-input input",
    ".MazPhoneInputStyle .m-input-phone-number__phone-input input",
    "input[name='phone']:not([readonly])"
  ].join(", ");

  private registerPhoneInputLocator(page: Page): Locator {
    return page.locator(WebExecutor.REGISTER_PHONE_INPUT_SELECTOR).first();
  }

  private async locator(page: Page, step: ScenarioStep): Promise<Locator> {
    if (!step.target) {
      throw new Error(`${step.type} 必须指定 target`);
    }
    if (step.target === "register_input_phone") {
      const phoneInput = this.registerPhoneInputLocator(page);
      await phoneInput.waitFor({ state: "visible", timeout: this.timeoutMs(step) });
      return phoneInput;
    }
    const definition = this.input.locations[step.target];
    if (definition) {
      return this.resolveLocator(page, definition, this.timeoutMs(step));
    }

    return this.resolveInlineTarget(page, step);
  }

  private async uploadLocator(page: Page, step: ScenarioStep): Promise<Locator> {
    if (!step.target) {
      throw new Error(`${step.type} 必须指定 target`);
    }
    const timeoutMs = this.timeoutMs(step);
    const definition = this.input.locations[step.target];
    if (definition) {
      return this.resolveUploadLocatorPlans(page, createLocatorPlans(definition), timeoutMs);
    }

    const target = this.resolve(step.target);
    return this.resolveUploadLocatorPlans(page, this.inlineTargetPlans(step.type, target), timeoutMs);
  }

  private async resolveUploadLocatorPlans(page: Page, plans: LocatorPlan[], timeoutMs: number): Promise<Locator> {
    if (!plans.length) {
      throw new Error("上传定位定义为空");
    }
    const perCandidateTimeout = Math.max(800, Math.min(2_000, Math.floor(timeoutMs / plans.length)));
    const failures: string[] = [];

    for (const plan of plans) {
      const locator = this.buildLocator(page, plan).first();
      try {
        await locator.waitFor({ state: "attached", timeout: perCandidateTimeout });
        if (await this.isFileInput(locator)) {
          return locator;
        }
        const nestedInput = locator.locator("input[type='file']").first();
        await nestedInput.waitFor({ state: "attached", timeout: perCandidateTimeout });
        return nestedInput;
      } catch {
        failures.push(`${plan.kind}=${plan.value}`);
      }
    }

    throw new Error(`未找到文件上传 input，已尝试：${failures.join(" -> ")}`);
  }

  private async isFileInput(locator: Locator): Promise<boolean> {
    return locator.evaluate((element) => element instanceof HTMLInputElement && element.type === "file").catch(() => false);
  }

  private async resolveInlineTarget(page: Page, step: ScenarioStep): Promise<Locator> {
    const target = this.resolve(step.target);
    const timeoutMs = this.timeoutMs(step);
    const plans = this.inlineTargetPlans(step.type, target);
    const perCandidateTimeout = Math.max(800, Math.min(2_000, Math.floor(timeoutMs / plans.length)));
    const failures: string[] = [];

    for (const plan of plans) {
      const locator = this.buildLocator(page, plan).first();
      try {
        await locator.waitFor({ state: "visible", timeout: perCandidateTimeout });
        await this.input.logger.info(`未找到定位定义，已按页面文案兜底定位：${step.target}`, { stepId: step.step_id, locator: plan });
        return locator;
      } catch {
        failures.push(`${plan.kind}=${plan.value}`);
      }
    }

    throw new Error(`未找到定位定义或可见元素：${step.target}，已尝试：${failures.join(" -> ")}`);
  }

  private inlineTargetPlans(type: ScenarioStep["type"], target: string): LocatorPlan[] {
    const selectorPlan = inlineSelectorPlan(target);
    if (selectorPlan) {
      return [selectorPlan];
    }

    const xpathTarget = xpathLiteral(target);
    const textPlans: LocatorPlan[] = [
      { kind: "text", value: target },
      { kind: "role", value: "button", name: target }
    ];
    if (type === "web_input" || type === "web_select") {
      const formControl = type === "web_select" ? "select" : "input[not(@type='hidden')]";
      return [
        { kind: "label", value: target },
        { kind: "placeholder", value: target },
        {
          kind: "xpath",
          value: `//*[normalize-space()=${xpathTarget}]/ancestor::*[contains(@class,'form-item') or contains(@class,'el-form-item') or self::label][1]//${formControl}`
        },
        {
          kind: "xpath",
          value: `//*[contains(normalize-space(),${xpathTarget})]/following::${formControl}[1]`
        },
        { kind: "text", value: target },
        { kind: "css", value: `[name="${target}"]` }
      ];
    }
    if (type === "web_upload") {
      return [
        {
          kind: "xpath",
          value: `//*[contains(normalize-space(),${xpathTarget})]/ancestor::*[contains(@class,'upload') or contains(@class,'form-item') or contains(@class,'el-form-item')][1]//input[@type='file']`
        },
        { kind: "text", value: target }
      ];
    }
    return textPlans;
  }

  private async resolveLocator(page: Page, definition: LocationDefinition, timeoutMs: number): Promise<Locator> {
    const plans = createLocatorPlans(definition);
    if (!plans.length) {
      throw new Error("定位定义为空");
    }

    const perCandidateTimeout = Math.max(800, Math.min(2_000, Math.floor(timeoutMs / plans.length)));
    const failures: string[] = [];

    for (const plan of plans) {
      const locator = this.buildLocator(page, plan).first();
      try {
        await locator.waitFor({ state: "visible", timeout: perCandidateTimeout });
        return locator;
      } catch {
        failures.push(`${plan.kind}=${plan.value}`);
      }
    }

    throw new Error(`未找到可见元素，已按优先级尝试：${failures.join(" -> ")}`);
  }

  private buildLocator(page: Page, plan: LocatorPlan): Locator {
    if (plan.kind === "testId") return page.getByTestId(plan.value);
    if (plan.kind === "role") return page.getByRole(plan.value as never, plan.name ? { name: plan.name } : undefined);
    if (plan.kind === "label") return page.getByLabel(plan.value);
    if (plan.kind === "placeholder") return page.getByPlaceholder(plan.value);
    if (plan.kind === "text") return page.getByText(plan.value, { exact: true });
    if (plan.kind === "name") return page.locator(`[name="${plan.value}"]`);
    if (plan.kind === "css") return page.locator(plan.value);
    return page.locator(`xpath=${plan.value}`);
  }

  private async waitForLoginCompleted(page: Page, usernameLocator: Locator, step: ScenarioStep, diagnostics: LoginDiagnostics): Promise<void> {
    const timeoutMs = Number(process.env.FLOW_LOGIN_TIMEOUT_MS ?? step.timeout_ms ?? this.input.defaults?.step_timeout_ms ?? 15_000);
    const startUrl = page.url();

    await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 5_000) }).catch(() => undefined);

    const completed = await Promise.race([
      page.waitForURL((url) => url.toString() !== startUrl && !isLoginUrl(url.toString()), { timeout: timeoutMs }).then(() => true),
      usernameLocator.waitFor({ state: "hidden", timeout: timeoutMs }).then(() => true)
    ]).catch(() => false);

    if (completed) {
      return;
    }

    const loginFormStillVisible = await usernameLocator.isVisible().catch(() => false);
    if (loginFormStillVisible || isLoginUrl(page.url())) {
      const detail = diagnostics.summary();
      throw new Error(`${buildLoginStillPendingMessage(step.session, page.url())}${detail ? ` ${detail}` : ""}`);
    }
  }

  private collectLoginDiagnostics(page: Page): LoginDiagnostics {
    const failedResponses: string[] = [];
    const requestFailures: string[] = [];
    const consoleErrors: string[] = [];

    const onResponse = (response: { status: () => number; url: () => string }) => {
      const status = response.status();
      if (status >= 400) {
        failedResponses.push(`${status} ${response.url()}`);
      }
    };
    const onRequestFailed = (request: { url: () => string; failure: () => { errorText: string } | null }) => {
      requestFailures.push(`${request.failure()?.errorText ?? "request failed"} ${request.url()}`);
    };
    const onConsole = (message: { type: () => string; text: () => string }) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    };

    page.on("response", onResponse);
    page.on("requestfailed", onRequestFailed);
    page.on("console", onConsole);

    return {
      dispose: () => {
        page.off("response", onResponse);
        page.off("requestfailed", onRequestFailed);
        page.off("console", onConsole);
      },
      summary: () => {
        const parts = [
          failedResponses.length ? `失败响应：${failedResponses.slice(0, 3).join("；")}` : "",
          requestFailures.length ? `请求失败：${requestFailures.slice(0, 2).join("；")}` : "",
          consoleErrors.length ? `Console错误：${consoleErrors.slice(0, 2).join("；")}` : ""
        ].filter(Boolean);
        return parts.length ? `诊断信息：${parts.join("。")}` : "";
      }
    };
  }

  private async optionalInput(page: Page, base: ScenarioStep, target: string, value: string): Promise<void> {
    if (!this.input.locations[target]) return;
    await this.inputText(page, { ...base, target, value });
  }

  private async optionalUpload(page: Page, base: ScenarioStep, target: string, value?: string): Promise<void> {
    if (!this.input.locations[target] || !value) return;
    await this.upload(page, { ...base, target, file: value });
  }

  private async optionalClick(page: Page, base: ScenarioStep, target: string): Promise<void> {
    if (!this.input.locations[target]) return;
    await this.click(page, { ...base, target });
  }

  private recordInputDiagnostic(page: Page, diagnostic: InputValueDiagnostic): void {
    const diagnostics = this.pageActionDiagnostics.get(page) ?? [];
    diagnostics.push(diagnostic);
    this.pageActionDiagnostics.set(page, diagnostics.slice(-50));
  }

  private trackInput(page: Page, tracked: TrackedInput): void {
    if (!tracked.step.target) {
      return;
    }
    const inputs = this.pageTrackedInputs.get(page) ?? [];
    const next = inputs.filter((item) => item.step.target !== tracked.step.target);
    next.push(tracked);
    this.pageTrackedInputs.set(page, next.slice(-20));
  }

  private async recordTrackedInputsBeforeClick(page: Page, clickStep: ScenarioStep): Promise<void> {
    const trackedInputs = this.pageTrackedInputs.get(page)?.slice(-10) ?? [];
    for (const tracked of trackedInputs) {
      if (!tracked.step.target) {
        continue;
      }
      const locator = await this.locator(page, { ...tracked.step, timeout_ms: Math.min(tracked.step.timeout_ms ?? 1_000, 1_000) }).catch(() => undefined);
      if (!locator) {
        continue;
      }
      const actualValue = await readLocatorValue(locator).catch(() => undefined);
      if (actualValue === undefined) {
        continue;
      }
      this.recordInputDiagnostic(page, buildInputValueDiagnostic({
        phase: "before_click",
        stepId: clickStep.step_id,
        stepName: clickStep.name,
        stepType: clickStep.type,
        target: tracked.step.target,
        expectedValue: tracked.expectedValue,
        actualValue
      }));
    }
  }

  private async screenshot(page: Page, name: string): Promise<string> {
    const filePath = path.resolve(this.input.screenshotDir, `${name}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  }

  private timeoutMs(step: ScenarioStep): number {
    return step.timeout_ms ?? this.input.defaults?.step_timeout_ms ?? 10_000;
  }

  private async openPage(page: Page, step: ScenarioStep): Promise<void> {
    await navigatePage(page, this.resolve(step.url), this.timeoutMs(step));
  }

  private async waitForNetworkIfNeeded(page: Page, step: ScenarioStep): Promise<void> {
    if (!(step.wait_for_network ?? this.input.defaults?.wait_for_network)) {
      return;
    }
    await page.waitForLoadState("networkidle", { timeout: this.timeoutMs(step) }).catch(() => undefined);
  }

  private resolve(value: string | undefined): string {
    return resolveVariables(value, this.input.context.state);
  }

  private stringField(value: unknown, fieldName: string): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value === "string") {
      return value;
    }
    throw new Error(`${fieldName} 必须是字符串`);
  }
}

interface LoginDiagnostics {
  dispose: () => void;
  summary: () => string;
}

function isTargetClosedError(error: unknown): boolean {
  return error instanceof Error && /target page, context or browser has been closed/i.test(error.message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function apiAssertionError(message: string, api: ApiResponseDiagnostic): Error {
  return Object.assign(new Error(message), { apiDiagnostic: api });
}

async function readLocatorValue(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      return element.value;
    }
    return element.textContent ?? "";
  });
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n...<truncated ${value.length - maxLength} chars>`;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/("(?:password|passwd|pwd|token|accessToken|refreshToken|authorization|cookie)"\s*:\s*)"[^"]*"/gi, "$1\"******\"")
    .replace(/((?:password|passwd|pwd|token|authorization|cookie)=)[^&\s"]+/gi, "$1******")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1******");
}

function parseJson(value: string): unknown {
  if (!value.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function readPath(value: unknown, pathExpression: string): unknown {
  return pathExpression.split(".").reduce<unknown>((current, key) => {
    if (!isRecord(current)) {
      return undefined;
    }
    return current[key];
  }, value);
}

function detectBusinessFailure(bodyJson: unknown, bodyText: string): { failed: boolean; reason?: string } {
  const config = apiBusinessConfig();
  if (isRecord(bodyJson)) {
    const success = bodyJson.success;
    if (success === false || success === "false") {
      return { failed: true, reason: readBusinessMessage(bodyJson) ?? "success=false" };
    }

    const code = readConfiguredBusinessCode(bodyJson);
    if (code !== undefined) {
      if (config.failureCodes.some((failureCode) => isExpectedApiValue(code, failureCode))) {
        return { failed: true, reason: readBusinessMessage(bodyJson) ?? `${config.codePaths.join("|")}=${String(code)}` };
      }
      if (config.strictCode && !config.successCodes.some((successCode) => isExpectedApiValue(code, successCode))) {
        return { failed: true, reason: readBusinessMessage(bodyJson) ?? `${config.codePaths.join("|")}=${String(code)}` };
      }
    }

    const status = bodyJson.status;
    if (typeof status === "string" && ["failed", "fail", "error"].includes(status.toLowerCase())) {
      return { failed: true, reason: readBusinessMessage(bodyJson) ?? `status=${status}` };
    }
  }

  if (/Cannot invoke|Exception|NullPointerException|500 Internal Server Error/i.test(bodyText)) {
    return { failed: true, reason: firstLine(bodyText) };
  }
  return { failed: false };
}

function readConfiguredBusinessCode(bodyJson: unknown, overridePath?: string): unknown {
  if (!isRecord(bodyJson)) {
    return undefined;
  }
  const paths = overridePath ? [overridePath] : apiBusinessConfig().codePaths;
  for (const pathExpression of paths) {
    const value = readPath(bodyJson, pathExpression);
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return undefined;
}

function apiBusinessConfig(): {
  codePaths: string[];
  successCodes: ApiExpectedValue[];
  failureCodes: ApiExpectedValue[];
  strictCode: boolean;
} {
  return {
    codePaths: parseList(process.env.API_BUSINESS_CODE_PATHS, ["code"]),
    successCodes: parseList(process.env.API_BUSINESS_SUCCESS_CODES, ["0000", "0", "200", "success", "SUCCESS"]),
    failureCodes: parseList(process.env.API_BUSINESS_FAILURE_CODES, []),
    strictCode: process.env.API_BUSINESS_CODE_STRICT !== "false"
  };
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  const items = (value ?? "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

function isExpectedApiValue(actual: unknown, expected: unknown): boolean {
  if (actual === expected) {
    return true;
  }
  const actualText = String(actual ?? "").trim();
  const expectedText = String(expected ?? "").trim();
  if (actualText === expectedText) {
    return true;
  }
  if (/^\d+$/.test(actualText) && /^\d+$/.test(expectedText)) {
    return Number(actualText) === Number(expectedText);
  }
  return false;
}

function readBusinessMessage(bodyJson: Record<string, unknown>): string | undefined {
  for (const key of ["msg", "message", "error", "errorMessage", "detail"]) {
    const value = bodyJson[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 500) ?? "响应包含异常信息";
}

function inlineSelectorPlan(target: string): LocatorPlan | undefined {
  const trimmed = target.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("xpath=")) {
    return { kind: "xpath", value: trimmed.slice("xpath=".length) };
  }
  if (trimmed.startsWith("//") || trimmed.startsWith("(//") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return { kind: "xpath", value: trimmed };
  }
  if (trimmed.startsWith("css=")) {
    return { kind: "css", value: trimmed.slice("css=".length) };
  }
  if (/^[.#\[]/.test(trimmed) || /^[a-z][a-z0-9-]*(?:[.#[:\s>+~]|$)/i.test(trimmed)) {
    return { kind: "css", value: trimmed };
  }
  return undefined;
}

function xpathLiteral(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  if (!value.includes("\"")) {
    return `"${value}"`;
  }
  return `concat(${value.split("'").map((part) => `'${part}'`).join(`,"'",`)})`;
}
