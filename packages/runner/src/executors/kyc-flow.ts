import type { Page } from "playwright";
import type { LocationMap, ScenarioCase, ScenarioStep } from "@ai-e2e/shared";
type KycFlowDeps = {
  rootDir: string;
  locations: LocationMap;
  scenario?: ScenarioCase;
  resolve: (value?: string) => string;
  timeoutMs: (step: ScenarioStep) => number;
  click: (page: Page, step: ScenarioStep) => Promise<void>;
  inputText: (page: Page, step: ScenarioStep) => Promise<void>;
  upload: (page: Page, step: ScenarioStep) => Promise<void>;
  optionalInput: (page: Page, base: ScenarioStep, target: string, value: string) => Promise<void>;
  optionalUpload: (page: Page, base: ScenarioStep, target: string, value?: string) => Promise<void>;
  optionalClick: (page: Page, base: ScenarioStep, target: string) => Promise<void>;
};

function envFile(name: string, fallback: string): string {
  return (process.env[name] || fallback).trim();
}

function uploadSlotFile(deps: KycFlowDeps, target: string, envName: string, fallback: string): string {
  const slotFile = deps.scenario?.upload_slots
    ?.find((item) => item.type === "web_upload" && item.target === target)
    ?.file;
  const resolvedSlotFile = deps.resolve(slotFile);
  return (resolvedSlotFile && !resolvedSlotFile.includes("${") ? resolvedSlotFile : process.env[envName] || fallback).trim();
}

function splitChineseName(fullName: string): { lastName: string; firstName: string } {
  const name = fullName.trim();
  if (!name) return { lastName: "", firstName: "" };
  const compoundSurnames = ["欧阳", "上官", "司马", "诸葛", "东方", "慕容", "令狐", "皇甫", "夏侯", "独孤", "南宫", "万俟"];
  const compound = compoundSurnames.find((item) => name.startsWith(item));
  if (compound) {
    return { lastName: compound, firstName: name.slice(compound.length) };
  }
  return { lastName: name.slice(0, 1), firstName: name.slice(1) };
}

async function waitForUrl(page: Page, pattern: RegExp, timeoutMs: number): Promise<boolean> {
  try {
    await page.waitForURL(pattern, { timeout: timeoutMs });
    return true;
  } catch {
    return page.url().match(pattern) !== null;
  }
}

async function uploadViaElUpload(page: Page, scope: string, filePath: string): Promise<boolean> {
  const root = page.locator(scope).first();
  if (!(await root.count().catch(() => 0))) {
    return false;
  }
  await root.scrollIntoViewIfNeeded().catch(() => undefined);
  const input = root.locator("input[type='file']").first();
  if (!(await input.count().catch(() => 0))) {
    return false;
  }
  await input.setInputFiles(filePath);
  await root.locator(".el-upload-list__item, .file-item, .el-upload-list").first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForTimeout(1_500);
  return true;
}

