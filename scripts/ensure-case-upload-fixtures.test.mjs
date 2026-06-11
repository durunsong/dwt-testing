import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectRequiredCaseUploadPaths,
  ensureCaseUploadFixtures
} from "./ensure-case-upload-fixtures.mjs";

test("collectRequiredCaseUploadPaths merges scenario yaml and .env.example paths", async () => {
  const paths = await collectRequiredCaseUploadPaths(path.resolve(import.meta.dirname, ".."));
  assert.ok(paths.some((item) => item.includes("admin_zilkiaoxiugai001/111-2.png")));
  assert.ok(paths.some((item) => item.includes("kyc_submit/office-scene.png")));
});

test("ensureCaseUploadFixtures creates missing png and jpg fixtures", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dwt-upload-fixtures-"));
  const scenarioDir = path.join(rootDir, "cases", "scenario");
  await fs.mkdir(scenarioDir, { recursive: true });
  await fs.writeFile(
    path.join(scenarioDir, "demo.yaml"),
    'file: "uploads/cases/demo/sample.png"\nfile2: "uploads/cases/demo/sample.jpg"\n',
    "utf8"
  );

  try {
    const result = await ensureCaseUploadFixtures({
      rootDir,
      paths: ["uploads/cases/demo/sample.png", "uploads/cases/demo/sample.jpg"]
    });
    assert.deepEqual(result.created, [
      "uploads/cases/demo/sample.jpg",
      "uploads/cases/demo/sample.png"
    ]);
    assert.equal(await fs.stat(path.join(rootDir, "uploads/cases/demo/sample.png")).size > 0, true);
    assert.equal(await fs.stat(path.join(rootDir, "uploads/cases/demo/sample.jpg")).size > 0, true);
  } finally {
    await fs.rm(rootDir, { force: true, recursive: true });
  }
});
