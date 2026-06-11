import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSeedManifest, collectManagedSeedFiles, computeManagedContentHash } from "../scripts/seed-manifest.mjs";

test("computeManagedContentHash is stable for the same managed file set", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dwt-seed-hash-"));
  try {
    await fs.mkdir(path.join(rootDir, "cases", "scenario"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "cases", "scenario", "demo.yaml"), "case_id: demo\n", "utf8");
    await fs.writeFile(path.join(rootDir, ".env.example"), "TEST_ENV=sit\n", "utf8");
    await fs.writeFile(path.join(rootDir, "platform.config.json"), "{}\n", "utf8");

    const files = await collectManagedSeedFiles(rootDir);
    assert.equal(files.size, 3);
    assert.equal(computeManagedContentHash(files), computeManagedContentHash(files));
  } finally {
    await fs.rm(rootDir, { force: true, recursive: true });
  }
});

test("buildSeedManifest contentHash changes when cases change", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dwt-seed-manifest-"));
  try {
    await fs.mkdir(path.join(rootDir, "cases"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "cases", "a.yaml"), "a: 1\n", "utf8");
    await fs.writeFile(path.join(rootDir, ".env.example"), "A=1\n", "utf8");
    await fs.writeFile(path.join(rootDir, "platform.config.json"), "{}\n", "utf8");

    const before = await buildSeedManifest({ rootDir, appVersion: "1.0.0" });
    await fs.writeFile(path.join(rootDir, "cases", "a.yaml"), "a: 2\n", "utf8");
    const after = await buildSeedManifest({ rootDir, appVersion: "1.0.0" });

    assert.notEqual(before.contentHash, after.contentHash);
    assert.equal(before.appVersion, "1.0.0");
  } finally {
    await fs.rm(rootDir, { force: true, recursive: true });
  }
});