async function uploadByLabel(deps: KycFlowDeps, page: Page, step: ScenarioStep, target: string, filePath: string): Promise<void> {
  if (!filePath) return;

  const scopeHints: Record<string, string> = {
    user_auth_id_upload: ".cert-photo-item"
  };
  const scope = scopeHints[target];
  if (scope && await uploadViaElUpload(page, scope, filePath)) {
    return;
  }

  const nameHints: Record<string, string> = {
    user_auth_id_upload: "cert",
    kyc_license_upload: "license",
    kyc_office_upload: "office",
    kyc_boss_id_front_upload: "bossIdFront",
    kyc_boss_id_back_upload: "bossIdBack",
    kyc_boss_id_handheld_upload: "bossIdHandheld"
  };
  const inputName = nameHints[target];
  if (inputName) {
    const namedInput = page.locator(`input[type='file'][name='${inputName}']`).first();
    if (await namedInput.count().catch(() => 0)) {
      await namedInput.setInputFiles(filePath);
      await page.waitForTimeout(1_000);
      return;
    }
  }

  const partialNameHints: Record<string, string> = {
    kyc_boss_id_front_upload: "idCardh",
    kyc_boss_id_back_upload: "idCardb",
    kyc_boss_id_handheld_upload: "idCardp"
  };
  const partialName = partialNameHints[target];
  if (partialName) {
    const partialInput = page.locator(`input[type='file'][name^='${partialName}']`).first();
    if (await partialInput.count().catch(() => 0)) {
      await partialInput.setInputFiles(filePath);
      await page.waitForTimeout(1_000);
      return;
    }
  }

  const labelHints: Record<string, string[]> = {
    user_auth_id_upload: ["证件照片", "证件"],
    kyc_license_upload: ["统一社会信用代码证", "营业执照", "商业登记证"],
    kyc_office_upload: ["企业办公场景", "办公场所", "办公场景"],
    kyc_boss_id_front_upload: ["人像面", "身份证正面", "证件正面"],
    kyc_boss_id_back_upload: ["国徽面", "身份证反面", "证件反面"],
    kyc_boss_id_handheld_upload: ["手持", "手持身份证"]
  };

  const labels = labelHints[target] ?? [];
  for (const labelText of labels) {
    const formItem = page.locator(".el-form-item").filter({ hasText: labelText }).first();
    const fileInput = formItem.locator("input[type='file']").first();
    if (await fileInput.count().catch(() => 0)) {
      await fileInput.setInputFiles(filePath);
      await page.waitForTimeout(1_000);
      return;
    }
  }

  if (deps.locations[target]) {
    await deps.upload(page, { ...step, target, file: filePath });
    return;
  }

  throw new Error(`未找到文件上传 input：${target}`);
}

async function fillIfEmpty(page: Page, placeholder: string, value: string): Promise<void> {
  if (!value) return;
  const input = page.getByPlaceholder(placeholder).first();
  if (!(await input.isVisible().catch(() => false))) return;
  const current = await input.inputValue().catch(() => "");
  if (current.trim()) return;
  await input.fill(value);
}

async function fillField(page: Page, placeholder: string, value: string): Promise<void> {
  if (!value) return;
  const input = page.getByPlaceholder(placeholder).first();
  if (!(await input.isVisible().catch(() => false))) return;
  await input.fill(value);
}

async function selectFirstOptionNearLabel(page: Page, labelText: string): Promise<void> {
  const formItem = page.locator(".el-form-item").filter({ hasText: labelText }).first();
  const select = formItem.locator(".el-select").first();
  if (!(await select.isVisible().catch(() => false))) return;
  await select.click();
  const option = page.locator(".el-select-dropdown:visible .el-select-dropdown__item").first();
  await option.waitFor({ state: "visible", timeout: 5_000 });
  await option.click();
}

async function selectOptionByText(page: Page, labelText: string, optionText: string): Promise<void> {
  const formItem = page.locator(".el-form-item").filter({ hasText: labelText }).first();
  const select = formItem.locator(".el-select").first();
  if (!(await select.isVisible().catch(() => false))) return;
  await select.click();
  const option = page.locator(".el-select-dropdown:visible .el-select-dropdown__item").filter({ hasText: optionText }).first();
  await option.waitFor({ state: "visible", timeout: 5_000 });
  await option.click();
}

