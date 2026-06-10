import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { DEFAULT_TEST_ENV, locationMapSchema, resolveVariables, type LocationMap, type RuntimeContextState, type ScenarioCase, type ScenarioStep } from "@ai-e2e/shared";
import { EnvGuard } from "../utils/env-guard";
import { validateScenarioContentForRun } from "../loader/scenario-loader";
import { resolveUploadFilePath } from "../utils/upload-file";

export type PreflightSeverity = "error" | "warning";

export interface PreflightIssue {
  severity: PreflightSeverity;
  code: string;
  path: string;
  message: string;
}

export interface ScenarioPreflightResult {
  runnable: boolean;
  caseId?: string;
  caseName?: string;
  env: string;
  summary: {
    steps: number;
    webSteps: number;
    apiSteps: number;
    dbSteps: number;
    missingEnvVars: string[];
    warnings: number;
    errors: number;
  };
  issues: PreflightIssue[];
}

export async function preflightScenarioContent(input: {
  rootDir: string;
  content: string;
  env?: string;
}): Promise<ScenarioPreflightResult> {
  const env = input.env ?? process.env.TEST_ENV ?? DEFAULT_TEST_ENV;
  const validation = await validateScenarioContentForRun(input.rootDir, input.content);
  const issues: PreflightIssue[] = validation.issues.map((issue) => ({
    severity: "error",
    code: "dsl_invalid",
    path: issue.path,
    message: issue.message
  }));

  if (!validation.valid || !validation.data) {
    return buildResult({ env, caseId: validation.caseId, caseName: validation.caseName, scenario: undefined, issues });
  }

  const scenario = validation.data;
  checkRunnableEnv(env, scenario, issues);
  const envRefs = collectEnvRefs(scenario);
  for (const name of envRefs) {
    if (!process.env[name]) {
      issues.push({
        severity: "error",
        code: "env_missing",
        path: `env.${name}`,
        message: `缺少环境变量 ${name}`
      });
    }
  }

  const locations = await loadLocations(input.rootDir, scenario.locations.file, issues);
  checkDuplicateStepIds(scenario, issues);
  checkSessions(scenario, issues);
  await checkSteps(input.rootDir, scenario, locations, issues);

  return buildResult({ env, caseId: scenario.case_id, caseName: scenario.case_name, scenario, issues });
}

function buildResult(input: {
  env: string;
  caseId?: string;
  caseName?: string;
  scenario?: ScenarioCase;
  issues: PreflightIssue[];
}): ScenarioPreflightResult {
  const steps = input.scenario?.steps ?? [];
  const errors = input.issues.filter((issue) => issue.severity === "error").length;
  const warnings = input.issues.filter((issue) => issue.severity === "warning").length;
  return {
    runnable: errors === 0,
    caseId: input.caseId,
    caseName: input.caseName,
    env: input.env,
    summary: {
      steps: steps.length,
      webSteps: steps.filter((step) => isWebStep(step)).length,
      apiSteps: steps.filter((step) => isApiStep(step)).length,
      dbSteps: steps.filter((step) => isDbStep(step)).length,
      missingEnvVars: input.issues
        .filter((issue) => issue.code === "env_missing")
        .map((issue) => issue.path.replace(/^env\./, ""))
        .sort(),
      warnings,
      errors
    },
    issues: input.issues
  };
}

async function loadLocations(rootDir: string, locationFile: string, issues: PreflightIssue[]): Promise<LocationMap | undefined> {
  const locationPath = path.resolve(rootDir, locationFile);
  const rootPath = path.resolve(rootDir);
  if (!locationPath.startsWith(rootPath + path.sep)) {
    issues.push({
      severity: "error",
      code: "location_path_outside_root",
      path: "locations.file",
      message: `定位文件不能指向项目目录外：${locationFile}`
    });
    return undefined;
  }

  try {
    const content = await fs.readFile(locationPath, "utf8");
    const parsed = locationMapSchema.safeParse(YAML.parse(content));
    if (!parsed.success) {
      issues.push({
        severity: "error",
        code: "location_invalid",
        path: "locations.file",
        message: `定位文件校验失败：${parsed.error.message}`
      });
      return undefined;
    }
    return parsed.data;
  } catch (error) {
    issues.push({
      severity: "error",
      code: "location_missing",
      path: "locations.file",
      message: `定位文件不存在或不可读取：${locationFile}，${error instanceof Error ? error.message : String(error)}`
    });
    return undefined;
  }
}

