import fs from "node:fs";
import path from "node:path";
import { parseEnvFileContent } from "@ai-e2e/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { loadPlatformConfig, type PlatformConfig, ScenarioOrchestrator } from "@ai-e2e/runner";
import { registerAiRoutes } from "./routes/ai.routes";
import { registerAiReportRoutes } from "./routes/ai-reports.routes";
import { registerCaseRoutes } from "./routes/cases.routes";
import { registerDbRoutes } from "./routes/db.routes";
import { registerAppContextRoutes } from "./routes/app-context.routes";
import { registerSettingsRoutes } from "./routes/settings.routes";
import { registerTestRunEventRoutes } from "./routes/test-run-events.routes";
import { registerTestRunRoutes } from "./routes/test-runs.routes";
import { CaseService } from "./services/case.service";
import { DbService } from "./services/db.service";
import { AppContextService } from "./services/app-context.service";
import { EnvConfigService } from "./services/env-config.service";
import { ReportService } from "./services/report.service";
import { TestRunService } from "./services/test-run.service";
import { AiReportService } from "./services/ai-report.service";
import { PlatformSettingsService } from "./services/platform-settings.service";

export interface CreateServerOptions {
  rootDir: string;
  logger?: boolean;
}

export interface StartServerOptions {
  rootDir?: string;
  port?: number;
  host?: string;
  logger?: boolean;
}

export interface StartedServer {
  app: FastifyInstance;
  rootDir: string;
  host: string;
  port: number;
  origin: string;
  close: () => Promise<void>;
}

export async function createServer(options: CreateServerOptions): Promise<FastifyInstance> {
  const rootDir = path.resolve(options.rootDir);
  loadEnvFileIntoProcess(path.resolve(rootDir, ".env"));
  const platformConfig = loadPlatformConfig(rootDir);

  const app = Fastify({ logger: options.logger ?? true });
  registerCors(app, platformConfig.server.corsOrigins);

  const runner = new ScenarioOrchestrator(rootDir);
  const envConfigService = new EnvConfigService(rootDir);
  const caseService = new CaseService(runner, rootDir, envConfigService, platformConfig);
  const aiReportService = new AiReportService(rootDir);
  const testRunService = new TestRunService(runner, rootDir, envConfigService, platformConfig, aiReportService);
  const reportService = new ReportService(rootDir, platformConfig);
  const appContextService = new AppContextService(rootDir, platformConfig);
  const dbService = new DbService();
  const platformSettingsService = new PlatformSettingsService(rootDir);

  await registerCaseRoutes(app, caseService, platformConfig);
  await registerTestRunRoutes(app, testRunService, reportService);
  await registerTestRunEventRoutes(app, testRunService);
  await registerAiReportRoutes(app, aiReportService);
  await registerAiRoutes(app, rootDir, platformConfig, aiReportService);
  await registerAppContextRoutes(app, appContextService);
  await registerDbRoutes(app, dbService);
  await registerSettingsRoutes(app, envConfigService, platformSettingsService);

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.status(400).send({ code: 1, message: getErrorMessage(error), data: null });
  });

  return app;
}

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  const rootDir = resolveServerRootDir(options.rootDir ?? process.cwd());
  const platformConfig = loadPlatformConfig(rootDir);
  const host = options.host ?? process.env.SERVER_HOST ?? defaultServerHost(platformConfig);
  const app = await createServer({ rootDir, logger: options.logger });
  const configuredPort = Number(process.env.PORT ?? process.env.SERVER_PORT ?? platformConfig.server.port);
  await app.listen({ port: options.port ?? configuredPort, host });

  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : configuredPort;
  const originHost = host === "0.0.0.0" ? "127.0.0.1" : host;

  return {
    app,
    rootDir,
    host,
    port,
    origin: `http://${originHost}:${port}`,
    close: () => app.close()
  };
}

export function resolveServerRootDir(startDir = process.cwd()): string {
  return findWorkspaceRoot(startDir);
}

function findWorkspaceRoot(startDir: string): string {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.resolve(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

function registerCors(app: FastifyInstance, allowedOrigins: PlatformConfig["server"]["corsOrigins"]): void {
  app.addHook("onRequest", (request, reply, done) => {
    const origin = request.headers.origin;
    const allowedOrigin = resolveCorsOrigin(typeof origin === "string" ? origin : undefined, allowedOrigins);
    if (origin && !allowedOrigin) {
      reply.status(403).send({ code: 1, message: "Origin 不允许访问本地测试服务", data: null });
      return;
    }
    if (allowedOrigin) {
      reply.header("Access-Control-Allow-Origin", allowedOrigin);
      reply.header("Vary", "Origin");
    }
    reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "content-type,authorization");
    if (request.method === "OPTIONS") {
      reply.status(204).send();
      return;
    }
    done();
  });
}

function resolveCorsOrigin(origin: string | undefined, allowedOrigins: string[]): string | undefined {
  if (allowedOrigins.includes("*")) {
    return "*";
  }
  if (origin && allowedOrigins.includes(origin)) {
    return origin;
  }
  return undefined;
}

function loadEnvFileIntoProcess(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const content = fs.readFileSync(filePath, "utf8");
  for (const [key, value] of parseEnvFileContent(content)) {
    process.env[key] = value;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (shouldStartHttpServer()) {
  const rootDir = resolveServerRootDir();
  const platformConfig = loadPlatformConfig(rootDir);
  const port = Number(process.env.PORT ?? process.env.SERVER_PORT ?? platformConfig.server.port);
  const host = process.env.SERVER_HOST ?? defaultServerHost(platformConfig);
  void startServer({ rootDir, port, host }).catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

export function shouldStartHttpServer(input: { argvEntry?: string; isVercel?: boolean } = {}): boolean {
  return isDirectRun(input.argvEntry ?? process.argv[1]);
}

function isDirectRun(entry: string | undefined): boolean {
  if (!entry) {
    return false;
  }
  return path.resolve(entry).replace(/\\/g, "/").endsWith("/apps/server/src/index.ts");
}

function defaultServerHost(platformConfig: PlatformConfig): string {
  return process.env.VERCEL ? "0.0.0.0" : platformConfig.server.host;
}
