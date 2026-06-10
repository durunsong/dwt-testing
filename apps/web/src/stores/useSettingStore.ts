import { create } from "zustand";
import { DEFAULT_TEST_ENV, type TestEnv, type VideoMode } from "../types/settings";

interface SettingState {
  env: TestEnv;
  headless: boolean;
  slowMo: number;
  trace: boolean;
  screenshot: boolean;
  video: VideoMode;
  flowLoginTimeoutMs: number;
  visualMode: boolean;
  apiBusinessCodeStrict: boolean;
  setEnv: (env: TestEnv) => void;
  setHeadless: (headless: boolean) => void;
  setSlowMo: (slowMo: number) => void;
  setTrace: (trace: boolean) => void;
  setScreenshot: (screenshot: boolean) => void;
  setVideo: (video: VideoMode) => void;
  setFlowLoginTimeoutMs: (flowLoginTimeoutMs: number) => void;
  setVisualMode: (visualMode: boolean) => void;
  setApiBusinessCodeStrict: (apiBusinessCodeStrict: boolean) => void;
}

const storageKey = import.meta.env.VITE_APP_STORAGE_KEY || "dwt-testing-settings";
const saved = readSettings();

export const useSettingStore = create<SettingState>((set) => ({
  env: saved.env ?? DEFAULT_TEST_ENV,
  headless: saved.headless ?? false,
  slowMo: saved.slowMo ?? 100,
  trace: saved.trace ?? true,
  screenshot: saved.screenshot ?? true,
  video: saved.video ?? "retain-on-failure",
  flowLoginTimeoutMs: saved.flowLoginTimeoutMs ?? 3000,
  visualMode: saved.visualMode ?? false,
  apiBusinessCodeStrict: saved.apiBusinessCodeStrict ?? true,
  setEnv: (env) => setAndPersist(set, { env }),
  setHeadless: (headless) => setAndPersist(set, { headless }),
  setSlowMo: (slowMo) => setAndPersist(set, { slowMo }),
  setTrace: (trace) => setAndPersist(set, { trace }),
  setScreenshot: (screenshot) => setAndPersist(set, { screenshot }),
  setVideo: (video) => setAndPersist(set, { video }),
  setFlowLoginTimeoutMs: (flowLoginTimeoutMs) => setAndPersist(set, { flowLoginTimeoutMs }),
  setVisualMode: (visualMode) => setAndPersist(set, { visualMode }),
  setApiBusinessCodeStrict: (apiBusinessCodeStrict) => setAndPersist(set, { apiBusinessCodeStrict })
}));

function setAndPersist(set: (partial: Partial<SettingState>) => void, partial: Partial<SettingState>) {
  set(partial);
  const current = { ...readSettings(), ...partial };
  window.localStorage.setItem(storageKey, JSON.stringify(current));
}

function readSettings(): Partial<SettingState> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(storageKey) || "{}") as Partial<SettingState>;
  } catch {
    return {};
  }
}
