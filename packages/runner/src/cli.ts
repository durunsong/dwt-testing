#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseEnvFileContent } from "@ai-e2e/shared";
import { preflightScenarioContent } from "./preflight/scenario-preflight";
import { ScenarioLoader, validateScenarioContent, validateScenarioContentForRun } from "./loader/scenario-loader";
import { ScenarioOrchestrator } from "./orchestrator/scenario-orchestrator";
import { loadPlatformConfig } from "./config/platform-config";
import { buildDoctorReport, formatDoctorReport } from "./cli-doctor";

interface CliOptions {
  env: string;
  headless?: boolean;
  envFile?: boolean;
}

async function main(): Promise<void> {
  const [command = "help", ...args] = process.argv.slice(2);
  const rootDir = process.cwd();
  const options = parseOptions(args);

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "list") {
    await listCases(rootDir);
    return;
  }

  if (command === "validate") {
    await validateCases(rootDir, args.filter((arg) => !arg.startsWith("--"))[0]);
    return;
  }

  if (command === "doctor" || command === "setup") {
    await doctor(rootDir, options);
    return;
  }

  if (command === "preflight" || command === "plan") {
    const target = args.find((arg) => !arg.startsWith("--"));
    if (!target) {
      throw new Error(`${command} 命令必须指定 caseId 或 YAML 文件`);
    }
    await preflightCase(rootDir, target, options);
    return;
  }

  if (command === "run") {
    const target = args.find((arg) => !arg.startsWith("--"));
    if (!target) {
      throw new Error("run 命令必须指定 caseId 或 YAML 文件");
    }
    await runCase(rootDir, target, options);
    return;
  }

  throw new Error(`未知命令：${command}`);
}

async function listCases(rootDir: string): Promise<void> {
  const loader = new ScenarioLoader(rootDir);
  const cases = await loader.list();
  if (!cases.length) {
    console.log("未找到用例");
    return;
  }

  for (const item of cases) {
    console.log(`${item.case_id}\t${item.case_name}\t${item.steps.length} steps`);
  }
}

async function validateCases(rootDir: string, target?: string): Promise<void> {
  const files = target
    ? [await resolveCaseTarget(rootDir, target)]
    : await scenarioFiles(rootDir);

  let failed = 0;
  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    const result = await validateScenarioContentForRun(rootDir, content);
    const relative = path.relative(rootDir, file);
    if (result.valid) {
      console.log(`PASS ${relative} (${result.caseId})`);
      continue;
    }

    failed += 1;
    console.log(`FAIL ${relative}`);
    for (const issue of result.issues) {
      console.log(`  - ${issue.path}: ${issue.message}`);
    }
  }

  if (failed > 0) {
    throw new Error(`DSL 校验失败：${failed}/${files.length}`);
  }
}

async function doctor(rootDir: string, options: CliOptions): Promise<void> {
  if (options.envFile !== false) {
    await loadEnvFiles(rootDir, options.env);
  }
  const report = await buildDoctorReport({ rootDir });
  console.log(formatDoctorReport(report));
  if (!report.ok) {
    process.exitCode = 1;
  }
}

async function runCase(rootDir: string, target: string, options: CliOptions): Promise<void> {
  if (options.envFile !== false) {
    await loadEnvFiles(rootDir, options.env);
  }
  if (options.headless !== undefined) {
    process.env.HEADLESS = String(options.headless);
  }

  const filePath = await resolveCaseTarget(rootDir, target);
  const content = await fs.readFile(filePath, "utf8");
  const validation = validateScenarioContent(content);
  if (!validation.caseId) {
    throw new Error(`无法从 YAML 中读取 case_id：${path.relative(rootDir, filePath)}`);
  }

  const runner = new ScenarioOrchestrator(rootDir);
  const report = await runner.run({
    caseId: validation.caseId,
    filePath,
    env: options.env,
    onEvent: (event) => {
      if (event.type === "run_started") {
        console.log(`RUN ${event.runId} ${event.message ?? ""}`);
      }
      if (event.step) {
        console.log(`${(event.status ?? event.step.status).toUpperCase()} ${event.step.stepId} ${event.step.name}`);
      }
      if (event.type === "run_finished") {
        console.log(`DONE ${event.status} ${event.message ?? ""}`);
      }
    }
  });

  if (report.artifacts.htmlReport) {
    console.log(`report: ${path.relative(rootDir, report.artifacts.htmlReport)}`);
  }
  if (report.status === "failed") {
    process.exitCode = 1;
  }
}

