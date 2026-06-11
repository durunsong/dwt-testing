import { ALLOWED_TEST_ENVS, BLOCKED_ENVS, type ScenarioCase, type TestEnv } from "@ai-e2e/shared";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const TEST_SUBDOMAIN_LABELS = new Set(["local", "dev", "sit", "uat", "test", "staging", "pre", "qa", "preview"]);

function isPrivateOrLocalHost(hostname: string): boolean {
  if (LOCAL_HOSTNAMES.has(hostname)) {
    return true;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return true;
  }
  return hostname.includes(":");
}

function isBlockedProductionHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (isPrivateOrLocalHost(lower)) {
    return false;
  }

  const firstLabel = lower.split(".")[0] ?? "";
  if (TEST_SUBDOMAIN_LABELS.has(firstLabel)) {
    return false;
  }

  if (/prod/i.test(lower) || /production/i.test(lower)) {
    return true;
  }
  if (/\.com\.cn$/i.test(lower)) {
    return true;
  }
  if (lower === "dowalet.com" || lower.endsWith(".dowalet.com")) {
    return true;
  }

  return false;
}

export class EnvGuard {
  static assertRunnable(env: string, scenario?: ScenarioCase): asserts env is TestEnv {
    if ((BLOCKED_ENVS as readonly string[]).includes(env)) {
      throw new Error(`禁止在 ${env} 环境执行自动化流程`);
    }

    if (!(ALLOWED_TEST_ENVS as readonly string[]).includes(env)) {
      throw new Error(`不支持的执行环境：${env}，仅允许 ${ALLOWED_TEST_ENVS.join(", ")}`);
    }

    if (scenario) {
      for (const session of scenario.sessions) {
        EnvGuard.assertNonProductionUrl(session.login_url);
      }
    }
  }

  static assertNonProductionUrl(urlValue: string): void {
    if (!urlValue || urlValue.includes("${")) {
      return;
    }
    const url = new URL(urlValue);
    if (isBlockedProductionHost(url.hostname)) {
      throw new Error(`疑似生产域名被拦截：${url.hostname}`);
    }
  }
}