async function fillAddressBlock(page: Page, labelText: string, detail: string): Promise<void> {
  const formItem = page.locator(".el-form-item").filter({ hasText: labelText }).first();
  const addrSelect = formItem.locator(".addr-select").first();
  if (await addrSelect.isVisible().catch(() => false)) {
    const provinceSelect = addrSelect.locator(".el-select").nth(0);
    if (await provinceSelect.isVisible().catch(() => false)) {
      await provinceSelect.click();
      const provinceOption = page.locator(".el-select-dropdown:visible .el-select-dropdown__item").filter({ hasText: "北京市" }).first();
      if (await provinceOption.isVisible().catch(() => false)) {
        await provinceOption.click();
      } else {
        await page.locator(".el-select-dropdown:visible .el-select-dropdown__item").first().click();
      }
      const citySelect = addrSelect.locator(".el-select").nth(1);
      if (await citySelect.isVisible().catch(() => false)) {
        await citySelect.click();
        await page.locator(".el-select-dropdown:visible .el-select-dropdown__item").first().click();
      }
    }
  }
  const detailInput = formItem.locator("input").last();
  if (await detailInput.isVisible().catch(() => false)) {
    const current = await detailInput.inputValue().catch(() => "");
    if (!current.trim()) {
      await detailInput.fill(detail);
    }
  }
}

async function waitForOcrOrTimeout(page: Page, successText: string, timeoutMs: number): Promise<void> {
  const success = page.getByText(successText).first();
  await Promise.race([
    success.waitFor({ state: "visible", timeout: timeoutMs }),
    page.waitForTimeout(Math.min(timeoutMs, 8_000))
  ]).catch(() => undefined);
}

async function completeUserAuth(deps: KycFlowDeps, page: Page, step: ScenarioStep): Promise<void> {
  const idCardFile = uploadSlotFile(deps, "user_auth_id_upload", "KYC_ID_CARD_FRONT_FILE", "uploads/cases/kyc_submit/id-card-front.png");
  const legalPerson = deps.resolve("${var.legal_person}") || envFile("KYC_LEGAL_PERSON", "测试法人");
  const idCardNo = deps.resolve("${var.id_card_no}") || envFile("KYC_ID_CARD_NO", "110101199001011234");
  const { lastName, firstName } = splitChineseName(legalPerson);

  await selectFirstOptionNearLabel(page, "证件类型");
  await uploadByLabel(deps, page, step, "user_auth_id_upload", idCardFile);
  await page.waitForTimeout(2_000);
  await waitForOcrOrTimeout(page, "已自动识别并填充证件信息", deps.timeoutMs(step));

  await fillField(page, "姓", lastName);
  await fillField(page, "名", firstName);
  await fillField(page, "请填写真实证件号", idCardNo);

  const authResponse = page.waitForResponse(
    (response) => response.url().includes("/auth/userAuth") && response.request().method() === "POST",
    { timeout: deps.timeoutMs(step) }
  );
  await deps.click(page, { ...step, target: "user_auth_next_step" });
  const response = await authResponse;
  const body = await response.json().catch(() => ({})) as { code?: string; msg?: string; success?: boolean };
  if (body.code && body.code !== "0000" && body.success !== true) {
    throw new Error(`个人认证提交失败：${body.msg || body.code}`);
  }
  await waitForUrl(page, /\/settings\/company\/addEnter/, deps.timeoutMs(step));
}

async function uploadIfPresent(page: Page, selector: string, filePath: string): Promise<boolean> {
  const input = page.locator(selector).first();
  if (!(await input.count().catch(() => 0))) {
    return false;
  }
  await input.setInputFiles(filePath);
  await page.waitForTimeout(1_000);
  return true;
}

