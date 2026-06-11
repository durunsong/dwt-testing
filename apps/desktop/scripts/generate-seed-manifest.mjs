import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import { writeSeedManifest } from "./seed-manifest.mjs";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(desktopDir, "../..");
const outputDir = path.resolve(desktopDir, ".generated");
const outputPath = path.resolve(outputDir, "seed-manifest.json");

const packageJson = JSON.parse(await fs.readFile(path.resolve(desktopDir, "package.json"), "utf8"));
const manifest = await writeSeedManifest({
  rootDir,
  appVersion: packageJson.version ?? "0.0.0",
  outputPath
});

console.info(`[seed-manifest] wrote ${outputPath} (${manifest.fileCount} files, ${manifest.contentHash})`);
