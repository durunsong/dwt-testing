import type { SessionName } from "../constants/session";
import type { ScenarioStep } from "./step";

export type ScenarioMode = "web" | "api" | "hybrid";

export interface ScenarioSession {
  [key: string]: string | undefined;
  name: SessionName;
  login_url: string;
  username?: string;
  password?: string;
}

export interface ScenarioCase {
  case_id: string;
  case_name: string;
  case_type: string;
  description?: string;
  mode: ScenarioMode;
  defaults?: {
    step_timeout_ms?: number;
    wait_for_network?: boolean;
    manual_review_on_failure?: boolean;
  };
  sessions: ScenarioSession[];
  variables?: Record<string, string>;
  locations: {
    file: string;
  };
  upload_slots?: ScenarioStep[];
  steps: ScenarioStep[];
}

export type LocatorFallback =
  | { role: string; name?: string }
  | { label: string }
  | { placeholder: string }
  | { text: string }
  | { name: string }
  | { css: string }
  | { xpath: string };

export interface LocationDefinition {
  testId?: string;
  role?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  name?: string;
  css?: string;
  xpath?: string;
  fallback?: LocatorFallback[];
}

export type LocationMap = Record<string, LocationDefinition>;
