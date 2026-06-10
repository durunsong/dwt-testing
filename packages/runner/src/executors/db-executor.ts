import { ALLOWED_TEST_ENVS, DEFAULT_TEST_ENV, maskSensitive } from "@ai-e2e/shared";

export interface DbExecutorOptions {
  env: string;
  enabled: boolean;
}

export interface DbHealthResult {
  enabled: boolean;
  ok: boolean;
  host?: string;
  port?: number;
  database?: string;
  message: string;
}

type DbParam = string | number | boolean | Date | Buffer | null;

export class DbExecutor {
  constructor(private readonly options: DbExecutorOptions = {
    env: process.env.TEST_ENV ?? DEFAULT_TEST_ENV,
    enabled: process.env.DB_ENABLED === "true"
  }) {}

  async execute<T extends Record<string, unknown> = Record<string, unknown>>(sql?: string, params: DbParam[] = []): Promise<T[]> {
    this.assertEnabled();
    this.assertSafeSql(sql);

    const mysql = await import("mysql2/promise");
    const connection = await mysql.createConnection(this.connectionConfig());
    try {
      const [rows] = await connection.execute(sql!, params);
      return rows as T[];
    } finally {
      await connection.end();
    }
  }

  async health(): Promise<DbHealthResult> {
    if (!this.options.enabled) {
      return { enabled: false, ok: false, message: "DB_ENABLED 未开启" };
    }
    try {
      await this.execute("select 1 as ok");
      return {
        enabled: true,
        ok: true,
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 3306),
        database: process.env.DB_NAME,
        message: "数据库连接可用"
      };
    } catch (error) {
      return {
        enabled: true,
        ok: false,
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT ?? 3306),
        database: process.env.DB_NAME,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private assertEnabled(): void {
    if (!this.options.enabled) {
      throw new Error("P0/P1 DB 能力未开启：请设置 DB_ENABLED=true");
    }
    if (!(ALLOWED_TEST_ENVS as readonly string[]).includes(this.options.env)) {
      throw new Error(`当前环境禁止执行 DB 查询：${this.options.env}`);
    }
  }

  private assertSafeSql(sql?: string): void {
    if (!sql?.trim()) {
      throw new Error("SQL 不能为空");
    }
    if (/\b(drop|truncate|alter|create|insert|replace|update|delete|grant|revoke)\b/i.test(sql)) {
      if (/\b(update|delete)\b/i.test(sql) && !/\bwhere\b/i.test(sql)) {
        throw new Error("无 WHERE 的 update/delete 已被拦截");
      }
      throw new Error("危险 SQL 已被拦截");
    }
    if (!/^\s*(select|show|desc|describe|explain)\b/i.test(sql)) {
      throw new Error("DB 执行器只允许 select/show/desc/describe/explain 只读语句");
    }
  }

  private connectionConfig() {
    const config = {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 3306),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectTimeout: 5000
    };

    const missing = Object.entries(config)
      .filter(([key, value]) => key !== "connectTimeout" && (value === undefined || value === ""))
      .map(([key]) => key);
    if (missing.length) {
      throw new Error(`数据库配置缺失：${missing.join(", ")}`);
    }

    maskSensitive(config);
    return config;
  }
}
