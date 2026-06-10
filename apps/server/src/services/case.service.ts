import fs from "node:fs/promises";
import path from "node:path";
import { defaultPlatformConfig, megabytesToBytes, preflightScenarioContent, ScenarioOrchestrator, type PlatformConfig, validateScenarioContent, validateScenarioContentForRun } from "@ai-e2e/runner";
import { DEFAULT_TEST_ENV } from "@ai-e2e/shared";
import YAML from "yaml";
import type { EnvConfigService } from "./env-config.service";
import { normalizeTestEnv } from "./env-config.service";

export interface CaseValidationIssue {
  path: string;
  message: string;
}

export interface CaseValidationResult {
  valid: boolean;
  caseId?: string;
  caseName?: string;
  issues: CaseValidationIssue[];
}

export type CaseTemplate = "user_login" | "admin_login" | "user_admin_kyc";

export interface CreateCaseInput {
  caseId: string;
  caseName: string;
  caseType?: string;
  description?: string;
  template: CaseTemplate;
}

export interface SaveCaseAttachmentInput {
  caseId: string;
  fileName: string;
  mimeType?: string;
  base64: string;
}

export interface SaveCaseAttachmentResult {
  name: string;
  file: string;
  sizeBytes: number;
}

export interface DeleteCaseOptions {
  deleteAttachments?: boolean;
}

export interface DeleteAttachmentResult {
  deleted: boolean;
  file: string;
}

export interface ReadAttachmentResult {
  name: string;
  file: string;
  content: Buffer;
}

export interface SearchCaseAttachmentsInput {
  caseId?: string;
  query?: string;
  limit?: number;
}

export interface CaseAttachmentSearchResult {
  kind: "file" | "directory";
  name: string;
  file: string;
  sizeBytes?: number;
}

export interface SharedAbilityParam {
  name: string;
  required?: boolean;
  defaultValue?: string;
  description?: string;
}

export interface SharedAbility {
  sharedId: string;
  name: string;
  description?: string;
  tags: string[];
  params: SharedAbilityParam[];
  stepCount: number;
  file: string;
}

export class CaseService {
  constructor(
    _runner: ScenarioOrchestrator,
    private readonly rootDir: string,
    private readonly envConfigService?: EnvConfigService,
    private readonly platformConfig: PlatformConfig = defaultPlatformConfig
  ) {}

  async listCases() {
    const files = await this.listScenarioFiles();
    const cases = await Promise.all(
      files.map(async (filePath) => {
        const content = await fs.readFile(filePath, "utf8");
        const validation = await this.validateScenarioContentForRun(content);
        const fallbackCaseId = this.caseIdFromFilePath(filePath);
        const parsed = validation.data;

        return {
          caseId: validation.caseId ?? fallbackCaseId,
          caseName: validation.caseName ?? "DSL 校验失败",
          caseType: parsed?.case_type ?? "uncategorized",
          description: parsed?.description,
          mode: parsed?.mode ?? "invalid",
          total: parsed?.steps.length ?? 0,
          valid: validation.valid,
          file: path.relative(this.rootDir, filePath).replace(/\\/g, "/")
        };
      })
    );

    return cases.sort((a, b) => a.caseId.localeCompare(b.caseId));
  }

  async listSharedAbilities(): Promise<SharedAbility[]> {
    const files = await this.listSharedAbilityFiles();
    const abilities = await Promise.all(files.map((filePath) => this.readSharedAbility(filePath)));
    return abilities.sort((left, right) => left.sharedId.localeCompare(right.sharedId));
  }

  async getCase(caseId: string) {
    const filePath = await this.findScenarioPath(caseId);
    const content = await fs.readFile(filePath, "utf8");
    const validation = await this.validateScenarioContentForRun(content);
    const parsed = validation.data;

    return {
      caseId: validation.caseId ?? this.caseIdFromFilePath(filePath),
      caseName: validation.caseName ?? "DSL 校验失败",
      caseType: parsed?.case_type ?? "uncategorized",
      description: parsed?.description,
      mode: parsed?.mode ?? "invalid",
      total: parsed?.steps.length ?? 0,
      file: path.relative(this.rootDir, filePath).replace(/\\/g, "/"),
      content,
      validation
    };
  }

  async createCase(input: CreateCaseInput) {
    const caseId = this.normalizeCaseId(input.caseId);
    const caseName = input.caseName.trim();
    if (!caseId) {
      throw new Error("case_id 不能为空");
    }
    if (!/^[a-z][a-z0-9_-]{2,63}$/.test(caseId)) {
      throw new Error("case_id 只能使用小写字母、数字、下划线或中划线，且必须以小写字母开头，长度 3-64 位");
    }
    if (!caseName) {
      throw new Error("用例名称不能为空");
    }

    const files = await this.listScenarioFiles();
    await this.assertCaseNameAvailable(caseName, files);
    const targetPath = path.resolve(this.scenarioDir(), `${caseId}.yaml`);
    if (!targetPath.startsWith(this.scenarioDir() + path.sep)) {
      throw new Error("用例文件路径非法");
    }
    if (files.some((filePath) => this.caseIdFromFilePath(filePath) === caseId)) {
      throw new Error(`用例文件已存在：${caseId}.yaml`);
    }

    for (const filePath of files) {
      const content = await fs.readFile(filePath, "utf8");
      const validation = await this.validateScenarioContentForRun(content);
      if (validation.caseId === caseId) {
        throw new Error(`case_id 已存在：${caseId}`);
      }
    }

    const content = this.buildCaseYaml({
      caseId,
      caseName,
      caseType: this.normalizeCaseType(input.caseType),
      description: input.description?.trim(),
      template: input.template
    });
    const validation = await this.validateContentForRun(content);
    if (!validation.valid) {
      throw new Error(`新建用例模板校验失败：${validation.issues.map((item) => `${item.path} ${item.message}`).join("; ")}`);
    }

    const parsed = (await this.validateScenarioContentForRun(content)).data;
    await fs.writeFile(targetPath, content, "utf8");
    return {
      caseId,
      caseName,
      caseType: parsed?.case_type ?? "uncategorized",
      description: input.description?.trim() || this.defaultDescription(input.template),
      mode: parsed?.mode ?? "web",
      total: parsed?.steps.length ?? 0,
      valid: validation.valid,
      file: path.relative(this.rootDir, targetPath).replace(/\\/g, "/"),
      content,
      validation
    };
  }

