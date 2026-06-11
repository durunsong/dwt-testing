export interface UploadStepOption {
  stepId: string;
  name: string;
  target?: string;
  file?: string;
}

export type AttachmentUsageTone = "active" | "linked" | "unused";

export interface AttachmentPromptFile {
  name: string;
  file: string;
}

export interface AttachmentPromptInput {
  caseId: string;
  file: string;
  step?: UploadStepOption;
}

export interface AttachmentBatchPromptInput {
  caseId: string;
  files: AttachmentPromptFile[];
  steps?: UploadStepOption[];
}

export interface NewUploadStepInput {
  stepId: string;
  name: string;
  session: string;
  target: string;
  file: string;
  beforeTarget?: string;
}

export interface AttachmentSearchItem {
  kind: "file" | "directory";
  file: string;
}

export interface AttachmentPathItem {
  file: string;
}

export interface ImageAttachmentCheckInput {
  name?: string;
  file?: string;
  mimeType?: string;
}

export function filterNewAttachmentSearchResults<T extends AttachmentSearchItem>(
  results: T[],
  existingAttachments: AttachmentPathItem[]
): T[] {
  const existingFiles = new Set(existingAttachments.map((item) => item.file));
  return results.filter((item) => item.kind === "directory" || !existingFiles.has(item.file));
}

export function appendInstructionBlock(current: string, block: string): string {
  const existing = current.trim();
  const next = block.trim();
  if (!next) {
    return existing;
  }
  return [existing, next].filter(Boolean).join("\n\n");
}

export function isImageAttachmentFile(input: ImageAttachmentCheckInput): boolean {
  if (input.mimeType?.toLowerCase().startsWith("image/")) {
    return true;
  }
  return [input.name, input.file].some((value) => /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(value ?? ""));
}

export function buildAttachmentAiPrompt(input: AttachmentPromptInput): string {
  return buildAttachmentBatchAiPrompt({
    caseId: input.caseId,
    files: [{ name: fileNameFromPath(input.file), file: input.file }],
    steps: input.step ? [input.step] : undefined
  });
}

export function buildAttachmentBatchAiPrompt(input: AttachmentBatchPromptInput): string {
  const files = uniquePromptFiles(input.files);
  const steps = input.steps ?? [];
  const suggestedStep = adminProfileAvatarSuggestion(input.caseId, files, steps);
  const firstStep = steps[0] ?? suggestedStep;
  const target = firstStep?.target || "<请填写或选择正确的上传控件 target>";
  const file = files[0]?.file || "uploads/cases/<case_id>/<file_name>";
  const stepId = suggestedStep?.stepId ?? "upload_xxx";
  const stepName = suggestedStep?.name ?? "上传xxx";

  return [
    `请完善当前 YAML 用例 ${input.caseId} 中的附件上传流程。`,
    "",
    "适用场景：",
    "- 简单表单可以只有一个 web_upload 步骤。",
    "- 复杂表单可能需要上传多张图片或多个附件，请为每一个实际上传控件配置独立的 web_upload 步骤。",
    "- 同一个路径可以被多个上传步骤复用，不要把项目相对路径改成电脑本地路径。",
    "- 步骤名称使用真实业务含义；如果暂时无法判断，name 可以先写成“上传xxx”。",
    ...(suggestedStep ? ["- 当前用例像是 admin 个人资料头像上传，请优先在 admin_profile_save 保存前新增 upload_avatar，并使用 target: admin_avatar_upload。"] : []),
    "",
    "可用附件路径：",
    ...files.map((item, index) => `${index + 1}. ${item.name} -> ${item.file}`),
    "",
    "已有 web_upload 步骤参考：",
    ...(steps.length
      ? steps.map((step) => `- ${step.stepId} / ${step.name}${step.target ? ` / target: ${step.target}` : ""}`)
      : ["- 当前 YAML 中还没有 web_upload 步骤，请按业务顺序新增。"]),
    "",
    "修改要求：",
    "1. 只修改上传相关步骤，保持 case_id、sessions、locations、登录步骤、表单填写步骤和已有断言不变。",
    "2. 上传步骤必须放在进入目标表单之后、提交或保存按钮之前。",
    "3. 每个 web_upload 步骤都必须包含 step_id、name、type、session、target、file。",
    "4. file 使用上方列出的项目相对路径，可以一张图对应一步，也可以同一路径复用到多步。",
    "5. 如果已有 web_upload 步骤与业务含义匹配，只更新 target/file/name；如果不匹配，请新增清晰的步骤。",
    "",
    "建议步骤片段：",
    "```yaml",
    `  - step_id: ${stepId}`,
    `    name: ${stepName}`,
    "    type: web_upload",
    "    session: admin",
    `    target: ${target}`,
    `    file: ${file}`,
    "```"
  ].join("\n");
}

export function normalizeAttachmentPath(path: string): string {
  return path.trim().replace(/\\/g, "/");
}

export function isConcreteAttachmentPath(file?: string): boolean {
  if (!file) {
    return false;
  }
  const normalized = normalizeAttachmentPath(file);
  if (!normalized || normalized.includes("${")) {
    return false;
  }
  return normalized.startsWith("uploads/");
}

export function buildFileToUploadStepsMap(steps: UploadStepOption[]): Map<string, UploadStepOption[]> {
  const map = new Map<string, UploadStepOption[]>();
  for (const step of steps) {
    if (!isConcreteAttachmentPath(step.file)) {
      continue;
    }
    const key = normalizeAttachmentPath(step.file!);
    const existing = map.get(key) ?? [];
    existing.push(step);
    map.set(key, existing);
  }
  return map;
}

