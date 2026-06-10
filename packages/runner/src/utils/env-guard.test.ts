import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EnvGuard } from "./env-guard";

describe("EnvGuard.assertNonProductionUrl", () => {
  it("allows sit and other test subdomains on dowalet.com", () => {
    for (const url of [
      "https://sit.dowalet.com/user/#/login",
      "https://dev.dowalet.com/admin/",
      "https://uat.dowalet.com/user/",
      "https://test.dowalet.com/user/",
      "https://staging.dowalet.com/user/"
    ]) {
      assert.doesNotThrow(() => EnvGuard.assertNonProductionUrl(url), url);
    }
  });

  it("allows localhost and private IPs", () => {
    for (const url of [
      "http://localhost:5173/admin/",
      "http://127.0.0.1:5173/admin/",
      "http://192.168.1.10/admin/"
    ]) {
      assert.doesNotThrow(() => EnvGuard.assertNonProductionUrl(url), url);
    }
  });

  it("blocks production-like dowalet domains", () => {
    for (const url of [
      "https://dowalet.com/user/",
      "https://www.dowalet.com/user/",
      "https://app.dowalet.com/user/",
      "https://prod.dowalet.com/user/",
      "https://production.dowalet.com/user/"
    ]) {
      assert.throws(() => EnvGuard.assertNonProductionUrl(url), /疑似生产域名被拦截/u);
    }
  });

  it("blocks prod markers and .com.cn domains", () => {
    for (const url of [
      "https://prod.example.com/login",
      "https://api.production.example.com/login",
      "https://www.example.com.cn/login"
    ]) {
      assert.throws(() => EnvGuard.assertNonProductionUrl(url), /疑似生产域名被拦截/u);
    }
  });

  it("skips unresolved template urls", () => {
    assert.doesNotThrow(() => EnvGuard.assertNonProductionUrl("${env.USER_LOGIN_URL}"));
  });
});
