import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { computeManagedContentHashFromFiles, mirrorDirectory } from "./seed-sync";

test("computeManagedContentHashFromFiles is stable and prefixed", () => {
  const files = new Map<string, Buffer>([
    ["cases/a.yaml", Buffer.from("a: 1\n", "utf8")],
    [".env.example", Buffer.from("A=1\n", "utf8")]
  ]);

  const first = computeManagedContentHashFromFiles(files);
  const second = computeManagedContentHashFromFiles(files);

  assert.equal(first, second);
  assert.match(first, /^sha256:[a-f0-9]{64}$/);
});

test("computeManagedContentHashFromFiles changes when file content changes", () => {
  const before = new Map<string, Buffer>([
    ["cases/a.yaml", Buffer.from("a: 1\n", "utf8")]
  ]);
  const after = new Map<string, Buffer>([
    ["cases/a.yaml", Buffer.from("a: 2\n", "utf8")]
  ]);

  assert.notEqual(
    computeManagedContentHashFromFiles(before),
    computeManagedContentHashFromFiles(after)
  );
});

test("mirrorDirectory replaces stale files and removes deleted seed files", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dwt-seed-mirror-"));
  const sourceDir = path.join(tempRoot, "source");
  const targetDir = path.join(tempRoot, "target");

  try {
    await fs.mkdir(path.join(sourceDir, "scenario"), { recursive: true });
    await fs.mkdir(path.join(targetDir, "scenario"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "scenario", "new.yaml"), "case_id: new\n", "utf8");
    await fs.writeFile(path.join(targetDir, "scenario", "old.yaml"), "case_id: old\n", "utf8");
    await fs.writeFile(path.join(targetDir, "scenario", "stale.yaml"), "case_id: stale\n", "utf8");

    await mirrorDirectory(sourceDir, targetDir);

    assert.equal(await fs.readFile(path.join(targetDir, "scenario", "new.yaml"), "utf8"), "case_id: new\n");
    await assert.rejects(() => fs.access(path.join(targetDir, "scenario", "stale.yaml")));
    await assert.rejects(() => fs.access(path.join(targetDir, "scenario", "old.yaml")));
  } finally {
    await fs.rm(tempRoot, { force: true, recursive: true });
  }
});
