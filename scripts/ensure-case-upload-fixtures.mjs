import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uploadPathPattern = /uploads\/cases\/[^\s"'`#]+/g;

export async function collectCaseUploadPathsFromEnvExample(root = rootDir) {
  const envExamplePath = path.resolve(root, ".env.example");
  const content = await fs.readFile(envExamplePath, "utf8");
  const paths = new Set();

  for (const match of content.matchAll(uploadPathPattern)) {
    paths.add(match[0].replace(/\\/g, "/"));
  }

  return [...paths].sort((a, b) => a.localeCompare(b));
}

export async function collectRequiredCaseUploadPaths(root = rootDir) {
  const yamlPaths = await collectCaseUploadPathsFromYaml(root);
  const envPaths = await collectCaseUploadPathsFromEnvExample(root);
  return [...new Set([...yamlPaths, ...envPaths])].sort((a, b) => a.localeCompare(b));
}

/** 1x1 PNG，体积约 70B，满足上传控件格式校验。 */
const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/** 1x1 JPEG，体积约 200B。 */
const MINIMAL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8Af//Z",
  "base64"
);

export async function collectCaseUploadPathsFromYaml(root = rootDir) {
  const scenarioDir = path.resolve(root, "cases", "scenario");
  const entries = await fs.readdir(scenarioDir, { withFileTypes: true });
  const paths = new Set();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".yaml")) {
      continue;
    }
    const content = await fs.readFile(path.resolve(scenarioDir, entry.name), "utf8");
    for (const match of content.matchAll(uploadPathPattern)) {
      paths.add(match[0].replace(/\\/g, "/"));
    }
  }

  return [...paths].sort((a, b) => a.localeCompare(b));
}

export async function ensureCaseUploadFixtures(options = {}) {
  const root = options.rootDir ?? rootDir;
  const createMissing = options.createMissing ?? true;
  const relativePaths = options.paths ?? await collectRequiredCaseUploadPaths(root);
  const created = [];
  const existing = [];
  const missing = [];

  for (const relativePath of relativePaths) {
    const absolutePath = path.resolve(root, relativePath);
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.isFile()) {
        existing.push(relativePath);
        continue;
      }
      missing.push(relativePath);
    } catch {
      if (!createMissing) {
        missing.push(relativePath);
        continue;
      }
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, fixtureBuffer(relativePath));
      created.push(relativePath);
    }
  }

  return { relativePaths, existing, created, missing };
}

function fixtureBuffer(relativePath) {
  return relativePath.toLowerCase().endsWith(".jpg") || relativePath.toLowerCase().endsWith(".jpeg")
    ? MINIMAL_JPEG
    : MINIMAL_PNG;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const result = await ensureCaseUploadFixtures();
  if (result.created.length) {
    console.info(`[fixtures:uploads] created ${result.created.length} file(s):`);
    for (const file of result.created) {
      console.info(`  - ${file}`);
    }
  } else {
    console.info(`[fixtures:uploads] all ${result.relativePaths.length} case upload fixture(s) present`);
  }
  if (result.missing.length) {
    console.error(`[fixtures:uploads] missing ${result.missing.length} file(s):`);
    for (const file of result.missing) {
      console.error(`  - ${file}`);
    }
    process.exitCode = 1;
  }
}
