import fs from "node:fs/promises";
import path from "node:path";

export type DoctorStatus = "pass" | "warning" | "error";

export interface DoctorItem {
  code: string;
  status: DoctorStatus;
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  items: DoctorItem[];
}

export interface DoctorInput {
  rootDir: string;
  env?: NodeJS.ProcessEnv;
  exists?: (filePath: string) => Promise<boolean>;
  listCases?: () => Promise<string[]>;
  nodeVersion?: string;
}

export async function buildDoctorReport(input: DoctorInput): Promise<DoctorReport> {
  const env = input.env ?? process.env;
  const exists = input.exists ?? pathExists;
  const listCases = input.listCases ?? (() => listScenarioCases(input.rootDir));
  const items: DoctorItem[] = [];

  addNodeCheck(items, input.nodeVersion ?? process.versions.node);
  for (const file of ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "tsconfig.base.json", "platform.config.json"]) {
    const filePath = path.resolve(input.rootDir, file);
    items.push(await exists(filePath)
      ? pass(fileCode(file), `${file} 已存在`)
      : error(fileCode(file), `${file} 不存在，请确认当前目录是 dwt-testing 工程根目录`));
  }

  const playwrightPackage = path.resolve(input.rootDir, "packages", "runner", "node_modules", "playwright");
  items.push(await exists(playwrightPackage)
    ? pass("playwright_package", "runner Playwright 依赖已安装")
    : warning("playwright_package_missing", "runner Playwright 依赖未安装；请先执行 pnpm install"));

  const caseIds = await listCases().catch(() => []);
  items.push(caseIds.length
    ? pass("cases_found", `已发现 ${caseIds.length} 个 YAML 用例`)
    : error("cases_empty", "未发现 cases/scenario 下的 YAML 用例"));

  addAiConfigCheck(items, env);
  addLoginConfigCheck(items, env);
  await addFlowEnvConfigCheck(items, input.rootDir, env);

  return {
    ok: !items.some((item) => item.status === "error"),
    items
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    `${report.ok ? "PASS" : "FAIL"} DWT 环境检查`,
    ...report.items.map((item) => `${label(item.status)} ${item.code} ${item.message}`)
  ];
  return lines.join("\n");
}

async function listScenarioCases(rootDir: string): Promise<string[]> {
  const scenarioDir = path.resolve(rootDir, "cases", "scenario");
  const files = await fs.readdir(scenarioDir).catch(() => []);
  return files
    .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
    .map((file) => path.basename(file, path.extname(file)))
    .sort((left, right) => left.localeCompare(right));
}

async function pathExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true).catch(() => false);
}

function addNodeCheck(items: DoctorItem[], version: string): void {
  const major = Number(version.split(".")[0]);
  items.push(Number.isFinite(major) && major >= 20
    ? pass("node_version", `Node.js ${version} 满足要求`)
    : error("node_version", `Node.js ${version} 不满足要求，请使用 Node.js 20+`));
}

function addAiConfigCheck(items: DoctorItem[], env: NodeJS.ProcessEnv): void {
  const missing = ["AI_BASE_URL", "AI_MODEL", "AI_API_KEY"].filter((key) => !env[key]);
  items.push(missing.length
    ? warning("ai_config_missing", `AI 能力未完整配置：缺少 ${missing.join(", ")}；不影响非 AI 用例运行`)
    : pass("ai_config", "AI_BASE_URL、AI_MODEL、AI_API_KEY 已配置"));
}

function addLoginConfigCheck(items: DoctorItem[], env: NodeJS.ProcessEnv): void {
  const missing = ["USER_LOGIN_URL", "ADMIN_LOGIN_URL"].filter((key) => !env[key]);
  items.push(missing.length
    ? warning("login_url_missing", `登录入口未完整配置：缺少 ${missing.join(", ")}；相关 Web 用例预检会失败`)
    : pass("login_url", "用户端和后台登录入口已配置"));
}

async function addFlowEnvConfigCheck(items: DoctorItem[], rootDir: string, env: NodeJS.ProcessEnv): Promise<void> {
  const envRefs = await collectScenarioEnvRefs(rootDir);
  if (!envRefs.length) {
    return;
  }

  const missing = envRefs.filter((key) => !env[key]);
  items.push(missing.length
    ? warning("flow_env_missing", `当前流程引用的环境变量未完整配置：缺少 ${missing.join(", ")}`)
    : pass("flow_env", `当前流程引用的 ${envRefs.length} 个环境变量已配置`));
}

async function collectScenarioEnvRefs(rootDir: string): Promise<string[]> {
  const scenarioDir = path.resolve(rootDir, "cases", "scenario");
  const files = await fs.readdir(scenarioDir).catch(() => []);
  const refs = new Set<string>();

  await Promise.all(files
    .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
    .map(async (file) => {
      const content = await fs.readFile(path.resolve(scenarioDir, file), "utf8");
      for (const match of content.matchAll(/\$\{env\.([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
        if (match[1]) {
          refs.add(match[1]);
        }
      }
    }));

  return [...refs].sort();
}

function fileCode(file: string): string {
  return file.replace(/\W+/g, "_").replace(/_+$/, "");
}

function label(status: DoctorStatus): string {
  if (status === "pass") return "PASS";
  if (status === "warning") return "WARN";
  return "ERROR";
}

function pass(code: string, message: string): DoctorItem {
  return { code, status: "pass", message };
}

function warning(code: string, message: string): DoctorItem {
  return { code, status: "warning", message };
}

function error(code: string, message: string): DoctorItem {
  return { code, status: "error", message };
}