  async createCaseFromYaml(content: string, expectedCaseId?: string) {
    const validation = await this.validateContentForRun(content);
    if (!validation.valid || !validation.caseId || !validation.caseName) {
      return { saved: false, validation };
    }

    const caseId = this.normalizeCaseId(expectedCaseId || validation.caseId);
    if (caseId !== validation.caseId) {
      return {
        saved: false,
        validation: {
          ...validation,
          valid: false,
          issues: [
            ...validation.issues,
            { path: "case_id", message: `AI YAML 中的 case_id 必须等于 ${caseId}` }
          ]
        }
      };
    }
    if (!/^[a-z][a-z0-9_-]{2,63}$/.test(caseId)) {
      return {
        saved: false,
        validation: {
          ...validation,
          valid: false,
          issues: [
            ...validation.issues,
            { path: "case_id", message: "case_id 只能使用小写字母、数字、下划线或中划线，且必须以小写字母开头，长度 3-64 位" }
          ]
        }
      };
    }

    const files = await this.listScenarioFiles();
    if (files.some((filePath) => this.caseIdFromFilePath(filePath) === caseId)) {
      throw new Error(`用例文件已存在：${caseId}.yaml`);
    }
    await this.assertCaseNameAvailable(validation.caseName, files);
    for (const filePath of files) {
      const existing = await this.validateScenarioContentForRun(await fs.readFile(filePath, "utf8"));
      if (existing.caseId === caseId) {
        throw new Error(`case_id 已存在：${caseId}`);
      }
    }

    const targetPath = path.resolve(this.scenarioDir(), `${caseId}.yaml`);
    if (!targetPath.startsWith(this.scenarioDir() + path.sep)) {
      throw new Error("用例文件路径非法");
    }

    await fs.writeFile(targetPath, this.normalizeContent(content), "utf8");
    const parsed = (await this.validateScenarioContentForRun(content)).data;
    return {
      saved: true,
      caseId,
      caseName: validation.caseName,
      caseType: parsed?.case_type ?? "uncategorized",
      description: parsed?.description,
      mode: parsed?.mode ?? "web",
      total: parsed?.steps.length ?? 0,
      valid: true,
      file: path.relative(this.rootDir, targetPath).replace(/\\/g, "/"),
      content: this.normalizeContent(content),
      validation
    };
  }

