import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { EnvConfigService } from "./env-config.service";

test("EnvConfigService merges template, base and env-specific values", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "env-config-"));
  await fs.writeFile(path.join(rootDir, ".env.example"), "TEST_ENV=local\nUSER_LOGIN_URL=\nUSER_PASSWORD=\n", "utf8");
  await fs.writeFile(path.join(rootDir, ".env"), "USER_LOGIN_URL=http://base.local\nUSER_PASSWORD=base-password\n", "utf8");

  const service = new EnvConfigService(rootDir);
  const config = await service.get("dev");

  assert.equal(config.fileName, ".env");
  assert.equal(config.exists, true);
  assert.equal(config.variables.find((item) => item.key === "USER_LOGIN_URL")?.value, "http://base.local");
  assert.equal(config.variables.find((item) => item.key === "USER_PASSWORD")?.source, "file");
  assert.deepEqual(config.missingKeys, ["TEST_ENV"]);
});

test("EnvConfigService saves env files and applies selected env to process.env", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "env-config-"));
  await fs.writeFile(path.join(rootDir, ".env.example"), "TEST_ENV=local\nUSER_LOGIN_URL=\n", "utf8");
  await fs.writeFile(path.join(rootDir, ".env"), "USER_LOGIN_URL=http://base.local\n", "utf8");

  const service = new EnvConfigService(rootDir);
  await service.save("sit", [
    { key: "TEST_ENV", value: "sit" },
    { key: "USER_LOGIN_URL", value: "http://sit.local" }
  ]);
  await service.applyToProcess("sit");

  assert.equal(await fs.readFile(path.join(rootDir, ".env.sit"), "utf8").then((content) => content.includes("USER_LOGIN_URL=http://sit.local")), true);
  assert.equal(process.env.TEST_ENV, "sit");
  assert.equal(process.env.USER_LOGIN_URL, "http://sit.local");
});

test("EnvConfigService reads and saves raw env file content", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "env-config-"));
  await fs.writeFile(path.join(rootDir, ".env.example"), "TEST_ENV=local\nUSER_LOGIN_URL=\n", "utf8");

  const service = new EnvConfigService(rootDir);
  const missing = await service.getContent("local");
  assert.equal(missing.exists, false);
  assert.equal(missing.content, "");

  const saved = await service.saveContent("local", "# local env\nTEST_ENV=local\r\nUSER_LOGIN_URL=http://local.test\n");
  const raw = await service.getContent("local");

  assert.equal(saved.variables.find((item) => item.key === "USER_LOGIN_URL")?.value, "http://local.test");
  assert.equal(raw.exists, true);
  assert.match(raw.content, /USER_LOGIN_URL=http:\/\/local\.test/);
  assert.equal(process.env.TEST_ENV, "local");
  assert.equal(process.env.USER_LOGIN_URL, "http://local.test");
});

test("EnvConfigService preserves hash routes in env urls", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "env-config-"));
  await fs.writeFile(path.join(rootDir, ".env.example"), "USER_REGISTER_URL=\n", "utf8");
  await fs.writeFile(
    path.join(rootDir, ".env.sit"),
    "USER_REGISTER_URL=https://sit.dowalet.com/user/#/register\n",
    "utf8"
  );

  const service = new EnvConfigService(rootDir);
  await service.applyToProcess("sit");

  assert.equal(process.env.USER_REGISTER_URL, "https://sit.dowalet.com/user/#/register");
});

test("EnvConfigService imports env content over the saved environment file", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "env-config-"));
  await fs.writeFile(path.join(rootDir, ".env.example"), "ADMIN_USERNAME=\nADMIN_PASSWORD=\nUSER_USERNAME=\nUSER_PASSWORD=\n", "utf8");
  await fs.writeFile(path.join(rootDir, ".env.local"), "ADMIN_USERNAME=\nADMIN_PASSWORD=\nUSER_USERNAME=\nUSER_PASSWORD=\n", "utf8");

  const service = new EnvConfigService(rootDir);
  const config = await service.importContent(
    "local",
    [
      "ADMIN_USERNAME=admin-user",
      "ADMIN_PASSWORD=admin-password",
      "USER_USERNAME=user",
      "USER_PASSWORD=user-password"
    ].join("\n")
  );

  assert.equal(config.variables.find((item) => item.key === "ADMIN_USERNAME")?.value, "admin-user");
  assert.equal(config.variables.find((item) => item.key === "ADMIN_PASSWORD")?.value, "admin-password");
  assert.match(await fs.readFile(path.join(rootDir, ".env.local"), "utf8"), /ADMIN_USERNAME=admin-user/);
});