async function completeEnterpriseStep1(deps: KycFlowDeps, page: Page, step: ScenarioStep): Promise<void> {
  const licenseFile = uploadSlotFile(deps, "kyc_license_upload", "KYC_BUSINESS_LICENSE_FILE", "uploads/cases/kyc_submit/business-license.png");
  const officeFile = uploadSlotFile(deps, "kyc_office_upload", "KYC_OFFICE_FILE", "uploads/cases/kyc_submit/office-scene.png");
  const enterpriseName = deps.resolve("${var.enterprise_name}") || `${envFile("KYC_ENTERPRISE_NAME_PREFIX", "自动化测试企业")}_${Date.now()}`;
  const licenseNo = deps.resolve("${var.license_no}") || `${envFile("KYC_LICENSE_NO_PREFIX", "AUTO")}${Date.now()}`;
  const addressDetail = deps.resolve("${var.reg_address_detail}") || "自动化测试详细地址001号";

  await selectFirstOptionNearLabel(page, "企业类型");
  await page.waitForTimeout(1_000);

  await uploadByLabel(deps, page, step, "kyc_license_upload", licenseFile);
  await page.waitForTimeout(2_000);
  const officeUploaded = await uploadIfPresent(page, "input[type='file'][name='office']", officeFile);
  if (!officeUploaded) {
    await uploadByLabel(deps, page, step, "kyc_office_upload", officeFile).catch(() => undefined);
  }

  await page.getByText("企业基本信息").first().scrollIntoViewIfNeeded().catch(() => undefined);
  await fillField(page, "请填写企业中文名称", enterpriseName);
  await fillField(page, "请填写企业英文名称", `${enterpriseName} EN`);
  await fillField(page, "一般为18/15位数字或字母组合", licenseNo);
  await fillField(page, "一般为18或15位数字或字母", licenseNo);

  await selectFirstOptionNearLabel(page, "企业注册国家");
  await fillAddressBlock(page, "企业注册地址", addressDetail);

  const sameAddress = page.getByText("与注册地址一致").first();
  if (await sameAddress.isVisible().catch(() => false)) {
    await sameAddress.click();
  } else {
    await fillAddressBlock(page, "实际经营地址", addressDetail);
  }

  await selectFirstOptionNearLabel(page, "员工人数");
  await selectFirstOptionNearLabel(page, "行业类型");
  const industryForm = page.locator(".industry-type-item").first();
  const commoditySelect = industryForm.locator(".el-select").nth(1);
  if (await commoditySelect.isVisible().catch(() => false)) {
    await commoditySelect.click();
    await page.locator(".el-select-dropdown:visible .el-select-dropdown__item").first().click();
  }

  await selectFirstOptionNearLabel(page, "出口类型");
  await selectFirstOptionNearLabel(page, "出口国家和地区");

  await deps.optionalInput(page, step, "kyc_history_export", "100");
  await deps.optionalInput(page, step, "kyc_estimate_export", "200");

  const setupDate = page.locator(".el-date-editor input").first();
  if (await setupDate.isVisible().catch(() => false)) {
    const current = await setupDate.inputValue().catch(() => "");
    if (!current.trim()) {
      await setupDate.fill("2020-01-01");
      await setupDate.press("Enter").catch(() => undefined);
    }
  }

  const longTerm = page.getByText("长期有效").first();
  if (await longTerm.isVisible().catch(() => false)) {
    await longTerm.click();
  }

  await deps.click(page, { ...step, target: "kyc_step1_next" });
  await page.getByText("重要成员").first().waitFor({ state: "visible", timeout: deps.timeoutMs(step) });
}

