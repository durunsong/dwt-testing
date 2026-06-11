import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const SEED_MANIFEST_FILENAME = "seed-manifest.json";
export const SEED_SYNC_STATE_FILENAME = ".seed-sync-state.json";

const MANAGED_SEED_ENTRIES = ["cases", "uploads/cases", ".env.example", "platform.config.json"] as const;

export interface SeedManifest {
  schemaVersion: number;
  appVersion: string;
  generatedAt: string;
  contentHash: string;
  managedPaths: string[];
  fileCount: number;
}

export interface SeedSyncState {
  schemaVersion: number;
  contentHash: string;
  appVersion: string;
  syncedAt: string;
}

export interface SeedSyncResult {
  synced: boolean;
  reason: "unchanged" | "missing-manifest" | "initial" | "content-updated";
  manifest?: SeedManifest;
}

export type SeedSyncLogger = (message: string, data?: Record<string, unknown>) => void | Promise<void>;

export async function syncRuntimeSeed(
  runtimeRoot: string,
  seedDir: string,
  options: { logger?: SeedSyncLogger } = {}
): Promise<SeedSyncResult> {
  const manifestPath = path.resolve(seedDir, SEED_MANIFEST_FILENAME);
  const manifest = await readSeedManifest(manifestPath);

  if (!manifest) {
    await options.logger?.("seed manifest 缺失，回退为仅补齐缺失文件", { manifestPath });
    await seedMissingEntries(seedDir, runtimeRoot);
    return { synced: false, reason: "missing-manifest" };
  }

  const statePath = path.resolve(runtimeRoot, SEED_SYNC_STATE_FILENAME);
  const previousState = await readSeedSyncState(statePath);

  if (previousState?.contentHash === manifest.contentHash) {
    return { synced: false, reason: "unchanged", manifest };
  }

  const reason = previousState ? "content-updated" : "initial";
  await mirrorManagedSeedEntries(seedDir, runtimeRoot);
  await writeSeedSyncState(statePath, {
    schemaVersion: manifest.schemaVersion,
    contentHash: manifest.contentHash,
    appVersion: manifest.appVersion,
    syncedAt: new Date().toISOString()
  });

  await options.logger?.("workspace seed 已同步", {
    reason,
    appVersion: manifest.appVersion,
    contentHash: manifest.contentHash,
    fileCount: manifest.fileCount,
    previousContentHash: previousState?.contentHash
  });

  return { synced: true, reason, manifest };
}

async function readSeedManifest(manifestPath: string): Promise<SeedManifest | undefined> {
  if (!(await pathExists(manifestPath))) {
    return undefined;
  }

  const raw = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Partial<SeedManifest>;
  if (!raw.contentHash || typeof raw.contentHash !== "string") {
    throw new Error(`seed manifest 无效：缺少 contentHash（${manifestPath}）`);
  }

  return {
    schemaVersion: raw.schemaVersion ?? 1,
    appVersion: raw.appVersion ?? "unknown",
    generatedAt: raw.generatedAt ?? "",
    contentHash: raw.contentHash,
    managedPaths: Array.isArray(raw.managedPaths) ? raw.managedPaths : [...MANAGED_SEED_ENTRIES],
    fileCount: raw.fileCount ?? 0
  };
}

async function readSeedSyncState(statePath: string): Promise<SeedSyncState | undefined> {
  if (!(await pathExists(statePath))) {
    return undefined;
  }

  const raw = JSON.parse(await fs.readFile(statePath, "utf8")) as Partial<SeedSyncState>;
  if (!raw.contentHash) {
    return undefined;
  }

  return {
    schemaVersion: raw.schemaVersion ?? 1,
    contentHash: raw.contentHash,
    appVersion: raw.appVersion ?? "unknown",
    syncedAt: raw.syncedAt ?? ""
  };
}

async function writeSeedSyncState(statePath: string, state: SeedSyncState): Promise<void> {
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function mirrorManagedSeedEntries(seedDir: string, runtimeRoot: string): Promise<void> {
  for (const entry of MANAGED_SEED_ENTRIES) {
    const sourcePath = path.resolve(seedDir, entry);
    const targetPath = path.resolve(runtimeRoot, entry);

    if (!(await pathExists(sourcePath))) {
      continue;
    }

    const stat = await fs.stat(sourcePath);
    if (stat.isDirectory()) {
      await mirrorDirectory(sourcePath, targetPath);
      continue;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }
}

export async function mirrorDirectory(sourceDir: string, targetDir: string): Promise<void> {
  const sourceFiles = await listRelativeFiles(sourceDir);
  const sourceSet = new Set(sourceFiles);

  await fs.mkdir(targetDir, { recursive: true });

  for (const relativePath of sourceFiles) {
    const sourcePath = path.resolve(sourceDir, relativePath);
    const targetPath = path.resolve(targetDir, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }

  const targetFiles = await listRelativeFiles(targetDir);
  for (const relativePath of targetFiles) {
    if (sourceSet.has(relativePath)) {
      continue;
    }
    await fs.rm(path.resolve(targetDir, relativePath), { force: true, recursive: true });
  }

  await removeEmptyDirectories(targetDir);
}

async function seedMissingEntries(seedDir: string, runtimeRoot: string): Promise<void> {
  for (const entry of MANAGED_SEED_ENTRIES) {
    const sourcePath = path.resolve(seedDir, entry);
    const targetPath = path.resolve(runtimeRoot, entry);
    if (!(await pathExists(sourcePath))) {
      continue;
    }

    const stat = await fs.stat(sourcePath);
    if (stat.isDirectory()) {
      await copyMissingDirectory(sourcePath, targetPath);
      continue;
    }

    await copyFileIfMissing(sourcePath, targetPath);
  }
}

async function copyMissingDirectory(sourceDir: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.resolve(sourceDir, entry.name);
    const targetPath = path.resolve(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyMissingDirectory(sourcePath, targetPath);
      continue;
    }

    if (entry.isFile()) {
      await copyFileIfMissing(sourcePath, targetPath);
    }
  }
}

async function copyFileIfMissing(source: string, target: string): Promise<void> {
  if (await pathExists(target)) {
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function listRelativeFiles(rootDir: string, currentDir = rootDir, prefix = ""): Promise<string[]> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.resolve(currentDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listRelativeFiles(rootDir, absolutePath, relativePath));
      continue;
    }

    if (entry.isFile()) {
      files.push(relativePath.replace(/\\/g, "/"));
    }
  }

  return files;
}

async function removeEmptyDirectories(rootDir: string): Promise<void> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const childDir = path.resolve(rootDir, entry.name);
    await removeEmptyDirectories(childDir);
  }

  if (rootDir === path.parse(rootDir).root) {
    return;
  }

  const remaining = await fs.readdir(rootDir).catch(() => []);
  if (remaining.length === 0) {
    await fs.rm(rootDir, { force: true, recursive: true });
  }
}

async function pathExists(target: string): Promise<boolean> {
  return fs.access(target).then(
    () => true,
    () => false
  );
}

/** @internal test helper */
export function computeManagedContentHashFromFiles(files: Map<string, Buffer>): string {
  const hash = crypto.createHash("sha256");
  const relativePaths = [...files.keys()].sort((a, b) => a.localeCompare(b));

  for (const relativePath of relativePaths) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(files.get(relativePath) ?? Buffer.alloc(0));
    hash.update("\0");
  }

  return `sha256:${hash.digest("hex")}`;
}
