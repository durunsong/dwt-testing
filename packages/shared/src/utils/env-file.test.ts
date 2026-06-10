import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEnvFileContent, serializeEnvValue, unquoteEnvValue } from "./env-file";

describe("env-file", () => {
  it("preserves hash routes in unquoted env urls", () => {
    const values = parseEnvFileContent([
      "USER_LOGIN_URL=https://sit.dowalet.com/user/#/login",
      "USER_REGISTER_URL=https://sit.dowalet.com/user/#/register"
    ].join("\n"));

    assert.equal(values.get("USER_LOGIN_URL"), "https://sit.dowalet.com/user/#/login");
    assert.equal(values.get("USER_REGISTER_URL"), "https://sit.dowalet.com/user/#/register");
  });

  it("supports quoted env values with hash routes", () => {
    const values = parseEnvFileContent("USER_REGISTER_URL=\"https://sit.dowalet.com/user/#/register\"");
    assert.equal(values.get("USER_REGISTER_URL"), "https://sit.dowalet.com/user/#/register");
    assert.equal(unquoteEnvValue(JSON.stringify("https://sit.dowalet.com/user/#/register")), "https://sit.dowalet.com/user/#/register");
  });

  it("serializes values containing hash fragments", () => {
    assert.equal(
      serializeEnvValue("https://sit.dowalet.com/user/#/register"),
      "\"https://sit.dowalet.com/user/#/register\""
    );
  });
});