async function preflightCase(rootDir: string, target: string, options: CliOptions): Promise<void> {
  if (options.envFile !== false) {
    await loadEnvFiles(rootDir, options.env);
  }
  const file = await resolveCaseTarget(rootDir, target);
  const result = await preflightScenarioContent({
    rootDir,
    content: await fs.readFile(file, "utf8"),
    env: options.env
  });

  const title = `${result.runnable ? "PASS" : "FAIL"} ${result.caseId ?? target} (${result.env})`;
  console.log(title);
  console.log(`steps=${result.summary.steps} web=${result.summary.webSteps} api=${result.summary.apiSteps} db=${result.summary.dbSteps}`);
  for (const issue of result.issues) {
    console.log(`${issue.severity.toUpperCase()} ${issue.code} ${issue.path} ${issue.message}`);
  }
  if (!result.runnable) {
    process.exitCode = 1;
  }
}

async function resolveCaseTarget(rootDir: string, target: string): Promise<string> {
  const direct = path.resolve(rootDir, target);
  if (await exists(direct)) {
    return direct;
  }

  const files = await scenarioFiles(rootDir);
  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    const result = await validateScenarioContentForRun(rootDir, content);
    if (result.caseId === target) {
      return file;
    }
  }

  throw new Error(`未找到用例或文件：${target}`);
}

async function scenarioFiles(rootDir: string): Promise<string[]> {
  const scenarioDir = path.resolve(rootDir, "cases", "scenario");
  const files = await fs.readdir(scenarioDir);
  return files
    .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
    .map((file) => path.resolve(scenarioDir, file))
    .sort((left, right) => left.localeCompare(right));
}

async function loadEnvFiles(rootDir: string, env: string): Promise<void> {
  const files = env === "local"
    ? [".env", ".env.local"]
    : [".env", `.env.${env}`];

  for (const file of files) {
    const filePath = path.resolve(rootDir, file);
    if (!await exists(filePath)) {
      continue;
    }
    const content = await fs.readFile(filePath, "utf8");
    for (const [key, value] of parseEnvFileContent(content)) {
      process.env[key] = value;
    }
  }
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = { env: "local" };
  for (const arg of args) {
    if (arg.startsWith("--env=")) {
      options.env = arg.slice("--env=".length);
    } else if (arg === "--headless") {
      options.headless = true;
    } else if (arg === "--headed") {
      options.headless = false;
    } else if (arg === "--no-env-file") {
      options.envFile = false;
    }
  }
  return options;
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true).catch(() => false);
}

function printHelp(): void {
  const productName = loadPlatformConfig(process.cwd()).app.productName;
  console.log([
    `${productName} CLI`,
    "",
    "Usage:",
    "  pnpm dwt list",
    "  pnpm dwt doctor",
    "  pnpm dwt setup --check",
    "  pnpm dwt validate [caseId|file]",
    "  pnpm dwt preflight <caseId|file> [--env=local|dev|test|sit] [--no-env-file]",
    "  pnpm dwt plan <caseId|file> [--env=local|dev|test|sit] [--no-env-file]",
    "  pnpm dwt run <caseId|file> [--env=local|dev|test|sit] [--headless|--headed] [--no-env-file]",
    "",
    "Examples:",
    "  pnpm dwt doctor",
    "  pnpm dwt validate admin_profile_update",
    "  pnpm dwt preflight login_user --env=sit",
    "  pnpm dwt run login_user --env=sit --headless"
  ].join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
