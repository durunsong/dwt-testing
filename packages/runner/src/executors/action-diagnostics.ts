import type { ScenarioStep } from "@ai-e2e/shared";

export type ActionDiagnosticPhase = "after_input" | "before_click";

export interface InputValueDiagnostic {
  kind: "input_value";
  phase: ActionDiagnosticPhase;
  stepId?: string;
  stepName?: string;
  stepType?: string;
  target?: string;
  protected: boolean;
  matched: boolean;
  expectedValue?: string;
  actualValue?: string;
  expectedSummary?: ValueSummary;
  actualSummary?: ValueSummary;
  checkedAt: string;
}

export interface ValueSummary {
  empty: boolean;
  length: number;
}

export interface BuildInputValueDiagnosticInput {
  phase: ActionDiagnosticPhase;
  stepId?: string;
  stepName?: string;
  stepType?: string;
  target?: string;
  expectedValue: string;
  actualValue: string;
  checkedAt?: string;
}

export interface TrackedInput {
  step: ScenarioStep;
  expectedValue: string;
}

const protectedInputPattern = /(?:password|passwd|pwd|token|secret|cookie|authorization|api[_-]?key|access[_-]?key|密码|令牌|密钥)/i;

export function isPhoneInputTarget(target: string | undefined): boolean {
  return target === "register_input_phone";
}

/** Maz 手机号组件会在展示层插入空格，比较时应忽略空白与连字符。 */
export function normalizePhoneInputValue(value: string): string {
  return value.replace(/[\s-]/g, "");
}

export function buildInputValueDiagnostic(input: BuildInputValueDiagnosticInput): InputValueDiagnostic {
  const protectedValue = isProtectedInputTarget(input.target);
  const comparableExpected = isPhoneInputTarget(input.target)
    ? normalizePhoneInputValue(input.expectedValue)
    : input.expectedValue;
  const comparableActual = isPhoneInputTarget(input.target)
    ? normalizePhoneInputValue(input.actualValue)
    : input.actualValue;
  const base = {
    kind: "input_value" as const,
    phase: input.phase,
    stepId: input.stepId,
    stepName: input.stepName,
    stepType: input.stepType,
    target: input.target,
    protected: protectedValue,
    matched: comparableExpected === comparableActual,
    checkedAt: input.checkedAt ?? new Date().toISOString()
  };

  if (protectedValue) {
    return {
      ...base,
      expectedSummary: summarizeValue(input.expectedValue),
      actualSummary: summarizeValue(input.actualValue)
    };
  }

  return {
    ...base,
    expectedValue: input.expectedValue,
    actualValue: input.actualValue
  };
}

export function isProtectedInputTarget(target: string | undefined): boolean {
  return protectedInputPattern.test(target ?? "");
}

function summarizeValue(value: string): ValueSummary {
  return {
    empty: value.length === 0,
    length: value.length
  };
}
