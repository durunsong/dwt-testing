import type { SessionName } from "../constants/session";
import type { StepType } from "../constants/step-types";

export type StepStatus = "pending" | "running" | "passed" | "failed" | "skipped";
export type ScenarioStepPhase = "beforeActions" | "mainSteps" | "assertions" | "afterActions" | "steps";
export type DbParam = string | number | boolean | null;
export type DbExpected = Record<string, string | number | boolean | null>;
export type ApiExpectedValue = string | number | boolean | null;

export interface ApiWaitConfig {
  url: string;
  method?: string;
  timeout_ms?: number;
  expected_status?: number;
  business_code_path?: string;
  success_codes?: ApiExpectedValue[];
  failure_codes?: ApiExpectedValue[];
  success?: {
    body_path?: string;
    equals?: ApiExpectedValue;
    includes?: string;
  };
}

export interface ApiResponseDiagnostic {
  url: string;
  method: string;
  status: number;
  statusText: string;
  ok: boolean;
  failed?: boolean;
  failureReason?: string;
  contentType?: string;
  requestPostData?: string;
  requestJson?: unknown;
  bodyText?: string;
  bodyJson?: unknown;
  matchedAt: string;
}

export interface AiFailureAnalysis {
  status: "pending" | "completed" | "failed";
  content?: string;
  error?: string;
  generatedAt?: string;
}

export interface ScenarioStep {
  step_id: string;
  name: string;
  type: StepType;
  phase?: ScenarioStepPhase;
  session?: SessionName;
  target?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null>;
  body?: unknown;
  value?: string;
  expected?: string | DbExpected;
  expected_status?: number;
  body_path?: string;
  business_code_path?: string;
  success_codes?: ApiExpectedValue[];
  failure_codes?: ApiExpectedValue[];
  variable?: string;
  save_as?: string;
  sql?: string;
  params?: DbParam[];
  row_index?: number;
  timeout_ms?: number;
  wait_for_network?: boolean;
  wait_for_api?: ApiWaitConfig;
  continue_on_failure?: boolean;
  username?: string;
  password?: string;
  filter_target?: string;
  file?: string;
  extract?: {
    type?: string;
    pattern?: string;
    group?: number;
  };
}

export interface StepResult {
  stepId: string;
  name: string;
  type: StepType;
  session?: SessionName;
  status: StepStatus;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  message?: string;
  error?: string;
  screenshot?: string;
  trace?: string;
  url?: string;
  title?: string;
  data?: unknown;
  aiAnalysis?: AiFailureAnalysis;
}
