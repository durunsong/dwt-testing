import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ScenarioLoader, validateScenarioContent } from "./scenario-loader";

describe("ScenarioLoader compatibility", () => {
  it("normalizes phased scenario content before validation", () => {
    const result = validateScenarioContent([
      "caseId: phased_case",
      "caseName: Phased Case",
      "mode: api",
      "sessions:",
      "  - name: user",
      "    login_url: \"https://example.test/login\"",
      "locations:",
      "  file: cases/location/login.user.yaml",
      "beforeActions:",
      "  - id: before_query",
      "    name: before query",
      "    type: api_call",
      "    params:",
      "      url: https://api.example.test/health",
      "mainSteps:",
      "  - id: main_query",
      "    name: main query",
      "    type: api_call",
      "    params:",
      "      url: https://api.example.test/users",
      "afterActions:",
      "  - id: after_query",
      "    name: after query",
      "    type: api_call",
      "    params:",
      "      url: https://api.example.test/cleanup",
      ""
    ].join("\n"));

    assert.equal(result.valid, true);
    assert.equal(result.caseId, "phased_case");
    assert.equal(result.data?.steps.length, 3);
    assert.equal(result.data?.steps[0]?.phase, "beforeActions");
    assert.equal(result.data?.steps[0]?.step_id, "before_query");
    assert.equal(result.data?.steps[0]?.type, "api_request");
    assert.equal(result.data?.steps[2]?.phase, "afterActions");
  });

  it("defaults old scenarios without case_type to uncategorized", () => {
    const result = validateScenarioContent([
      "case_id: old_case",
      "case_name: Old Case",
      "mode: web",
      "sessions:",
      "  - name: user",
      "    login_url: \"https://example.test/login\"",
      "locations:",
      "  file: cases/location/login.user.yaml",
      "steps:",
      "  - step_id: open_page",
      "    name: open page",
      "    type: web_open",
      "    session: user",
      "    url: \"${session.login_url}\"",
      ""
    ].join("\n"));

    assert.equal(result.valid, true);
    assert.equal(result.data?.case_type, "uncategorized");
  });

  it("reads case_type from scenario yaml", () => {
    const result = validateScenarioContent([
      "case_id: typed_case",
      "case_name: Typed Case",
      "case_type: smoke",
      "mode: web",
      "sessions:",
      "  - name: user",
      "    login_url: \"https://example.test/login\"",
      "locations:",
      "  file: cases/location/login.user.yaml",
      "steps:",
      "  - step_id: open_page",
      "    name: open page",
      "    type: web_open",
      "    session: user",
      "    url: \"${session.login_url}\"",
      ""
    ].join("\n"));

    assert.equal(result.valid, true);
    assert.equal(result.data?.case_type, "smoke");
  });

  it("preserves custom session fields used by session variables", () => {
    const result = validateScenarioContent([
      "case_id: register_case",
      "case_name: Register Case",
      "mode: web",
      "sessions:",
      "  - name: user",
      "    login_url: \"${env.USER_LOGIN_URL}\"",
      "    register_url: \"${env.USER_REGISTER_URL}\"",
      "locations:",
      "  file: cases/location/register.user.yaml",
      "steps:",
      "  - step_id: open_register",
      "    name: open register",
      "    type: web_open",
      "    session: user",
      "    url: \"${session.register_url}\"",
      ""
    ].join("\n"));

    assert.equal(result.valid, true);
    assert.equal(result.data?.sessions[0]?.register_url, "${env.USER_REGISTER_URL}");
  });

  it("expands shared steps while loading runnable scenarios", async () => {
    const rootDir = await tempWorkspace();
    await fs.mkdir(path.join(rootDir, "cases", "scenario"), { recursive: true });
    await fs.mkdir(path.join(rootDir, "cases", "shared", "common"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "cases", "shared", "common", "open.yaml"), [
      "sharedId: common/open",
      "params:",
      "  url:",
      "    required: true",
      "phases:",
      "  mainSteps:",
      "    - step_id: open_page",
      "      name: open page",
      "      type: web_open",
      "      session: user",
      "      url: \"${url}\"",
      ""
    ].join("\n"), "utf8");

    const scenarioPath = path.join(rootDir, "cases", "scenario", "shared_case.yaml");
    await fs.writeFile(scenarioPath, [
      "case_id: shared_case",
      "case_name: Shared Case",
      "mode: web",
      "sessions:",
      "  - name: user",
      "    login_url: \"https://example.test/login\"",
      "locations:",
      "  file: cases/location/login.user.yaml",
      "mainSteps:",
      "  - use: common/open",
      "    with:",
      "      url: \"${session.login_url}\"",
      ""
    ].join("\n"), "utf8");

    const scenario = await new ScenarioLoader(rootDir).load(scenarioPath);

    assert.equal(scenario.steps.length, 1);
    assert.equal(scenario.steps[0]?.step_id, "mainSteps_common_open_1_open_page");
    assert.equal(scenario.steps[0]?.url, "${session.login_url}");
    assert.equal(scenario.steps[0]?.phase, "mainSteps");
  });
});

async function tempWorkspace(): Promise<string> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dwt-loader-"));
  await fs.mkdir(path.join(rootDir, "cases", "location"), { recursive: true });
  await fs.writeFile(path.join(rootDir, "cases", "location", "login.user.yaml"), [
    "user_home_marker:",
    "  text: Home",
    ""
  ].join("\n"), "utf8");
  return rootDir;
}
