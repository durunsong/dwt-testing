import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = path.resolve(desktopDir, "../..");
const outDir = path.resolve(desktopDir, "dist");
const playwrightCoreDir = path.resolve(rootDir, "node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core");

const workspaceAlias = {
  "@ai-e2e/shared": path.resolve(rootDir, "packages/shared/src/index.ts"),
  "@ai-e2e/runner": path.resolve(rootDir, "packages/runner/src/index.ts"),
  "@ai-e2e/ai-generator": path.resolve(rootDir, "packages/ai-generator/src/index.ts")
};

const aliasPlugin = {
  name: "workspace-alias",
  setup(buildContext) {
    buildContext.onResolve({ filter: /^@ai-e2e\/(shared|runner|ai-generator)$/ }, (args) => ({
      path: workspaceAlias[args.path]
    }));
  }
};

const commonOptions = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  logLevel: "info",
  plugins: [aliasPlugin],
  external: ["electron", "chromium-bidi/*"]
};

await fs.copyFile(path.resolve(playwrightCoreDir, "browsers.json"), path.resolve(desktopDir, "browsers.json"));
await import("./generate-seed-manifest.mjs");

await Promise.all([
  build({
    ...commonOptions,
    entryPoints: [path.resolve(desktopDir, "src/main.ts")],
    outfile: path.resolve(outDir, "main.cjs")
  }),
  build({
    ...commonOptions,
    entryPoints: [path.resolve(desktopDir, "src/preload.ts")],
    outfile: path.resolve(outDir, "preload.cjs")
  })
]);
