import assert from "node:assert/strict";
import test from "node:test";
import { matchesBackendLegalEmail, resolveVariables, type ScenarioCase } from "@ai-e2e/shared";
import { ContextManager } from "./context-manager";

test("ContextManager resolves custom session fields", () => {
  const previous = process.env.USER_REGISTER_URL;
  process.env.USER_REGISTER_URL = "https://example.test/register";

  try {
    const context = new ContextManager().create("run-1", "local", {
      case_id: "register_case",
      case_name: "Register Case",
      case_type: "auth",
      mode: "web",
      sessions: [
        {
          name: "user",
          login_url: "https://example.test/login",
          register_url: "${env.USER_REGISTER_URL}"
        }
      ],
      locations: { file: "cases/location/register.user.yaml" },
      steps: [
        {
          step_id: "open_register",
          name: "打开注册页",
          type: "web_open",
          session: "user",
          url: "${session.register_url}"
        }
      ]
    } satisfies ScenarioCase);

    assert.equal(context.state.sessions.user?.register_url, "https://example.test/register");
    assert.equal(resolveVariables("${session.register_url}", context.state, context.state.scenario.steps[0]), "https://example.test/register");
  } finally {
    if (previous === undefined) {
      delete process.env.USER_REGISTER_URL;
    } else {
      process.env.USER_REGISTER_URL = previous;
    }
  }
});

test("ContextManager builds 11-digit phone from timestamp8", () => {
  const context = new ContextManager().create("run-phone-1", "sit", {
    case_id: "register_phone_login",
    case_name: "手机号注册",
    case_type: "user-main",
    mode: "hybrid",
    sessions: [{ name: "user", login_url: "https://example.test/login" }],
    variables: { phone: "139${timestamp8}" },
    locations: { file: "cases/location/register.user.yaml" },
    steps: []
  } satisfies ScenarioCase);

  assert.equal(context.state.timestamp.length, 14);
  assert.equal(context.state.variables.phone, `139${context.state.timestamp.slice(-8)}`);
  assert.equal(context.state.variables.phone?.length, 11);
});

test("ContextManager resolves random qq.com test emails", () => {
  const context = new ContextManager().create("run-mail-1", "sit", {
    case_id: "register_email_login",
    case_name: "邮箱注册",
    case_type: "user-main",
    mode: "web",
    sessions: [{ name: "user", login_url: "https://example.test/login" }],
    variables: { email: "${mail_email}" },
    locations: { file: "cases/location/register.user.yaml" },
    steps: []
  } satisfies ScenarioCase);

  const email = context.state.variables.email ?? "";
  assert.match(email, /^\d{6}[a-z]{6}@qq\.com$/);
  assert.equal(matchesBackendLegalEmail(email), true);
});