export function getStepsUsingFile(file: string, map: Map<string, UploadStepOption[]>): UploadStepOption[] {
  return map.get(normalizeAttachmentPath(file)) ?? [];
}

export function resolveAttachmentUsageTone(
  file: string,
  activeStepId: string | undefined,
  map: Map<string, UploadStepOption[]>
): AttachmentUsageTone {
  const linkedSteps = getStepsUsingFile(file, map);
  if (!linkedSteps.length) {
    return "unused";
  }
  if (activeStepId && linkedSteps.some((step) => step.stepId === activeStepId)) {
    return "active";
  }
  return "linked";
}

export function collectUploadSteps(content: string): UploadStepOption[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const steps: UploadStepOption[] = [];
  let current: UploadStepOption & { type?: string } | undefined;

  const flush = () => {
    if (current?.stepId && current.type === "web_upload") {
      steps.push({
        stepId: current.stepId,
        name: current.name ?? "web_upload",
        target: current.target,
        file: current.file
      });
    }
  };

  for (const line of lines) {
    const stepStart = line.match(/^\s*-\s+step_id:\s*(.+?)\s*$/);
    if (stepStart) {
      flush();
      current = { stepId: unquoteYamlScalar(stepStart[1] ?? ""), name: "web_upload" };
      continue;
    }
    if (!current) {
      continue;
    }
    const field = line.match(/^\s+(name|type|target|file):\s*(.+?)\s*$/);
    if (field?.[1] === "name") {
      current.name = unquoteYamlScalar(field[2] ?? "");
    } else if (field?.[1] === "type") {
      current.type = unquoteYamlScalar(field[2] ?? "");
    } else if (field?.[1] === "target") {
      current.target = unquoteYamlScalar(field[2] ?? "");
    } else if (field?.[1] === "file") {
      current.file = unquoteYamlScalar(field[2] ?? "");
    }
  }
  flush();
  return steps;
}

export function upsertUploadStepFile(content: string, stepId: string, file: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const startIndex = lines.findIndex((line) => {
    const match = line.match(/^\s*-\s+step_id:\s*(.+?)\s*$/);
    return match ? unquoteYamlScalar(match[1] ?? "") === stepId : false;
  });
  if (startIndex < 0) {
    return content;
  }

  const stepIndent = lines[startIndex]?.match(/^(\s*)-/)?.[1] ?? "  ";
  const fieldIndent = `${stepIndent}  `;
  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (lines[index]?.startsWith(`${stepIndent}- `)) {
      endIndex = index;
      break;
    }
  }

  const fileIndex = lines.findIndex((line, index) => index > startIndex && index < endIndex && line.trimStart().startsWith("file:"));
  const fileLine = `${fieldIndent}file: ${quoteYamlScalar(file)}`;
  if (fileIndex >= 0) {
    lines[fileIndex] = fileLine;
  } else {
    lines.splice(endIndex, 0, fileLine);
  }

  return lines.join("\n");
}

export function insertUploadStepBeforeSubmit(content: string, input: NewUploadStepInput): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const insertIndex = findStepIndexByTarget(lines, input.beforeTarget) ?? lines.length;
  const stepIndent = inferStepIndent(lines) || "  ";
  const fieldIndent = `${stepIndent}  `;
  const stepLines = [
    `${stepIndent}- step_id: ${input.stepId}`,
    `${fieldIndent}name: ${input.name}`,
    `${fieldIndent}type: web_upload`,
    `${fieldIndent}session: ${input.session}`,
    `${fieldIndent}target: ${input.target}`,
    `${fieldIndent}file: ${quoteYamlScalar(input.file)}`,
    `${fieldIndent}wait_for_network: true`
  ];

  lines.splice(insertIndex, 0, ...stepLines);
  return lines.join("\n");
}

function uniquePromptFiles(files: AttachmentPromptFile[]): AttachmentPromptFile[] {
  const seen = new Set<string>();
  return files.filter((item) => {
    const file = item.file.trim();
    if (!file || seen.has(file)) {
      return false;
    }
    seen.add(file);
    return true;
  });
}

function fileNameFromPath(file: string): string {
  return file.split(/[\\/]/).filter(Boolean).pop() || file;
}

function adminProfileAvatarSuggestion(caseId: string, files: AttachmentPromptFile[], steps: UploadStepOption[]): UploadStepOption | undefined {
  if (steps.length || files.length !== 1) {
    return undefined;
  }
  const file = files[0];
  if (!file || !/^admin_/i.test(caseId) || !isImageAttachmentFile(file)) {
    return undefined;
  }
  return {
    stepId: "upload_avatar",
    name: "上传头像",
    target: "admin_avatar_upload"
  };
}

function inferStepIndent(lines: string[]): string {
  const stepLine = lines.find((line) => /^\s*-\s+step_id:/.test(line));
  return stepLine?.match(/^(\s*)-/)?.[1] ?? "";
}

function findStepIndexByTarget(lines: string[], target: string | undefined): number | undefined {
  if (!target) {
    return undefined;
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*-\s+step_id:/.test(lines[index] ?? "")) {
      continue;
    }
    let endIndex = lines.length;
    const stepIndent = lines[index]?.match(/^(\s*)-/)?.[1] ?? "  ";
    for (let next = index + 1; next < lines.length; next += 1) {
      if (lines[next]?.startsWith(`${stepIndent}- `)) {
        endIndex = next;
        break;
      }
    }
    const hasTarget = lines
      .slice(index + 1, endIndex)
      .some((line) => line.trim() === `target: ${target}` || line.trim() === `target: "${target}"` || line.trim() === `target: '${target}'`);
    if (hasTarget) {
      return index;
    }
  }
  return undefined;
}

function quoteYamlScalar(value: string): string {
  return JSON.stringify(value);
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
