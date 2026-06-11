import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { app, BrowserWindow, shell } from "electron";
import { startServer, type StartedServer } from "../../server/src/index";
import { loadPlatformConfig, platformArtifactKinds, resolveArtifactBaseDir, type PlatformConfig } from "@ai-e2e/runner";
import { syncRuntimeSeed } from "./seed-sync";

let mainWindow: BrowserWindow | undefined;
let server: StartedServer | undefined;
let desktopPlatformConfig: PlatformConfig | undefined;

process.on("uncaughtException", (error) => {
  void writeStartupError(error);
});

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  void writeStartupError(error);
});

void app.whenReady().then(bootstrap).catch((error: unknown) => {
  void writeStartupError(error instanceof Error ? error : new Error(String(error))).finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (desktopPlatformConfig) {
      void createMainWindow(desktopPlatformConfig);
    }
  }
});

app.on("before-quit", () => {
  void server?.close();
});

async function bootstrap(): Promise<void> {
  const { runtimeRoot, platformConfig } = await prepareRuntimeRoot();
  desktopPlatformConfig = platformConfig;
  preparePlaywrightRuntime();
  server = await startServer({
    rootDir: runtimeRoot,
    host: "127.0.0.1",
    port: Number(process.env.DWT_DESKTOP_API_PORT ?? platformConfig.desktop.apiPort),
    logger: !app.isPackaged
  });

  await createMainWindow(platformConfig);
}

function preparePlaywrightRuntime(): void {
  if (!app.isPackaged) {
    return;
  }

  const browsersPath = path.resolve(process.resourcesPath, "playwright-browsers");
  if (existsSync(browsersPath)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
  }
}

async function createMainWindow(platformConfig: PlatformConfig): Promise<void> {
  if (!server) {
    return;
  }
  const windowConfig = platformConfig.desktop.window;

  mainWindow = new BrowserWindow({
    width: windowConfig.width,
    height: windowConfig.height,
    minWidth: windowConfig.minWidth,
    minHeight: windowConfig.minHeight,
    icon: desktopIconPath(),
    show: false,
    title: windowConfig.title,
    autoHideMenuBar: !windowConfig.menuBarVisible,
    webPreferences: {
      preload: path.resolve(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (!windowConfig.menuBarVisible) {
    mainWindow.setMenu(null);
    mainWindow.setMenuBarVisibility(false);
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const apiBaseUrl = `${server.origin}/api`;
  const devServerUrl = process.env.DWT_DESKTOP_DEV_SERVER_URL;

  if (devServerUrl) {
    const url = new URL(devServerUrl);
    url.searchParams.set("apiBaseUrl", apiBaseUrl);
    await mainWindow.loadURL(url.toString());
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  await mainWindow.loadFile(path.resolve(getWebDistDir(), "index.html"), {
    query: { apiBaseUrl }
  });
}

async function prepareRuntimeRoot(): Promise<{ runtimeRoot: string; platformConfig: PlatformConfig }> {
  const runtimeRoot = app.isPackaged
    ? path.resolve(app.getPath("userData"), "workspace")
    : findWorkspaceRoot(path.resolve(__dirname, "..", "..", ".."));

  if (app.isPackaged) {
    await fs.mkdir(runtimeRoot, { recursive: true });
    await syncRuntimeSeed(runtimeRoot, path.resolve(process.resourcesPath, "seed"), {
      logger: async (message, data) => {
        await appendDesktopLog(`[seed-sync] ${message}${data ? ` ${JSON.stringify(data)}` : ""}`);
      }
    });
  }

  const platformConfig = loadPlatformConfig(runtimeRoot);
  await ensureDirectories(runtimeRoot, platformConfig);

  return { runtimeRoot, platformConfig };
}

async function ensureDirectories(runtimeRoot: string, platformConfig: PlatformConfig): Promise<void> {
  const directories = [
    ...platformConfig.workspace.directories.map((name) => path.resolve(runtimeRoot, name)),
    ...platformArtifactKinds.map((kind) => resolveArtifactBaseDir(runtimeRoot, platformConfig, kind))
  ];
  await Promise.all(
    directories.map((dir) => fs.mkdir(dir, { recursive: true }))
  );
}

function getWebDistDir(): string {
  if (app.isPackaged) {
    return path.resolve(process.resourcesPath, "web");
  }

  return path.resolve(findWorkspaceRoot(path.resolve(__dirname, "..", "..", "..")), "apps", "web", "dist");
}

function desktopIconPath(): string {
  const iconFile = process.platform === "win32" ? "icon.ico" : "icon.png";
  return path.resolve(__dirname, "..", "assets", iconFile);
}

function findWorkspaceRoot(startDir: string): string {
  let current = path.resolve(startDir);
  while (true) {
    if (pathExistsSync(path.resolve(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

function pathExistsSync(target: string): boolean {
  return existsSync(target);
}

async function writeStartupError(error: Error): Promise<void> {
  await appendDesktopLog(error.stack ?? error.message);
}

async function appendDesktopLog(message: string): Promise<void> {
  const logDir = path.resolve(app.getPath("userData"), "logs");
  await fs.mkdir(logDir, { recursive: true });
  await fs.appendFile(
    path.resolve(logDir, "desktop-main.log"),
    `[${new Date().toISOString()}] ${message}\n`,
    "utf8"
  );
}