  normalizeGeneratedYaml(content: string): string {
    const cleaned = content
      .replace(/^\s*```(?:yaml|yml)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    return this.normalizeContent(this.normalizeAiYamlShape(cleaned));
  }

  async saveCase(caseId: string, content: string) {
    const validation = await this.validateContentForRun(content);
    if (!validation.valid) {
      return { saved: false, validation };
    }
    const nextCaseId = this.normalizeCaseId(validation.caseId ?? "");
    if (!nextCaseId || !/^[a-z][a-z0-9_-]{2,63}$/.test(nextCaseId)) {
      return {
        saved: false,
        validation: {
          ...validation,
          valid: false,
          issues: [
            ...validation.issues,
            { path: "case_id", message: "case_id 只能使用小写字母、数字、下划线或中划线，且必须以小写字母开头，长度 3-64 位" }
          ]
        }
      };
    }
    if (validation.caseName) {
      await this.assertCaseNameAvailable(validation.caseName, await this.listScenarioFiles(), caseId);
    }

    const filePath = await this.findScenarioPath(caseId);
    const targetPath = path.resolve(this.scenarioDir(), `${nextCaseId}.yaml`);
    if (!targetPath.startsWith(this.scenarioDir() + path.sep)) {
      throw new Error("用例文件路径非法");
    }
    if (nextCaseId !== caseId) {
      const files = await this.listScenarioFiles();
      for (const existingPath of files) {
        if (existingPath === filePath) {
          continue;
        }
        const existing = await this.validateScenarioContentForRun(await fs.readFile(existingPath, "utf8"));
        if (this.caseIdFromFilePath(existingPath) === nextCaseId || existing.caseId === nextCaseId) {
          throw new Error(`case_id 已存在：${nextCaseId}`);
        }
      }
      await fs.rename(filePath, targetPath);
    }

    const finalPath = nextCaseId === caseId ? filePath : targetPath;
    await fs.writeFile(finalPath, this.normalizeContent(content), "utf8");
    return {
      saved: true,
      caseId: nextCaseId,
      file: path.relative(this.rootDir, finalPath).replace(/\\/g, "/"),
      validation
    };
  }

  async deleteCase(caseId: string, options: DeleteCaseOptions = {}) {
    const filePath = await this.findScenarioPath(caseId);
    const scenarioDir = this.scenarioDir();
    const resolvedFilePath = path.resolve(filePath);
    if (!resolvedFilePath.startsWith(scenarioDir + path.sep)) {
      throw new Error("用例文件路径非法");
    }

    const content = await fs.readFile(resolvedFilePath, "utf8");
    const validation = await this.validateScenarioContentForRun(content);
    const deletedCaseId = validation.caseId ?? this.caseIdFromFilePath(resolvedFilePath);
    const file = path.relative(this.rootDir, resolvedFilePath).replace(/\\/g, "/");

    await fs.unlink(resolvedFilePath);
    const attachmentsDir = this.relativePath(this.attachmentCaseDir(deletedCaseId));
    let attachmentsDeleted = false;
    if (options.deleteAttachments) {
      attachmentsDeleted = await this.deleteAttachmentDirectory(deletedCaseId);
    }

    return {
      deleted: true,
      caseId: deletedCaseId,
      file,
      attachmentsDeleted,
      attachmentsDir
    };
  }

  async saveAttachment(input: SaveCaseAttachmentInput): Promise<SaveCaseAttachmentResult> {
    const caseId = this.normalizeAttachmentCaseId(input.caseId);
    const fileName = this.safeAttachmentFileName(input.fileName);
    const buffer = Buffer.from(input.base64, "base64");
    if (!buffer.byteLength) {
      throw new Error("附件内容不能为空");
    }

    const maxBytes = megabytesToBytes(this.platformConfig.uploads.caseAttachmentMaxMb);
    if (buffer.byteLength > maxBytes) {
      throw new Error(`${input.fileName} 超过 ${this.platformConfig.uploads.caseAttachmentMaxMb}MB，请压缩或拆分后再上传`);
    }

    const baseDir = path.resolve(this.rootDir, this.platformConfig.uploads.caseAttachmentBaseDir);
    this.assertInsideRoot(baseDir, "附件目录必须位于项目根目录内");
    const caseDir = path.resolve(baseDir, caseId);
    this.assertInside(caseDir, baseDir, "附件用例目录非法");
    await fs.mkdir(caseDir, { recursive: true });

    const targetPath = await this.nextAvailableAttachmentPath(caseDir, fileName);
    await fs.writeFile(targetPath, buffer);

    return {
      name: path.basename(targetPath),
      file: path.relative(this.rootDir, targetPath).replace(/\\/g, "/"),
      sizeBytes: buffer.byteLength
    };
  }

  async listAttachments(caseId: string): Promise<SaveCaseAttachmentResult[]> {
    const normalizedCaseId = this.normalizeAttachmentCaseId(caseId);
    const baseDir = path.resolve(this.rootDir, this.platformConfig.uploads.caseAttachmentBaseDir);
    this.assertInsideRoot(baseDir, "附件目录必须位于项目根目录内");
    const caseDir = path.resolve(baseDir, normalizedCaseId);
    this.assertInside(caseDir, baseDir, "附件用例目录非法");

    const entries = await fs.readdir(caseDir, { withFileTypes: true }).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const filePath = path.resolve(caseDir, entry.name);
          this.assertInside(filePath, caseDir, "附件文件路径非法");
          const stat = await fs.stat(filePath);
          return {
            name: entry.name,
            file: path.relative(this.rootDir, filePath).replace(/\\/g, "/"),
            sizeBytes: stat.size
          };
        })
    );

    return files.sort((left, right) => left.name.localeCompare(right.name));
  }

  async deleteAttachment(caseId: string, file: string): Promise<DeleteAttachmentResult> {
    const caseDir = this.attachmentCaseDir(caseId);
    const filePath = path.resolve(this.rootDir, file);
    this.assertInside(filePath, caseDir, "附件文件路径非法");
    await fs.unlink(filePath);
    return {
      deleted: true,
      file: this.relativePath(filePath)
    };
  }

  async readAttachment(file: string): Promise<ReadAttachmentResult> {
    const baseDir = this.attachmentBaseDir();
    const filePath = path.resolve(this.rootDir, file);
    this.assertInside(filePath, baseDir, "附件文件路径非法");
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new Error("附件文件路径非法");
    }
    return {
      name: path.basename(filePath),
      file: this.relativePath(filePath),
      content: await fs.readFile(filePath)
    };
  }

  async searchAttachments(input: SearchCaseAttachmentsInput = {}): Promise<CaseAttachmentSearchResult[]> {
    const query = (input.query ?? "").trim().toLowerCase();
    const limit = Math.max(1, Math.min(input.limit ?? 200, 500));
    const baseDir = input.caseId ? this.attachmentCaseDir(input.caseId) : this.attachmentBaseDir();
    const results: CaseAttachmentSearchResult[] = [];

    await this.walkAttachmentEntries(baseDir, query, results, limit);
    return results.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }
      return left.file.localeCompare(right.file);
    });
  }

  validateContent(content: string): CaseValidationResult {
    try {
      const result = validateScenarioContent(content);
      return {
        valid: result.valid,
        caseId: result.caseId,
        caseName: result.caseName,
        issues: result.issues
      };
    } catch (error) {
      return {
        valid: false,
        issues: [{ path: "yaml", message: error instanceof Error ? error.message : String(error) }]
      };
    }
  }

  async validateContentForRun(content: string): Promise<CaseValidationResult> {
    try {
      const result = await this.validateScenarioContentForRun(content);
      return {
        valid: result.valid,
        caseId: result.caseId,
        caseName: result.caseName,
        issues: result.issues
      };
    } catch (error) {
      return {
        valid: false,
        issues: [{ path: "yaml", message: error instanceof Error ? error.message : String(error) }]
      };
    }
  }

  private async validateScenarioContentForRun(content: string) {
    return validateScenarioContentForRun(this.rootDir, content);
  }

  async preflightCase(caseId: string, env = process.env.TEST_ENV ?? DEFAULT_TEST_ENV) {
    const normalizedEnv = normalizeTestEnv(env);
    await this.envConfigService?.applyToProcess(normalizedEnv);
    const filePath = await this.findScenarioPath(caseId);
    return preflightScenarioContent({
      rootDir: this.rootDir,
      content: await fs.readFile(filePath, "utf8"),
      env: normalizedEnv
    });
  }

  async preflightContent(content: string, env = process.env.TEST_ENV ?? DEFAULT_TEST_ENV) {
    const normalizedEnv = normalizeTestEnv(env);
    await this.envConfigService?.applyToProcess(normalizedEnv);
    return preflightScenarioContent({
      rootDir: this.rootDir,
      content,
      env: normalizedEnv
    });
  }

  private async findScenarioPath(caseId: string): Promise<string> {
    const files = await this.listScenarioFiles();
    for (const filePath of files) {
      const content = await fs.readFile(filePath, "utf8");
      const parsed = await this.validateScenarioContentForRun(content);
      const candidateCaseId = parsed.caseId ?? this.caseIdFromFilePath(filePath);
      if (candidateCaseId === caseId) {
        return filePath;
      }
    }
    throw new Error(`未找到用例：${caseId}`);
  }

  private scenarioDir(): string {
    return path.resolve(this.rootDir, "cases", "scenario");
  }

  private sharedDir(): string {
    return path.resolve(this.rootDir, "cases", "shared");
  }

  private async listSharedAbilityFiles(): Promise<string[]> {
    const sharedDir = this.sharedDir();
    const files: string[] = [];
    await this.walkSharedAbilityFiles(sharedDir, files);
    return files;
  }

  private async walkSharedAbilityFiles(currentDir: string, files: string[]): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    });

    for (const entry of entries) {
      const entryPath = path.resolve(currentDir, entry.name);
      this.assertInside(entryPath, this.sharedDir(), "共享能力路径非法");
      if (entry.isDirectory()) {
        await this.walkSharedAbilityFiles(entryPath, files);
      } else if (entry.isFile() && /\.(ya?ml)$/i.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  private async readSharedAbility(filePath: string): Promise<SharedAbility> {
    const raw = YAML.parse(await fs.readFile(filePath, "utf8")) as unknown;
    const record = this.isRecord(raw) ? raw : {};
    const relativeFile = this.relativePath(filePath);
    const fallbackId = relativeFile
      .replace(/^cases\/shared\//, "")
      .replace(/\.(ya?ml)$/i, "");
    const sharedId = this.stringValue(record.shared_id) || this.stringValue(record.sharedId) || fallbackId;

    return {
      sharedId,
      name: this.stringValue(record.name) || sharedId,
      description: this.stringValue(record.description) || undefined,
      tags: this.normalizeSharedTags(record.tags),
      params: this.normalizeSharedParams(record.params),
      stepCount: this.countSharedSteps(record),
      file: relativeFile
    };
  }

  private normalizeSharedTags(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((item) => this.stringValue(item)).filter(Boolean);
  }

  private normalizeSharedParams(value: unknown): SharedAbilityParam[] {
    if (!this.isRecord(value)) {
      return [];
    }
    return Object.entries(value).map(([name, rawDefinition]) => {
      const definition = this.isRecord(rawDefinition) ? rawDefinition : {};
      return {
        name,
        required: definition.required === true || undefined,
        defaultValue: this.stringValue(definition.default) || undefined,
        description: this.stringValue(definition.description) || undefined
      };
    });
  }

  private countSharedSteps(template: Record<string, unknown>): number {
    const directSteps = Array.isArray(template.steps) ? template.steps.length : 0;
    const phases = this.isRecord(template.phases) ? template.phases : {};
    const phaseSteps = Object.values(phases).reduce<number>((total, value) => total + (Array.isArray(value) ? value.length : 0), 0);
    return directSteps + phaseSteps;
  }

  private attachmentBaseDir(): string {
    const baseDir = path.resolve(this.rootDir, this.platformConfig.uploads.caseAttachmentBaseDir);
    this.assertInsideRoot(baseDir, "附件目录必须位于项目根目录内");
    return baseDir;
  }

  private attachmentCaseDir(caseId: string): string {
    const baseDir = this.attachmentBaseDir();
    const normalizedCaseId = this.normalizeAttachmentCaseId(caseId);
    const caseDir = path.resolve(baseDir, normalizedCaseId);
    this.assertInside(caseDir, baseDir, "附件用例目录非法");
    return caseDir;
  }

  private async deleteAttachmentDirectory(caseId: string): Promise<boolean> {
    const caseDir = this.attachmentCaseDir(caseId);
    const exists = await fs.stat(caseDir).then((stat) => stat.isDirectory()).catch(() => false);
    if (!exists) {
      return false;
    }
    await fs.rm(caseDir, { recursive: true, force: true });
    return true;
  }

  private async walkAttachmentEntries(
    currentDir: string,
    query: string,
    results: CaseAttachmentSearchResult[],
    limit: number
  ): Promise<void> {
    if (results.length >= limit) {
      return;
    }
    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    });

    for (const entry of entries) {
      if (results.length >= limit) {
        return;
      }
      const entryPath = path.resolve(currentDir, entry.name);
      this.assertInside(entryPath, this.attachmentBaseDir(), "附件搜索路径非法");
      const relativePath = this.relativePath(entryPath);
      const matches = !query || entry.name.toLowerCase().includes(query) || relativePath.toLowerCase().includes(query);
      if (entry.isDirectory()) {
        if (matches) {
          results.push({ kind: "directory", name: entry.name, file: relativePath });
        }
        await this.walkAttachmentEntries(entryPath, query, results, limit);
      } else if (entry.isFile() && matches) {
        const stat = await fs.stat(entryPath);
        results.push({ kind: "file", name: entry.name, file: relativePath, sizeBytes: stat.size });
      }
    }
  }

  private relativePath(filePath: string): string {
    return path.relative(this.rootDir, filePath).replace(/\\/g, "/");
  }

  private normalizeAttachmentCaseId(value: string): string {
    const normalized = this.normalizeCaseId(value).replace(/[^a-z0-9_-]/g, "_").replace(/^_+|_+$/g, "");
    return normalized || "_draft";
  }

  private safeAttachmentFileName(value: string): string {
    const baseName = path.basename(value.replace(/\\/g, "/"));
    const parsed = path.parse(baseName);
    const stem = parsed.name
      .normalize("NFKC")
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/^\.+|\.+$/g, "")
      .slice(0, 96);
    const ext = parsed.ext
      .normalize("NFKC")
      .replace(/[^.\p{L}\p{N}_-]/gu, "")
      .slice(0, 24);
    return `${stem || "attachment"}${ext || ".bin"}`;
  }

  private async nextAvailableAttachmentPath(caseDir: string, fileName: string): Promise<string> {
    const parsed = path.parse(fileName);
    for (let index = 0; index < 1000; index += 1) {
      const suffix = index === 0 ? "" : `-${index + 1}`;
      const candidate = path.resolve(caseDir, `${parsed.name}${suffix}${parsed.ext}`);
      this.assertInside(candidate, caseDir, "附件文件路径非法");
      const exists = await fs.stat(candidate).then(() => true).catch(() => false);
      if (!exists) {
        return candidate;
      }
    }
    throw new Error(`附件重名过多：${fileName}`);
  }

  private assertInsideRoot(targetPath: string, message: string): void {
    this.assertInside(targetPath, path.resolve(this.rootDir), message);
  }

  private assertInside(targetPath: string, parentDir: string, message: string): void {
    const target = path.resolve(targetPath);
    const parent = path.resolve(parentDir);
    if (target !== parent && !target.startsWith(parent + path.sep)) {
      throw new Error(message);
    }
  }

  private async listScenarioFiles(): Promise<string[]> {
    const scenarioDir = this.scenarioDir();
    const files = await fs.readdir(scenarioDir);
    return files
      .filter((item) => item.endsWith(".yaml") || item.endsWith(".yml"))
      .map((item) => path.resolve(scenarioDir, item))
      .filter((filePath) => filePath.startsWith(scenarioDir + path.sep));
  }

  private async assertCaseNameAvailable(caseName: string, files: string[], excludeCaseId?: string): Promise<void> {
    const targetName = this.normalizeCaseName(caseName);
    if (!targetName) {
      return;
    }
    for (const filePath of files) {
      const content = await fs.readFile(filePath, "utf8");
      const validation = await this.validateScenarioContentForRun(content);
      const existingCaseId = validation.caseId ?? this.caseIdFromFilePath(filePath);
      if (excludeCaseId && existingCaseId === excludeCaseId) {
        continue;
      }
      if (validation.caseName && this.normalizeCaseName(validation.caseName) === targetName) {
        throw new Error(`用例名称已存在：${caseName}`);
      }
    }
  }

  private caseIdFromFilePath(filePath: string): string {
    return path.basename(filePath).replace(/\.(ya?ml)$/i, "");
  }

  private normalizeCaseName(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
  }

  private normalizeContent(content: string): string {
    const normalized = content.replace(/\r\n?/g, "\n");
    const withCaseType = this.ensureCaseType(normalized);
    return withCaseType.endsWith("\n") ? withCaseType : `${withCaseType}\n`;
  }

  private normalizeAiYamlShape(content: string): string {
    try {
      const raw = YAML.parse(content) as unknown;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return content;
      }

      const scenario = raw as Record<string, unknown>;
      scenario.case_type = this.normalizeCaseType(this.stringValue(scenario.case_type) || this.stringValue(scenario.caseType));
      delete scenario.caseType;
      const sessions = this.normalizeAiSessions(scenario.sessions);
      let steps = this.normalizeAiSteps(scenario.steps, sessions);
      let variables = this.normalizeAiVariables(scenario.variables, steps);
      steps = this.normalizeAiStepSafety(this.ensureLoginOpenSteps(steps), variables, sessions);
      steps = this.normalizeAdminPerinfoStepsIfNeeded(scenario, steps, sessions);
      variables = this.normalizeAiVariables(variables, steps);

      scenario.sessions = sessions;
      scenario.steps = steps;
      scenario.defaults = this.normalizeAiDefaults(scenario.defaults);
      if (Object.keys(variables).length) {
        scenario.variables = variables;
      } else {
        delete scenario.variables;
      }
      scenario.mode = this.normalizeAiMode(scenario.mode, sessions);
      scenario.locations = this.normalizeAiLocations(scenario.locations, sessions);

      return YAML.stringify(scenario).trim();
    } catch {
      return content;
    }
  }

  private normalizeAiSessions(value: unknown): Array<Record<string, unknown>> {
    const sessions = Array.isArray(value) ? value.filter(this.isRecord) : [];
    const normalized = sessions.map((session) => {
      const name = this.sessionName(session.name);
      const loginUrl = this.stringValue(session.login_url)
        || this.stringValue(session.loginUrl)
        || this.stringValue(session.url)
        || this.defaultLoginUrl(name);

      return {
        ...session,
        name,
        login_url: loginUrl,
        username: this.stringValue(session.username) || this.defaultUsername(name),
        password: this.stringValue(session.password) || this.defaultPassword(name)
      };
    });

    return normalized.length ? normalized : [
      {
        name: "user",
        login_url: "${env.USER_LOGIN_URL}",
        username: "${env.USER_USERNAME}",
        password: "${env.USER_PASSWORD}"
      }
    ];
  }

  private normalizeAiDefaults(value: unknown): { step_timeout_ms: number; wait_for_network: boolean } {
    const defaults = this.isRecord(value) ? value : {};
    const rawTimeout = Number(defaults.step_timeout_ms ?? defaults.timeout_ms ?? defaults.timeoutMs);
    return {
      step_timeout_ms: Number.isFinite(rawTimeout) && rawTimeout > 0 ? Math.floor(rawTimeout) : 20_000,
      wait_for_network: typeof defaults.wait_for_network === "boolean" ? defaults.wait_for_network : true
    };
  }

  private normalizeAiSteps(value: unknown, sessions: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const steps = Array.isArray(value) ? value.filter(this.isRecord) : [];
    return steps.map((step, index) => {
      const normalized = { ...step };
      const session = this.sessionName(normalized.session);
      const stepId = this.stringValue(normalized.step_id)
        || this.stringValue(normalized.stepId)
        || this.stringValue(normalized.id)
        || this.stringValue(normalized.key)
        || this.defaultStepId(session, normalized.type, index);
      const name = this.stringValue(normalized.name)
        || this.stringValue(normalized.title)
        || this.stringValue(normalized.label)
        || this.stringValue(normalized.description)
        || stepId;

      normalized.step_id = this.normalizeStepId(stepId, index);
      normalized.name = name;
      normalized.type = this.normalizeStepType(normalized.type, normalized.action, normalized.name);
      const normalizedSession = this.normalizeAiStepSession(normalized.type, session, sessions);
      if (normalizedSession) {
        normalized.session = normalizedSession;
      } else {
        delete normalized.session;
      }
      normalized.target = this.normalizeAiTarget(this.stringValue(normalized.target)
        || this.stringValue(normalized.locator)
        || this.stringValue(normalized.selector)
        || this.stringValue(normalized.element)
        || undefined);
      normalized.file = this.stringValue(normalized.file)
        || this.stringValue(normalized.file_path)
        || this.stringValue(normalized.filePath)
        || undefined;
      const expectedText = this.stringValue(normalized.expected)
        || this.stringValue(normalized.text)
        || this.stringValue(normalized.assertion)
        || undefined;
      normalized.expected = expectedText || (this.isRecord(normalized.expected) ? normalized.expected : undefined);
      normalized.url = this.normalizeAiUrl(this.stringValue(normalized.url) || this.stringValue(normalized.href) || this.stringValue(normalized.path));
      normalized.value = this.stringValue(normalized.value)
        || (normalized.type === "web_input" ? this.stringValue(normalized.text) : "")
        || undefined;
      if (normalized.type === "web_input") {
        delete normalized.text;
      }

      if (normalized.type === "flow_login") {
        normalized.username = this.stringValue(normalized.username) || "${session.username}";
        normalized.password = this.stringValue(normalized.password) || "${session.password}";
      }

      return normalized;
    });
  }

  private normalizeAiVariables(value: unknown, steps: Array<Record<string, unknown>>): Record<string, string> {
    const variables: Record<string, string> = {};
    if (this.isRecord(value)) {
      for (const [key, rawValue] of Object.entries(value)) {
        const variableName = this.normalizeVariableName(key);
        const variableValue = this.stringValue(rawValue);
        if (variableName && variableValue) {
          variables[variableName] = variableValue;
        }
      }
    }

    for (const variableName of this.collectVariableRefs(steps)) {
      if (variables[variableName] || this.isFileLikeVariable(variableName)) {
        continue;
      }
      variables[variableName] = this.defaultVariableValue(variableName);
    }

    return variables;
  }

  private normalizeAiStepSafety(
    steps: Array<Record<string, unknown>>,
    variables: Record<string, string>,
    sessions: Array<Record<string, unknown>>
  ): Array<Record<string, unknown>> {
    return steps
      .filter((step) => {
        if (step.type === "db_clean") {
          return false;
        }
        if (this.isDbStepType(step.type)) {
          return !this.isUnsafeGeneratedDbStep(step, sessions);
        }
        if (step.type !== "web_upload") {
          return true;
        }
        const file = this.stringValue(step.file);
        if (!file) {
          return false;
        }
        const missingFileVariable = [...file.matchAll(/\$\{var\.([^}]+)\}/g)]
          .some((match) => !variables[this.normalizeVariableName(match[1] ?? "")]);
        return !missingFileVariable;
      })
      .map((step) => {
        const normalized = { ...step };
        if (this.isDbStepType(normalized.type)) {
          delete normalized.session;
        }
        if (normalized.type === "web_assert_text" && !this.stringValue(normalized.target) && this.stringValue(normalized.expected)) {
          normalized.target = this.stringValue(normalized.expected);
        }
        return normalized;
      });
  }

  private normalizeAiStepSession(type: unknown, session: "user" | "admin", sessions: Array<Record<string, unknown>>): "user" | "admin" | undefined {
    if (this.isDbStepType(type)) {
      return undefined;
    }
    const names = new Set(sessions.map((item) => this.sessionName(item.name)));
    if (names.has(session)) {
      return session;
    }
    return this.sessionName(sessions[0]?.name);
  }

  private isDbStepType(type: unknown): boolean {
    return type === "db_query" || type === "db_assert";
  }

  private isUnsafeGeneratedDbStep(step: Record<string, unknown>, sessions: Array<Record<string, unknown>>): boolean {
    const sql = this.stringValue(step.sql);
    if (!/^\s*(select|show|desc|describe|explain)\b/i.test(sql)) {
      return true;
    }
    if (step.type === "db_assert" && !this.hasExpectedValue(step.expected)) {
      return true;
    }

    const allowedEnvRefs = this.allowedSessionEnvRefs(sessions);
    return this.collectEnvRefs(step).some((envName) => !allowedEnvRefs.has(envName));
  }

  private hasExpectedValue(value: unknown): boolean {
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    if (this.isRecord(value)) {
      return Object.keys(value).length > 0;
    }
    return typeof value === "number" || typeof value === "boolean";
  }

  private allowedSessionEnvRefs(sessions: Array<Record<string, unknown>>): Set<string> {
    return new Set(sessions.flatMap((session) => this.collectEnvRefs(session)));
  }

  private collectEnvRefs(value: unknown): string[] {
    if (typeof value === "string") {
      return [...value.matchAll(/\$\{env\.([^}]+)\}/g)]
        .map((match) => (match[1] ?? "").trim())
        .filter(Boolean);
    }
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.collectEnvRefs(item));
    }
    if (this.isRecord(value)) {
      return Object.values(value).flatMap((item) => this.collectEnvRefs(item));
    }
    return [];
  }

  private normalizeAiTarget(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    const locationRef = value.match(/^\$\{loc\.([A-Za-z0-9_-]+)\}$/);
    return locationRef?.[1] || value;
  }

  private normalizeAdminPerinfoStepsIfNeeded(
    scenario: Record<string, unknown>,
    steps: Array<Record<string, unknown>>,
    sessions: Array<Record<string, unknown>>
  ): Array<Record<string, unknown>> {
    const hasAdmin = sessions.some((session) => session.name === "admin");
    const contextText = [
      this.stringValue(scenario.case_id),
      this.stringValue(scenario.case_name),
      this.stringValue(scenario.description),
      YAML.stringify(steps)
    ].join("\n");
    if (!hasAdmin || !/(perinfo|个人信息|修改资料|用户名称|登录密码)/i.test(contextText)) {
      return steps;
    }

    const normalized: Array<Record<string, unknown>> = [];
    let insertedPerinfoOpen = steps.some((step) => this.stringValue(step.url).includes("/admin/sys/perinfo"));

    for (const step of steps) {
      const stepText = [
        this.stringValue(step.step_id),
        this.stringValue(step.name),
        this.stringValue(step.target),
        this.stringValue(step.url)
      ].join(" ");

      if (step.type === "web_click" && /(系统|个人信息)/.test(stepText)) {
        continue;
      }
      if (step.type === "web_wait_element" && /(编辑个人信息|个人信息区域|perinfo)/i.test(stepText)) {
        continue;
      }

      normalized.push(this.normalizeAdminPerinfoStep(step));

      if (!insertedPerinfoOpen && step.type === "flow_login" && this.sessionName(step.session) === "admin") {
        normalized.push({
          step_id: this.uniqueStepId("admin_open_perinfo", [...normalized, ...steps]),
          name: "admin 打开个人信息页",
          type: "web_open",
          session: "admin",
          url: "${session.login_url}#/admin/sys/perinfo"
        });
        insertedPerinfoOpen = true;
      }
    }

    return normalized;
  }

  private normalizeAdminPerinfoStep(step: Record<string, unknown>): Record<string, unknown> {
    const normalized = { ...step };
    const target = this.stringValue(normalized.target);
    const name = this.stringValue(normalized.name);
    const combined = `${name} ${target}`;

    if (/用户名称/.test(combined)) {
      normalized.target = "admin_profile_username";
    } else if (/登录密码/.test(combined)) {
      normalized.target = "admin_profile_password";
    } else if (/保存/.test(combined) && normalized.type === "web_click") {
      normalized.target = "admin_profile_save";
      normalized.wait_for_api = {
        method: "POST",
        url: "/user/baseInfo/edit",
        expected_status: 200,
        business_code_path: this.defaultApiBusinessCodePath(),
        success_codes: [this.defaultApiSuccessCode()],
        success: {
          body_path: this.defaultApiBusinessCodePath(),
          equals: this.defaultApiSuccessCode()
        }
      };
    } else if (/(保存成功|修改成功)/.test(combined)) {
      normalized.target = "admin_profile_success_message";
      normalized.expected = "修改成功";
    }

    return normalized;
  }

  private ensureLoginOpenSteps(steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const normalized: Array<Record<string, unknown>> = [];
    const openedSessions = new Set<string>();

    for (const step of steps) {
      const session = this.sessionName(step.session);
      const isOpenStep = step.type === "web_open";
      if (isOpenStep) {
        openedSessions.add(session);
      }

      if (step.type === "flow_login" && !openedSessions.has(session)) {
        normalized.push({
          step_id: this.uniqueStepId(`${session}_open_login`, [...normalized, ...steps]),
          name: `${session} 打开登录页`,
          type: "web_open",
          session,
          url: "${session.login_url}"
        });
        openedSessions.add(session);
      }

      normalized.push(step);
    }

    return normalized;
  }

  private uniqueStepId(base: string, steps: Array<Record<string, unknown>>): string {
    const existing = new Set(steps.map((step) => this.stringValue(step.step_id)).filter(Boolean));
    if (!existing.has(base)) {
      return base;
    }
    for (let index = 2; index < 100; index += 1) {
      const candidate = `${base}_${index}`;
      if (!existing.has(candidate)) {
        return candidate;
      }
    }
    return `${base}_${Date.now()}`;
  }

  private normalizeAiUrl(value: string): string | undefined {
    if (!value) {
      return undefined;
    }
    return value
      .replace(/\$\{env\.ADMIN_LOGIN_URL\}\/?#\//g, "${session.login_url}#/")
      .replace(/\$\{env\.USER_LOGIN_URL\}\/?#\//g, "${session.login_url}#/")
      .replace(/\$\{session\.login_url\}\/+#\//g, "${session.login_url}#/");
  }

  private normalizeAiMode(value: unknown, sessions: Array<Record<string, unknown>>): "web" | "hybrid" {
    if (value === "web" || value === "hybrid") {
      return value;
    }
    return sessions.some((session) => session.name === "admin") && sessions.some((session) => session.name === "user")
      ? "hybrid"
      : "web";
  }

  private normalizeAiLocations(value: unknown, sessions: Array<Record<string, unknown>>): { file: string } {
    if (this.isRecord(value)) {
      const file = this.stringValue(value.file) || this.defaultLocationFile(sessions);
      return { ...value, file };
    }
    return { file: this.defaultLocationFile(sessions) };
  }

  private normalizeStepType(type: unknown, action: unknown, name: unknown): string {
    const value = [this.stringValue(type), this.stringValue(action), this.stringValue(name)].filter(Boolean).join(" ").toLowerCase();
    const supported = new Set([
      "web_open", "web_reload", "web_input", "web_click", "web_upload", "web_wait_text", "web_wait_element",
      "web_assert_text", "web_assert_visible", "web_assert_url", "web_extract", "web_screenshot", "flow_login",
      "flow_submit_kyc", "flow_admin_approve_kyc", "api_request", "api_assert", "db_query", "db_assert", "db_clean"
    ]);

    const rawType = this.stringValue(type);
    if (rawType && supported.has(rawType)) {
      return rawType;
    }
    if (value.includes("login") || value.includes("登录")) return "flow_login";
    if (value.includes("open") || value.includes("navigate") || value.includes("打开") || value.includes("进入")) return "web_open";
    if (value.includes("upload") || value.includes("上传")) return "web_upload";
    if (value.includes("input") || value.includes("fill") || value.includes("输入")) return "web_input";
    if (value.includes("assert") || value.includes("visible") || value.includes("断言") || value.includes("可见")) return "web_assert_visible";
    if (value.includes("wait") || value.includes("等待")) return "web_wait_element";
    return "web_click";
  }

  private defaultLocationFile(sessions: Array<Record<string, unknown>>): string {
    const names = new Set(sessions.map((session) => session.name));
    if (names.has("admin") && !names.has("user")) return "cases/location/login.admin.yaml";
    if (names.has("admin") && names.has("user")) return "cases/location/kyc.submit-and-approve.yaml";
    return "cases/location/login.user.yaml";
  }

  private defaultLoginUrl(name: "user" | "admin"): string {
    return name === "admin" ? "${env.ADMIN_LOGIN_URL}" : "${env.USER_LOGIN_URL}";
  }

  private defaultUsername(name: "user" | "admin"): string {
    return name === "admin" ? "${env.ADMIN_USERNAME}" : "${env.USER_USERNAME}";
  }

  private defaultPassword(name: "user" | "admin"): string {
    return name === "admin" ? "${env.ADMIN_PASSWORD}" : "${env.USER_PASSWORD}";
  }

  private collectVariableRefs(value: unknown): string[] {
    if (typeof value === "string") {
      return [...value.matchAll(/\$\{var\.([^}]+)\}/g)]
        .map((match) => this.normalizeVariableName(match[1] ?? ""))
        .filter(Boolean);
    }
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.collectVariableRefs(item));
    }
    if (this.isRecord(value)) {
      return Object.values(value).flatMap((item) => this.collectVariableRefs(item));
    }
    return [];
  }

  private normalizeVariableName(value: string): string {
    return value.trim().replace(/\s+/g, "_");
  }

  private isFileLikeVariable(value: string): boolean {
    return /file|path|avatar|image|upload/i.test(value);
  }

  private defaultVariableValue(value: string): string {
    if (/user|name|title/i.test(value)) {
      return `auto_${"${timestamp}"}`;
    }
    return "${timestamp}";
  }

  private defaultApiBusinessCodePath(): string {
    return (process.env.API_BUSINESS_CODE_PATHS ?? "code")
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)[0] ?? "code";
  }

  private defaultApiSuccessCode(): string {
    return (process.env.API_BUSINESS_SUCCESS_CODES ?? "0000")
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)[0] ?? "0000";
  }

  private defaultStepId(session: "user" | "admin", type: unknown, index: number): string {
    return `${session}_${this.normalizeCaseId(this.stringValue(type) || "step")}_${index + 1}`;
  }

  private normalizeStepId(value: string, index: number): string {
    const normalized = this.normalizeCaseId(value).replace(/^-+|-+$/g, "");
    return /^[a-z][a-z0-9_-]*$/.test(normalized) ? normalized : `step_${index + 1}`;
  }

  private sessionName(value: unknown): "user" | "admin" {
    return this.stringValue(value).toLowerCase() === "admin" ? "admin" : "user";
  }

  private stringValue(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  private normalizeCaseId(caseId: string): string {
    return caseId.trim().replace(/\s+/g, "_").toLowerCase();
  }

  private normalizeCaseType(caseType?: string): string {
    const normalized = (caseType ?? "").trim().toLowerCase();
    return /^[a-z][a-z0-9_-]{1,31}$/.test(normalized) ? normalized : "uncategorized";
  }

  private ensureCaseType(content: string): string {
    if (/^case_type\s*:/m.test(content) || /^caseType\s*:/m.test(content)) {
      return content;
    }
    const lines = content.split("\n");
    const insertIndex = lines.findIndex((line) => /^case_name\s*:/.test(line));
    if (insertIndex >= 0) {
      lines.splice(insertIndex + 1, 0, "case_type: uncategorized");
      return lines.join("\n");
    }
    const caseIdIndex = lines.findIndex((line) => /^case_id\s*:/.test(line));
    lines.splice(caseIdIndex >= 0 ? caseIdIndex + 1 : 0, 0, "case_type: uncategorized");
    return lines.join("\n");
  }

  private buildCaseYaml(input: Required<Omit<CreateCaseInput, "description">> & { description?: string }): string {
    const description = input.description || this.defaultDescription(input.template);
    const body = this.templateBody(input.template);

    return [
      `case_id: ${input.caseId}`,
      `case_name: ${this.quoteYaml(input.caseName)}`,
      `case_type: ${input.caseType}`,
      `description: ${this.quoteYaml(description)}`,
      `mode: ${body.mode}`,
      "defaults:",
      "  step_timeout_ms: 20000",
      "  wait_for_network: true",
      "sessions:",
      ...body.sessions,
      "locations:",
      `  file: "${body.locationFile}"`,
      "steps:",
      ...body.steps,
      ""
    ].join("\n");
  }

  private templateBody(template: CaseTemplate): { mode: "web" | "hybrid"; locationFile: string; sessions: string[]; steps: string[] } {
    if (template === "admin_login") {
      return {
        mode: "web",
        locationFile: "cases/location/login.admin.yaml",
        sessions: [
          "  - name: admin",
          "    login_url: \"${env.ADMIN_LOGIN_URL}\"",
          "    username: \"${env.ADMIN_USERNAME}\"",
          "    password: \"${env.ADMIN_PASSWORD}\""
        ],
        steps: [
          "  - step_id: admin_open_login",
          "    name: admin 打开登录页",
          "    type: web_open",
          "    session: admin",
          "    url: \"${session.login_url}\"",
          "  - step_id: admin_login",
          "    name: admin 登录",
          "    type: flow_login",
          "    session: admin",
          "    username: \"${session.username}\"",
          "    password: \"${session.password}\"",
          "  - step_id: admin_assert_home_visible",
          "    name: admin 登录后页面可见",
          "    type: web_assert_visible",
          "    session: admin",
          "    target: admin_home_marker",
          "    continue_on_failure: true"
        ]
      };
    }

    if (template === "user_admin_kyc") {
      return {
        mode: "hybrid",
        locationFile: "cases/location/kyc.submit-and-approve.yaml",
        sessions: [
          "  - name: user",
          "    login_url: \"${env.USER_LOGIN_URL}\"",
          "    username: \"${env.USER_USERNAME}\"",
          "    password: \"${env.USER_PASSWORD}\"",
          "  - name: admin",
          "    login_url: \"${env.ADMIN_LOGIN_URL}\"",
          "    username: \"${env.ADMIN_USERNAME}\"",
          "    password: \"${env.ADMIN_PASSWORD}\""
        ],
        steps: [
          "  - step_id: user_open_login",
          "    name: user 打开登录页",
          "    type: web_open",
          "    session: user",
          "    url: \"${session.login_url}\"",
          "  - step_id: user_login",
          "    name: user 登录",
          "    type: flow_login",
          "    session: user",
          "    username: \"${session.username}\"",
          "    password: \"${session.password}\"",
          "  - step_id: user_submit_kyc",
          "    name: user 提交 KYC",
          "    type: flow_submit_kyc",
          "    session: user",
          "  - step_id: admin_open_login",
          "    name: admin 打开登录页",
          "    type: web_open",
          "    session: admin",
          "    url: \"${session.login_url}\"",
          "  - step_id: admin_login",
          "    name: admin 登录",
          "    type: flow_login",
          "    session: admin",
          "    username: \"${session.username}\"",
          "    password: \"${session.password}\"",
          "  - step_id: admin_approve_kyc",
          "    name: admin 审核通过 KYC",
          "    type: flow_admin_approve_kyc",
          "    session: admin"
        ]
      };
    }

    return {
      mode: "web",
      locationFile: "cases/location/login.user.yaml",
      sessions: [
        "  - name: user",
        "    login_url: \"${env.USER_LOGIN_URL}\"",
        "    username: \"${env.USER_USERNAME}\"",
        "    password: \"${env.USER_PASSWORD}\""
      ],
      steps: [
        "  - step_id: user_open_login",
        "    name: user 打开登录页",
        "    type: web_open",
        "    session: user",
        "    url: \"${session.login_url}\"",
        "  - step_id: user_login",
        "    name: user 登录",
        "    type: flow_login",
        "    session: user",
        "    username: \"${session.username}\"",
        "    password: \"${session.password}\"",
        "  - step_id: user_assert_home_visible",
        "    name: user 登录后页面可见",
        "    type: web_assert_visible",
        "    session: user",
        "    target: user_home_marker",
        "    continue_on_failure: true"
      ]
    };
  }

  private defaultDescription(template: CaseTemplate): string {
    const descriptions: Record<CaseTemplate, string> = {
      user_login: "user 登录流程，用于验证用户端登录入口、账号密码提交和登录后页面可见性。",
      admin_login: "admin 登录流程，用于验证管理端登录入口、账号密码提交和登录后页面可见性。",
      user_admin_kyc: "user 提交 KYC 后由 admin 审核的端到端流程骨架。"
    };
    return descriptions[template];
  }

  private quoteYaml(value: string): string {
    return JSON.stringify(value);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error !== null && typeof error === "object" && "code" in error;
}