async function completeEnterpriseStep2(deps: KycFlowDeps, page: Page, step: ScenarioStep): Promise<void> {
  const legalPerson = deps.resolve("${var.legal_person}") || envFile("KYC_LEGAL_PERSON", "测试法人");
  const idCardNo = deps.resolve("${var.id_card_no}") || envFile("KYC_ID_CARD_NO", "110101199001011234");
  const idFrontFile = uploadSlotFile(deps, "kyc_boss_id_front_upload", "KYC_ID_CARD_FRONT_FILE", "uploads/cases/kyc_submit/id-card-front.png");
  const idBackFile = uploadSlotFile(deps, "kyc_boss_id_back_upload", "KYC_ID_CARD_BACK_FILE", "uploads/cases/kyc_submit/id-card-back.png");
  const idHandheldFile = uploadSlotFile(deps, "kyc_boss_id_handheld_upload", "KYC_ID_CARD_HANDHELD_FILE", "uploads/cases/kyc_submit/id-card-handheld.png");

  const personTypeItem = page.locator(".el-form-item").filter({ hasText: "成员身份" }).first();
  const personTypeSelect = personTypeItem.locator(".el-select, .dict-select").first();
  if (await personTypeSelect.isVisible().catch(() => false)) {
    await personTypeSelect.click();
    const legalRepOption = page.locator(".el-select-dropdown:visible .el-select-dropdown__item").filter({ hasText: "法定代表人" }).first();
    await legalRepOption.waitFor({ state: "visible", timeout: 5_000 });
    await legalRepOption.click();
  }
  await fillField(page, "请填写姓名，以证件姓名为准", legalPerson);
  await fillField(page, "请输入法人", legalPerson);

  await uploadByLabel(deps, page, step, "kyc_boss_id_front_upload", idFrontFile);
  await uploadByLabel(deps, page, step, "kyc_boss_id_back_upload", idBackFile);
  await uploadByLabel(deps, page, step, "kyc_boss_id_handheld_upload", idHandheldFile);

  await fillField(page, "请填写正确的证件号码", idCardNo);
  await fillField(page, "请输入身份证号", idCardNo);
  await fillIfEmpty(page, "出生日期", "1990-01-01");
  await fillIfEmpty(page, "派发日期", "2015-01-01");

  const longTerm = page.getByText("证件长期有效").first();
  if (await longTerm.isVisible().catch(() => false)) {
    await longTerm.click();
  } else {
    await fillIfEmpty(page, "有效期", "2035-01-01");
  }

  const shareInput = page.locator(".el-input-number input").first();
  if (await shareInput.isVisible().catch(() => false)) {
    const current = await shareInput.inputValue().catch(() => "");
    if (!current.trim()) {
      await shareInput.fill("100");
    }
  }

  await fillAddressBlock(page, "实际居住地址", deps.resolve("${var.reg_address_detail}") || "自动化测试居住地址001号");

  await deps.click(page, { ...step, target: "kyc_step2_next" });
  await page.getByText("提交申请").first().waitFor({ state: "visible", timeout: deps.timeoutMs(step) }).catch(async () => {
    await page.getByText("预览提交").first().waitFor({ state: "visible", timeout: deps.timeoutMs(step) });
  });
}

async function submitEnterprisePreview(deps: KycFlowDeps, page: Page, step: ScenarioStep): Promise<void> {
  await deps.click(page, { ...step, target: "kyc_submit" });
  await page.getByText("企业认证提交成功").first().waitFor({ state: "visible", timeout: deps.timeoutMs(step) }).catch(async () => {
    await page.getByText("待审核").first().waitFor({ state: "visible", timeout: deps.timeoutMs(step) });
  });
}

export async function runKycSubmitFlow(page: Page, step: ScenarioStep, deps: KycFlowDeps): Promise<void> {
  const timeout = deps.timeoutMs(step);

  if (page.url().includes("/404")) {
    const userAuthUrl = deps.resolve("${env.USER_HOME_URL}settings/userAuth");
    if (userAuthUrl && !userAuthUrl.includes("${")) {
      await page.goto(userAuthUrl, { waitUntil: "domcontentloaded", timeout }).catch(() => undefined);
      await page.waitForTimeout(2_000);
    }
  }

  const userAuthMarker = page.getByText("证件照片").first();
  if (page.url().includes("/settings/userAuth") || await userAuthMarker.isVisible().catch(() => false)) {
    await completeUserAuth(deps, page, step);
  }

  if (!page.url().includes("/settings/company/addEnter")) {
    const addEnterButton = page.getByRole("button", { name: "新增企业" }).first();
    if (page.url().includes("/settings/company") && await addEnterButton.isVisible().catch(() => false)) {
      await addEnterButton.click();
      await page.waitForTimeout(2_000);
    }
    await waitForUrl(page, /\/settings\/company\/addEnter/, timeout);
  }

  await page.getByText("企业信息").first().waitFor({ state: "visible", timeout }).catch(() => undefined);
  await completeEnterpriseStep1(deps, page, step);
  await completeEnterpriseStep2(deps, page, step);
  await submitEnterprisePreview(deps, page, step);
}
