import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const SEED_MANIFEST_SCHEMA_VERSION = 1;
export const SEED_MANIFEST_FILENAME = "seed-manifest.json";
export const SEED_SYNC_STATE_FILENAME = ".seed-sync-state.json";

/** Paths under workspace root that are owned by the installer seed bundle. */
export const MANAGED_SEED_ENTRIES = ["cases", "uploads/cases", ".env.example", "platform.config.json"];

/**
 * @param {string} rootDir
 * @returns {Promise<Map<string, Buffer>>}
 */
export async function collectManagedSeedFiles(rootDir) {
  /** @type {Map<string, Buffer>} */
  const files = new Map();

  for (const entry of MANAGED_SEED_ENTRIES) {
    const absolute = path.resolve(rootDir, entry);
    if (!(await pathExists(absolute))) {
      continue;
    }

    const stat = await fs.stat(absolute);
    if (stat.isDirectory()) {
      await collectDirectoryFiles(absolute, entry.replace(/\\/g, "/"), files);
      continue;
    }

    const content = await fs.readFile(absolute);
    files.set(entry.replace(/\\/g, "/"), content);
  }

  return files;
}

/**
 * @param {Map<string, Buffer>} files
 * @returns {string}
 */
export function computeManagedContentHash(files) {
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

/**
 * @param {object} input
 * @param {string} input.rootDir
 * @param {string} input.appVersion
 * @returns {Promise<object>}
 */
export async function buildSeedManifest({ rootDir, appVersion }) {
  const files = await collectManagedSeedFiles(rootDir);
  const contentHash = computeManagedContentHash(files);

  return {
    schemaVersion: SEED_MANIFEST_SCHEMA_VERSION,
    appVersion,
    generatedAt: new Date().toISOString(),
    contentHash,
    managedPaths: [...MANAGED_SEED_ENTRIES],
    fileCount: files.size
  };
}

/**
 * @param {object} input
 * @param {string} input.rootDir
 * @param {string} input.appVersion
 * @param {string} input.outputPath
 */
export async function writeSeedManifest({ rootDir, appVersion, outputPath }) {
  const manifest = await buildSeedManifest({ rootDir, appVersion });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

/**
 * @param {string} directory
 * @param {string} relativePrefix
 * @param {Map<string, Buffer>} files
 */
async function collectDirectoryFiles(directory, relativePrefix, files) {
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    const absolutePath = path.resolve(directory, entry.name);

    if (entry.isDirectory()) {
      await collectDirectoryFiles(absolutePath, relativePath, files);
      continue;
    }

    if (entry.isFile()) {
      files.set(relativePath.replace(/\\/g, "/"), await fs.readFile(absolutePath));
    }
  }
}

/**
 * @param {string} target
 */
async function pathExists(target) {
  return fs.access(target).then(
    () => true,
    () => false
  );
}
