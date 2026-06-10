import { resolveRecordValues, resolveVariables, type ScenarioCase, type ScenarioSession } from "@ai-e2e/shared";
import { RuntimeContext } from "./runtime-context";

export class ContextManager {
  create(runId: string, env: string, scenario: ScenarioCase): RuntimeContext {
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const sessionMap = Object.fromEntries(scenario.sessions.map((session) => [session.name, session])) as Record<string, ScenarioSession>;
    const seed = new RuntimeContext({ runId, env, scenario, timestamp, variables: {}, sessions: sessionMap });

    const variables = Object.fromEntries(
      Object.entries(scenario.variables ?? {}).map(([key, value]) => [key, resolveVariables(value, seed.state)])
    );

    seed.state.variables = variables;
    seed.state.sessions = Object.fromEntries(
      scenario.sessions.map((session) => [
        session.name,
        resolveRecordValues(session, seed.state)
      ])
    );

    return seed;
  }
}