function checkRunnableEnv(env: string, scenario: ScenarioCase, issues: PreflightIssue[]): void {
  try {
    EnvGuard.assertRunnable(env, scenario);
  } catch (error) {
    issues.push({
      severity: "error",
      code: "env_blocked",
      path: "env",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function checkDuplicateStepIds(scenario: ScenarioCase, issues: PreflightIssue[]): void {
  const seen = new Set<string>();
  scenario.steps.forEach((step, index) => {
    if (seen.has(step.step_id)) {
      issues.push({
        severity: "error",
        code: "step_id_duplicate",
        path: `steps.${index}.step_id`,
        message: `步骤 ID 重复：${step.step_id}`
      });
    }
    seen.add(step.step_id);
  });
}

function checkSessions(scenario: ScenarioCase, issues: PreflightIssue[]): void {
  const sessionNames = new Set<string>();
  scenario.sessions.forEach((session, index) => {
    if (sessionNames.has(session.name)) {
      issues.push({
        severity: "error",
        code: "session_duplicate",
        path: `sessions.${index}.name`,
        message: `会话重复：${session.name}`
      });
    }
    sessionNames.add(session.name);
  });
}

async function checkSteps(rootDir: string, scenario: ScenarioCase, locations: LocationMap | undefined, issues: PreflightIssue[]): Promise<void> {
  const sessions = new Set(scenario.sessions.map((session) => session.name));
  const state = createPreflightState(scenario);
  for (const [index, step] of scenario.steps.entries()) {
    const basePath = `steps.${index}`;
    if (step.session && !sessions.has(step.session)) {
      issues.push({
        severity: "error",
        code: "session_unknown",
        path: `${basePath}.session`,
        message: `步骤引用了未定义会话：${step.session}`
      });
    }

    if (isWebStep(step)) {
      checkWebStep(step, basePath, locations, issues);
    } else if (isApiStep(step)) {
      checkApiStep(step, basePath, issues);
    } else if (isDbStep(step)) {
      checkDbStep(step, basePath, issues);
    }

    if (step.type === "web_upload") {
      await checkUploadFile(rootDir, step, state, basePath, issues);
    }
  }
}

function checkWebStep(step: ScenarioStep, pathPrefix: string, locations: LocationMap | undefined, issues: PreflightIssue[]): void {
  if (!step.session) {
    issues.push({
      severity: "error",
      code: "web_session_missing",
      path: `${pathPrefix}.session`,
      message: `${step.type} 必须指定 session`
    });
  }

  if (step.type === "web_open" && !step.url) {
    issues.push({ severity: "error", code: "web_url_missing", path: `${pathPrefix}.url`, message: "web_open 必须指定 url" });
  }
  if (["web_click", "web_input", "web_select", "web_upload", "web_wait_text", "web_wait_element", "web_assert_text", "web_assert_visible", "web_extract"].includes(step.type) && !step.target) {
    issues.push({ severity: "error", code: "web_target_missing", path: `${pathPrefix}.target`, message: `${step.type} 必须指定 target` });
  }
  if ((step.type === "web_input" || step.type === "web_select") && step.value === undefined) {
    issues.push({ severity: "error", code: "web_value_missing", path: `${pathPrefix}.value`, message: `${step.type} 必须指定 value` });
  }
  if ((step.type === "web_assert_text" || step.type === "web_wait_text") && step.expected === undefined) {
    issues.push({ severity: "error", code: "web_expected_missing", path: `${pathPrefix}.expected`, message: `${step.type} 必须指定 expected` });
  }

  if (step.target && locations && !locations[step.target] && !isInlineTarget(step.target)) {
    issues.push({
      severity: "warning",
      code: "location_key_missing",
      path: `${pathPrefix}.target`,
      message: `定位文件中未定义 target：${step.target}，运行时将尝试按页面文案或选择器兜底定位`
    });
  }
}

function checkApiStep(step: ScenarioStep, pathPrefix: string, issues: PreflightIssue[]): void {
  if (!step.url) {
    issues.push({ severity: "error", code: "api_url_missing", path: `${pathPrefix}.url`, message: `${step.type} 必须指定 url` });
    return;
  }

  if (!/^https?:\/\//i.test(step.url) && !step.session && !apiBaseUrl()) {
    issues.push({
      severity: "error",
      code: "api_base_url_missing",
      path: `${pathPrefix}.url`,
      message: "相对 API URL 需要配置 API_BASE_URL，或给步骤指定 session 以复用登录地址域名"
    });
  }

  if (step.type === "api_assert" && step.expected === undefined && !step.business_code_path && !step.success_codes?.length) {
    issues.push({
      severity: "warning",
      code: "api_assert_weak",
      path: pathPrefix,
      message: "api_assert 未配置 expected、business_code_path 或 success_codes，断言强度偏弱"
    });
  }
}

function checkDbStep(step: ScenarioStep, pathPrefix: string, issues: PreflightIssue[]): void {
  if (step.type === "db_clean") {
    issues.push({
      severity: "error",
      code: "db_clean_disabled",
      path: pathPrefix,
      message: "db_clean 当前未开放，DB 能力只允许只读查询和断言"
    });
  }
  if (process.env.DB_ENABLED !== "true") {
    issues.push({
      severity: "error",
      code: "db_disabled",
      path: pathPrefix,
      message: "用例包含 DB 步骤，但当前 DB_ENABLED 未设置为 true"
    });
  }
  if (!step.sql) {
    issues.push({ severity: "error", code: "db_sql_missing", path: `${pathPrefix}.sql`, message: `${step.type} 必须指定 sql` });
  }
  if (step.type === "db_assert" && step.expected === undefined) {
    issues.push({ severity: "error", code: "db_expected_missing", path: `${pathPrefix}.expected`, message: "db_assert 必须指定 expected" });
  }
}

async function checkUploadFile(
  rootDir: string,
  step: ScenarioStep,
  state: RuntimeContextState,
  pathPrefix: string,
  issues: PreflightIssue[]
): Promise<void> {
  if (!step.file) {
    issues.push({ severity: "error", code: "upload_file_missing", path: `${pathPrefix}.file`, message: "web_upload 必须指定 file" });
    return;
  }

  let resolvedFile: string;
  try {
    resolvedFile = resolveUploadFileExpression(step.file, state, step);
  } catch (error) {
    issues.push({
      severity: "error",
      code: "upload_file_unresolved",
      path: `${pathPrefix}.file`,
      message: `上传文件路径变量无法解析：${error instanceof Error ? error.message : String(error)}`
    });
    return;
  }

  let filePath: string;
  try {
    filePath = resolveUploadFilePath(rootDir, resolvedFile);
  } catch (error) {
    issues.push({
      severity: "error",
      code: "upload_file_outside_root",
      path: `${pathPrefix}.file`,
      message: error instanceof Error ? error.message : String(error)
    });
    return;
  }

  await fs.stat(filePath).then((stat) => {
    if (!stat.isFile()) {
      issues.push({
        severity: "error",
        code: "upload_file_not_file",
        path: `${pathPrefix}.file`,
        message: `上传路径不是文件：${resolvedFile}`
      });
    }
  }).catch(() => {
    issues.push({
      severity: "error",
      code: "upload_file_missing_on_disk",
      path: `${pathPrefix}.file`,
      message: `上传文件不存在：${resolvedFile}`
    });
  });
}

function createPreflightState(scenario: ScenarioCase): RuntimeContextState {
  const sessions = Object.fromEntries(scenario.sessions.map((session) => [session.name, session]));
  return {
    runId: "preflight",
    env: process.env.TEST_ENV ?? DEFAULT_TEST_ENV,
    scenario,
    timestamp: "preflight",
    variables: scenario.variables ?? {},
    sessions
  };
}

function resolveUploadFileExpression(input: string, state: RuntimeContextState, step: ScenarioStep): string {
  let current = input;
  for (let index = 0; index < 5; index += 1) {
    const next = resolveVariables(current, state, step);
    if (next === current || !next.includes("${")) {
      return next;
    }
    current = next;
  }
  return current;
}

function collectEnvRefs(value: unknown): string[] {
  const refs = new Set<string>();
  visitStrings(value, (text) => {
    for (const match of text.matchAll(/\$\{env\.([^}]+)\}/g)) {
      if (match[1]) {
        refs.add(match[1].trim());
      }
    }
  });
  return [...refs].sort();
}

function visitStrings(value: unknown, visitor: (text: string) => void): void {
  if (typeof value === "string") {
    visitor(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => visitStrings(item, visitor));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => visitStrings(item, visitor));
  }
}

function apiBaseUrl(): string | undefined {
  return process.env.API_BASE_URL
    ?? process.env.APP_API_BASE_URL
    ?? process.env.DWT_API_BASE_URL
    ?? process.env.TEST_API_BASE_URL;
}

function isDbStep(step: ScenarioStep): boolean {
  return step.type === "db_query" || step.type === "db_assert" || step.type === "db_clean";
}

function isApiStep(step: ScenarioStep): boolean {
  return step.type === "api_request" || step.type === "api_assert";
}

function isWebStep(step: ScenarioStep): boolean {
  return !isDbStep(step) && !isApiStep(step);
}

function isInlineTarget(target: string): boolean {
  const trimmed = target.trim();
  return trimmed.startsWith("xpath=")
    || trimmed.startsWith("//")
    || trimmed.startsWith("(//")
    || trimmed.startsWith("./")
    || trimmed.startsWith("../")
    || trimmed.startsWith("css=")
    || /^[.#\[]/.test(trimmed)
    || /^[a-z][a-z0-9-]*(?:[.#[:\s>+~]|$)/i.test(trimmed);
}
