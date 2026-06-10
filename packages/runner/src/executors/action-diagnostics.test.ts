import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInputValueDiagnostic,
  isProtectedInputTarget,
  isPhoneInputTarget,
  normalizePhoneInputValue
} from "./action-diagnostics";

test("keeps login account values readable for AI parameter analysis", () => {
  const diagnostic = buildInputValueDiagnostic({
    phase: "before_click",
    stepId: "click_login",
    stepName: "点击登录",
    stepType: "web_click",
    target: "admin_login_username",
    expectedValue: "admin@example.com",
    actualValue: "other@example.com"
  });

  assert.equal(diagnostic.kind, "input_value");
  assert.equal(diagnostic.matched, false);
  assert.equal(diagnostic.protected, false);
  assert.equal(diagnostic.expectedValue, "admin@example.com");
  assert.equal(diagnostic.actualValue, "other@example.com");
  assert.equal(diagnostic.expectedSummary, undefined);
  assert.equal(diagnostic.actualSummary, undefined);
});

test("protects password and token values while preserving mismatch evidence", () => {
  const diagnostic = buildInputValueDiagnostic({
    phase: "after_input",
    stepId: "input_password",
    stepName: "输入密码",
    stepType: "web_input",
    target: "user_login_password",
    expectedValue: "secret1",
    actualValue: "secret12"
  });

  assert.equal(isProtectedInputTarget("user_login_password"), true);
  assert.equal(diagnostic.protected, true);
  assert.equal(diagnostic.expectedValue, undefined);
  assert.equal(diagnostic.actualValue, undefined);
  assert.deepEqual(diagnostic.expectedSummary, { empty: false, length: 7 });
  assert.deepEqual(diagnostic.actualSummary, { empty: false, length: 8 });
});

test("keeps non-sensitive form values readable for failure diagnosis", () => {
  const diagnostic = buildInputValueDiagnostic({
    phase: "after_input",
    stepId: "input_amount",
    stepName: "输入金额",
    stepType: "web_input",
    target: "withdraw_amount",
    expectedValue: "100",
    actualValue: "10"
  });

  assert.equal(isProtectedInputTarget("withdraw_amount"), false);
  assert.equal(diagnostic.protected, false);
  assert.equal(diagnostic.expectedValue, "100");
  assert.equal(diagnostic.actualValue, "10");
  assert.equal(diagnostic.matched, false);
});

test("treats formatted register phone values as equivalent", () => {
  assert.equal(isPhoneInputTarget("register_input_phone"), true);
  assert.equal(normalizePhoneInputValue("139 1011 5242"), "13910115242");

  const diagnostic = buildInputValueDiagnostic({
    phase: "before_click",
    stepId: "submit_register",
    stepName: "点击注册",
    stepType: "web_click",
    target: "register_input_phone",
    expectedValue: "13910115242",
    actualValue: "139 1011 5242"
  });

  assert.equal(diagnostic.matched, true);
  assert.equal(diagnostic.expectedValue, "13910115242");
  assert.equal(diagnostic.actualValue, "139 1011 5242");
});
