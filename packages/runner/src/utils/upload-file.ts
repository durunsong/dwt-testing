import fs from "node:fs";
import path from "node:path";

export function resolveUploadFilePath(rootDir: string, file: string): string {
  const trimmed = file.trim();
  if (!trimmed) {
    throw new Error("上传文件路径不能为空");
  }

  const rootPath = path.resolve(rootDir);
  const workspaceRoot = findWorkspaceRoot(rootPath);
  const allowedRoots = uniquePaths([rootPath, workspaceRoot]);
  const filePath = resolveExistingUploadPath(allowedRoots, trimmed);

  if (!allowedRoots.some((allowedRoot) => isInsideRoot(allowedRoot, filePath))) {
    throw new Error(`上传文件不能指向项目目录外：${file}`);
  }

  return filePath;
}

function resolveExistingUploadPath(allowedRoots: string[], file: string): string {
  if (path.isAbsolute(file)) {
    return path.resolve(file);
  }

  const candidates = allowedRoots.map((root) => path.resolve(root, file));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? path.resolve(allowedRoots[0] ?? process.cwd(), file);
}

function findWorkspaceRoot(startDir: string): string {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.resolve(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }
    current = parent;
  }
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((item) => path.resolve(item))));
}

function isInsideRoot(rootDir: string, targetPath: string): boolean {
  const rootPath = path.resolve(rootDir);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget === rootPath || resolvedTarget.startsWith(rootPath + path.sep);
}
