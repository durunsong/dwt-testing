import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveUploadFilePath } from "./upload-file";

describe("resolveUploadFilePath", () => {
  it("resolves uploads from the workspace root when runner root points at apps/server", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dwt-upload-"));
    const serverDir = path.join(rootDir, "apps", "server");
    const uploadFile = path.join(rootDir, "uploads", "cases", "kyc_submit", "id-card.png");
    await fs.mkdir(path.dirname(uploadFile), { recursive: true });
    await fs.mkdir(serverDir, { recursive: true });
    await fs.writeFile(path.join(rootDir, "pnpm-workspace.yaml"), "packages: []\n", "utf8");
    await fs.writeFile(uploadFile, "fixture", "utf8");

    assert.equal(
      resolveUploadFilePath(serverDir, "uploads/cases/kyc_submit/id-card.png"),
      uploadFile
    );
  });

  it("rejects paths outside the workspace", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dwt-upload-"));
    await fs.writeFile(path.join(rootDir, "pnpm-workspace.yaml"), "packages: []\n", "utf8");

    assert.throws(
      () => resolveUploadFilePath(rootDir, "../secret.txt"),
      /上传文件不能指向/
    );
  });
});
