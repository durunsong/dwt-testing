export const ALLOWED_TEST_ENVS = ["local", "dev", "sit", "prod"] as const;

export type TestEnv = (typeof ALLOWED_TEST_ENVS)[number];

export const DEFAULT_TEST_ENV: TestEnv = "sit";

export const BLOCKED_ENVS = ["prod", "production"] as const;

export const SENSITIVE_KEYS = [
  "password",
  "token",
  "authorization",
  "cookie",
  "set-cookie",
  "secret",
  "apikey",
  "apiKey"
] as const;
