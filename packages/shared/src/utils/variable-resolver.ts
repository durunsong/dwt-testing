import type { ScenarioSession } from "../types/case";
import type { RuntimeContextState } from "../types/context";
import type { ScenarioStep } from "../types/step";

const variablePattern = /\$\{([^}]+)\}/g;

export function resolveVariables(input: string | undefined, state: RuntimeContextState, step?: ScenarioStep): string {
  if (input === undefined) {
    return "";
  }

  return input.replace(variablePattern, (_, expression: string) => {
    return resolveExpression(expression.trim(), state, step);
  });
}

export function resolveRecordValues<T extends object>(record: T, state: RuntimeContextState, step?: ScenarioStep): T {
  const resolved = Object.entries(record as Record<string, unknown>).map(([key, value]) => {
    if (typeof value === "string") {
      return [key, resolveVariables(value, state, step)];
    }
    return [key, value];
  });

  return Object.fromEntries(resolved) as T;
}

function resolveExpression(expression: string, state: RuntimeContextState, step?: ScenarioStep): string {
  if (expression === "timestamp") {
    return state.timestamp;
  }
  if (expression === "timestamp8") {
    return state.timestamp.slice(-8);
  }
  if (expression === "mail_email" || expression === "kyc_mail_email" || expression === "kyc_apv_mail_email") {
    return randomTestEmail();
  }
  if (expression === "runId") {
    return state.runId;
  }
  if (expression.startsWith("env.")) {
    return readRequired(process.env[expression.slice(4)], expression);
  }
  if (expression.startsWith("var.")) {
    return readRequired(state.variables[expression.slice(4)], expression);
  }
  if (expression.startsWith("session.")) {
    const session = readCurrentSession(state, step);
    return readRequired(session[expression.slice(8) as keyof ScenarioSession], expression);
  }

  throw new Error(`不支持的变量表达式：\${${expression}}`);
}

function readCurrentSession(state: RuntimeContextState, step?: ScenarioStep): ScenarioSession {
  if (!step?.session) {
    throw new Error("解析 session 变量失败：当前步骤未指定 session");
  }
  const session = state.sessions[step.session];
  if (!session) {
    throw new Error(`解析 session 变量失败：未找到 ${step.session} 会话配置`);
  }
  return session;
}

/**
 * 6 位数字 + 6 位小写字母 + @qq.com。
 * 对齐后端 StringUtil.isLegalEmail（本地段仅 \w）与 SIT 常用测试邮箱域名。
 */
export function randomTestEmail(): string {
  const digits = Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join("");
  const letters = Array.from({ length: 6 }, () => {
    const code = 97 + Math.floor(Math.random() * 26);
    return String.fromCharCode(code);
  }).join("");
  return `${digits}${letters}@qq.com`;
}

/** 与后端 StringUtil.isLegalEmail 一致：本地段仅字母数字下划线及 .-+ */
export function matchesBackendLegalEmail(email: string): boolean {
  return /^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/.test(email);
}

function readRequired(value: unknown, expression: string): string {
  if (value === undefined || value === null || value === "") {
    throw new Error(`变量缺失：\${${expression}}`);
  }
  return String(value);
}
