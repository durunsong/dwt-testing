import fs from "node:fs/promises";
import path from "node:path";
import { ALLOWED_TEST_ENVS, parseEnvFileContent, serializeEnvValue, type TestEnv } from "@ai-e2e/shared";

export interface EnvVariable {
  key: string;
  value: string;
  comment?: string;
  source: "file" | "base" | "template";
  sensitive: boolean;
}

export interface EnvFileConfig {
  env: TestEnv;
  fileName: string;
  exists: boolean;
  updatedAt?: string;
  variables: EnvVariable[];
  missingKeys: string[];
}

export interface EnvFileContent {
  env: TestEnv;
  fileName: string;
  exists: boolean;
  updatedAt?: string;
  content: string;
}

const ENV_FILE_BY_ENV: Record<TestEnv, string> = {
  local: ".env.local",
  dev: ".env",
  sit: ".env.sit",
  prod: ".env.prod"
};

const SENSITIVE_PATTERN = /(password|token|secret|key|cookie|authorization|apikey)/i;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class EnvConfigService {
  private readonly baseEnvPath: string;
  private readonly templateEnvPath: string;

  constructor(private readonly rootDir: string) {
    this.baseEnvPath = path.resolve(rootDir, ".env");
    this.templateEnvPath = path.resolve(rootDir, ".env.example");
  }

  async list(): Promise<EnvFileConfig[]> {
    return Promise.all(ALLOWED_TEST_ENVS.map((env) => this.get(env)));
  }

  async get(env: TestEnv): Promise<EnvFileConfig> {
    const envFilePath = this.filePath(env);
    const [template, base, current, stat] = await Promise.all([
      this.readEnvFile(this.templateEnvPath),
      this.readEnvFile(this.baseEnvPath),
      this.readEnvFile(envFilePath),
      fs.stat(envFilePath).catch(() => undefined)
    ]);
    const merged = new Map<string, EnvVariable>();

    for (const variable of template.variables) {
      merged.set(variable.key, { ...variable, source: "template" });
    }
    for (const variable of base.variables) {
      merged.set(variable.key, { ...variable, source: "base" });
    }
    for (const variable of current.variables) {
      merged.set(variable.key, { ...variable, source: "file" });
    }

    const missingKeys = template.variables
      .map((variable) => variable.key)
      .filter((key) => !current.values.has(key));

    return {
      env,
      fileName: ENV_FILE_BY_ENV[env],
      exists: current.exists,
      updatedAt: stat?.mtime.toISOString(),
      variables: [...merged.values()],
      missingKeys
    };
  }

  async save(env: TestEnv, variables: Array<Pick<EnvVariable, "key" | "value" | "comment">>): Promise<EnvFileConfig> {
    const normalized = this.normalizeVariables(variables);
    const filePath = this.filePath(env);
    const content = [
      `# ${env} environment config`,
      "# Managed by /settings. Do not commit real secrets.",
      "",
      ...normalized.flatMap((variable) => [
        ...(variable.comment ? variable.comment.split(/\r?\n/).map((line) => `# ${line.replace(/^#\s?/, "")}`) : []),
        `${variable.key}=${serializeEnvValue(variable.value)}`
      ]),
      ""
    ].join("\n");

    await fs.writeFile(filePath, content, "utf8");
    this.applyToProcessFromVariables(normalized);
    process.env.TEST_ENV = env;
    return this.get(env);
  }

  async getContent(env: TestEnv): Promise<EnvFileContent> {
    const filePath = this.filePath(env);
    const [content, stat] = await Promise.all([
      fs.readFile(filePath, "utf8").catch((error: unknown) => {
        if (isNodeError(error) && error.code === "ENOENT") {
          return undefined;
        }
        throw error;
      }),
      fs.stat(filePath).catch(() => undefined)
    ]);

    return {
      env,
      fileName: ENV_FILE_BY_ENV[env],
      exists: content !== undefined,
      updatedAt: stat?.mtime.toISOString(),
      content: content ?? ""
    };
  }

  async saveContent(env: TestEnv, content: string): Promise<EnvFileConfig> {
    const normalizedContent = content.replace(/\r\n?/g, "\n");
    const parsed = this.parseEnvContent(normalizedContent);
    await fs.writeFile(this.filePath(env), normalizedContent, "utf8");
    this.applyToProcessFromVariables(parsed.variables);
    process.env.TEST_ENV = env;
    return this.get(env);
  }

  async importContent(env: TestEnv, content: string): Promise<EnvFileConfig> {
    const current = await this.get(env);
    const imported = this.parseEnvContent(content).variables;
    if (!imported.length) {
      throw new Error("上传的 env 文件中未解析到有效环境变量");
    }

    const merged = new Map<string, Pick<EnvVariable, "key" | "value" | "comment">>();
    for (const variable of current.variables) {
      merged.set(variable.key, {
        key: variable.key,
        value: variable.value,
        comment: variable.comment
      });
    }
    for (const variable of imported) {
      merged.set(variable.key, {
        key: variable.key,
        value: variable.value,
        comment: variable.comment
      });
    }

    return this.save(env, [...merged.values()]);
  }

  async applyToProcess(env: TestEnv): Promise<void> {
    const base = await this.readEnvFile(this.baseEnvPath);
    const current = await this.readEnvFile(this.filePath(env));
    this.applyToProcessFromVariables([...base.variables, ...current.variables]);
    process.env.TEST_ENV = env;
  }

  filePath(env: TestEnv): string {
    return path.resolve(this.rootDir, ENV_FILE_BY_ENV[env]);
  }

  private async readEnvFile(filePath: string): Promise<{ exists: boolean; variables: EnvVariable[]; values: Map<string, string> }> {
    const content = await fs.readFile(filePath, "utf8").catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    });

    if (content === undefined) {
      return { exists: false, variables: [], values: new Map() };
    }

    const parsed = this.parseEnvContent(content);

    return { exists: true, variables: parsed.variables, values: parsed.values };
  }

  private parseEnvContent(content: string): { variables: EnvVariable[]; values: Map<string, string> } {
    const parsed = parseEnvFileContent(content);
    const comments = collectComments(content);
    const variables = this.normalizeVariables(
      [...parsed.entries()].map(([key, value]) => ({
        key,
        value,
        comment: comments.get(key)
      }))
    );

    return { variables, values: parsed };
  }

  private normalizeVariables(variables: Array<Pick<EnvVariable, "key" | "value" | "comment">>): EnvVariable[] {
    const result: EnvVariable[] = [];
    const seen = new Set<string>();
    for (const variable of variables) {
      const key = variable.key.trim();
      if (!key) continue;
      if (!ENV_KEY_PATTERN.test(key)) {
        throw new Error(`环境变量名不合法：${key}`);
      }
      if (seen.has(key)) {
        throw new Error(`环境变量名重复：${key}`);
      }
      if (variable.value.includes("\n") || variable.value.includes("\r")) {
        throw new Error(`环境变量值不能包含换行：${key}`);
      }
      seen.add(key);
      result.push({
        key,
        value: variable.value,
        comment: variable.comment?.trim(),
        source: "file",
        sensitive: isSensitiveKey(key)
      });
    }
    return result;
  }

  private applyToProcessFromVariables(variables: Array<Pick<EnvVariable, "key" | "value">>): void {
    for (const variable of variables) {
      process.env[variable.key] = variable.value;
    }
  }
}

export function normalizeTestEnv(env: string): TestEnv {
  if ((ALLOWED_TEST_ENVS as readonly string[]).includes(env)) {
    return env as TestEnv;
  }
  throw new Error(`不支持的环境：${env}`);
}

function collectComments(content: string): Map<string, string> {
  const comments = new Map<string, string>();
  const pending: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      pending.length = 0;
      continue;
    }
    if (trimmed.startsWith("#")) {
      pending.push(trimmed.replace(/^#\s?/, ""));
      continue;
    }
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match?.[1]) {
      if (pending.length) {
        comments.set(match[1], pending.join("\n"));
      }
      pending.length = 0;
    }
  }
  return comments;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERN.test(key);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
