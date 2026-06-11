import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Checkbox, Col, Drawer, Form, Input, Modal, Row, Segmented, Select, Space, Spin, Tag, Tooltip, Typography, Upload, message } from "antd";
import type { RcFile } from "antd/es/upload";
import { ArrowLeftOutlined, CheckCircleOutlined, CopyOutlined, DeleteOutlined, DownloadOutlined, EyeOutlined, FolderOpenOutlined, LinkOutlined, PaperClipOutlined, PlayCircleOutlined, RobotOutlined, SafetyCertificateOutlined, SaveOutlined, SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { useNavigate, useParams } from "react-router-dom";
import { assistCaseYaml, type AiMaterialFileInput, type CaseYamlAssistMode } from "../../api/ai";
import { caseAttachmentFileUrl, deleteCaseAttachment, getCase, listCaseAttachments, normalizeCaseYaml, preflightCaseContent, saveCase, searchCaseAttachments, uploadCaseAttachment, validateCase } from "../../api/cases";
import { listCaseTypes } from "../../api/settings";
import { createTestRun } from "../../api/testRuns";
import { AiThinking } from "../../components/AiThinking";
import { IMAGE_PREVIEW_MAX_HEIGHT_CLASS, IMAGE_PREVIEW_MODAL_WIDTH } from "../../components/image-preview";
import { PageHeader } from "../../components/PageHeader";
import { YamlEditor } from "../../components/YamlEditor";
import { useCaseStore } from "../../stores/useCaseStore";
import { useSettingStore } from "../../stores/useSettingStore";
import type { CaseAttachmentResult, CaseAttachmentSearchResult, CasePreflightResult, CaseValidationResult } from "../../types/case";
import type { CaseTypeConfig } from "../../types/settings";
import { cn } from "../../utils/cn";
import { createBase64FileCache, createObjectUrlPreview } from "../../utils/local-file";
import { playTypewriterText } from "../../utils/typewriter-text";
import { AttachmentListRow } from "./AttachmentListRow";
import { appendInstructionBlock, buildAttachmentAiPrompt, buildAttachmentBatchAiPrompt, buildFileToUploadStepsMap, collectUploadSteps, filterNewAttachmentSearchResults, getStepsUsingFile, insertUploadStepBeforeSubmit, isConcreteAttachmentPath, isImageAttachmentFile, resolveAttachmentUsageTone, upsertUploadStepFile, type AttachmentPromptFile, type UploadStepOption } from "./attachment-prompt";
import { primaryAttachmentViewAction } from "./attachment-actions";
import { aiYamlPreviewPlaceholder } from "./ai-preview-copy";
import { caseEditorDropCopy, hasFileDrag, resolveCaseEditorDropTarget, type CaseEditorDropTarget } from "./drag-upload";
import { runCaseAfterSave } from "./run-flow";

const attachmentUploadMaxMb = Number(import.meta.env.VITE_APP_CASE_ATTACHMENT_MAX_MB || 20);
const aiMaterialUploadMaxMb = Number(import.meta.env.VITE_APP_UPLOAD_MAX_MB || 8);

const aiModeOptions: Array<{ label: string; value: CaseYamlAssistMode }> = [
  { label: "AI 写", value: "write" },
  { label: "续写", value: "continue" },
  { label: "优化", value: "optimize" },
  { label: "修复", value: "fix" }
];

const aiModeTips: Record<CaseYamlAssistMode, string> = {
  write: "按你的业务说明生成完整 YAML，适合从草稿重建。",
  continue: "保留当前 YAML，在 steps 后面补充新流程。",
  optimize: "整理命名、等待、断言和步骤顺序，不改变业务含义。",
  fix: "结合当前 DSL 校验问题修复 YAML。"
};

interface CaseMetaFormValues {
  caseId: string;
  caseName: string;
  caseType: string;
  description?: string;
}

interface AiInstructionAttachmentItem {
  uid: string;
  name: string;
  mimeType?: string;
  base64: string;
  sizeBytes: number;
  previewUrl?: string;
}

interface ImagePreviewItem {
  name: string;
  previewUrl: string;
}

export default function CaseEditor() {
  const { caseId = "" } = useParams();
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();
  const { activeCase, yaml, validation, setActiveCase, setYaml, setValidation } = useCaseStore();
  const { env } = useSettingStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [preflighting, setPreflighting] = useState(false);
  const [preflight, setPreflight] = useState<CasePreflightResult>();
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMode, setAiMode] = useState<CaseYamlAssistMode>("continue");
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiDraft, setAiDraft] = useState("");
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiTyping, setAiTyping] = useState(false);
  const [aiValidation, setAiValidation] = useState<CaseValidationResult>();
  const [aiError, setAiError] = useState("");
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentDeleting, setAttachmentDeleting] = useState(false);
  const [aiInstructionUploading, setAiInstructionUploading] = useState(false);
  const [attachments, setAttachments] = useState<CaseAttachmentResult[]>([]);
  const [promptAttachment, setPromptAttachment] = useState<CaseAttachmentResult>();
  const [promptFiles, setPromptFiles] = useState<AttachmentPromptFile[]>([]);
  const [promptOpen, setPromptOpen] = useState(false);
  const [attachmentQuery, setAttachmentQuery] = useState("");
  const [attachmentSearching, setAttachmentSearching] = useState(false);
  const [attachmentSearchResults, setAttachmentSearchResults] = useState<CaseAttachmentSearchResult[]>([]);
  const [selectedPromptFiles, setSelectedPromptFiles] = useState<Record<string, AttachmentPromptFile>>({});
  const [aiInstructionAttachments, setAiInstructionAttachments] = useState<AiInstructionAttachmentItem[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<ImagePreviewItem>();
  const [pageDropTarget, setPageDropTarget] = useState<CaseEditorDropTarget>();
  const [caseTypes, setCaseTypes] = useState<CaseTypeConfig[]>([{ key: "uncategorized", label: "未分类", enabled: true, sort: 0 }]);
  const dragDepthRef = useRef(0);
  const localFileBase64CacheRef = useRef(createBase64FileCache());
  const aiInstructionPreviewRevokeRef = useRef(new Map<string, () => void>());
  const uploadSteps = collectUploadSteps(yaml);
  const fileToUploadStepsMap = useMemo(() => buildFileToUploadStepsMap(uploadSteps), [uploadSteps]);
  const selectedPromptFileList = Object.values(selectedPromptFiles);
  const [selectedUploadStepId, setSelectedUploadStepId] = useState<string>();
  const [attachmentStepFilter, setAttachmentStepFilter] = useState(false);
  const [flashAttachmentFile, setFlashAttachmentFile] = useState<string>();
  const attachmentListRef = useRef<HTMLDivElement>(null);
  const effectiveUploadStepId = selectedUploadStepId && uploadSteps.some((step) => step.stepId === selectedUploadStepId)
    ? selectedUploadStepId
    : uploadSteps[0]?.stepId;
  const activeUploadStep = uploadSteps.find((step) => step.stepId === effectiveUploadStepId);
  const referencedAttachmentCount = attachments.filter((item) => getStepsUsingFile(item.file, fileToUploadStepsMap).length > 0).length;
  const activeStepAttachmentCount = attachments.filter((item) => resolveAttachmentUsageTone(item.file, effectiveUploadStepId, fileToUploadStepsMap) === "active").length;
  const visibleAttachments = attachments
    .filter((item) => attachmentMatches(item, attachmentQuery))
    .filter((item) => !attachmentStepFilter || resolveAttachmentUsageTone(item.file, effectiveUploadStepId, fileToUploadStepsMap) === "active");
  const selectedVisibleAttachmentCount = visibleAttachments.filter((item) => selectedPromptFiles[item.file]).length;
  const allVisibleAttachmentsSelected = visibleAttachments.length > 0 && selectedVisibleAttachmentCount === visibleAttachments.length;
  const someVisibleAttachmentsSelected = selectedVisibleAttachmentCount > 0 && !allVisibleAttachmentsSelected;
  const selectedAttachmentFiles = selectedPromptFileList.map((item) => item.file);
  const visibleSearchResults = filterNewAttachmentSearchResults(attachmentSearchResults, attachments);
  const dropCopy = pageDropTarget ? caseEditorDropCopy(pageDropTarget) : undefined;

  useEffect(() => {
    return () => {
      aiInstructionPreviewRevokeRef.current.forEach((revoke) => revoke());
      aiInstructionPreviewRevokeRef.current.clear();
      localFileBase64CacheRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!caseId) return;
    setLoading(true);
    Promise.all([getCase(caseId), listCaseAttachments(caseId)])
      .then(([detail, caseAttachments]) => {
        setActiveCase(detail);
        setValidation(detail.validation);
        setAttachments(caseAttachments);
      })
      .catch((error) => messageApi.error(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
  }, [caseId, messageApi, setActiveCase, setValidation]);

  useEffect(() => {
    listCaseTypes()
      .then((items) => setCaseTypes(items.filter((item) => item.enabled)))
      .catch(() => setCaseTypes([{ key: "uncategorized", label: "未分类", enabled: true, sort: 0 }]));
  }, []);

  useEffect(() => {
    if (!effectiveUploadStepId || !attachmentListRef.current) {
      return;
    }
    const activeFile = activeUploadStep?.file;
    if (!isConcreteAttachmentPath(activeFile)) {
      return;
    }
    const row = attachmentListRef.current.querySelector<HTMLElement>(`[data-attachment-file="${cssEscape(activeFile!)}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeUploadStep?.file, effectiveUploadStepId]);

  useEffect(() => {
    if (!flashAttachmentFile) {
      return;
    }
    const timer = window.setTimeout(() => setFlashAttachmentFile(undefined), 720);
    return () => window.clearTimeout(timer);
  }, [flashAttachmentFile]);

  useEffect(() => {
    const target = resolveCaseEditorDropTarget({ aiOpen, attachmentUploading, aiInstructionUploading });

    const resetDragState = () => {
      dragDepthRef.current = 0;
      setPageDropTarget(undefined);
    };

    const markDragState = (event: DragEvent) => {
      if (!hasFileDrag(event.dataTransfer?.types)) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = target ? "copy" : "none";
      }
      setPageDropTarget(target);
      return true;
    };

    const handleDragEnter = (event: DragEvent) => {
      if (!markDragState(event)) return;
      dragDepthRef.current += 1;
    };

    const handleDragOver = (event: DragEvent) => {
      markDragState(event);
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!hasFileDrag(event.dataTransfer?.types)) return;
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setPageDropTarget(undefined);
      }
    };

    const handleDrop = (event: DragEvent) => {
      if (!hasFileDrag(event.dataTransfer?.types)) return;
      event.preventDefault();
      event.stopPropagation();
      const files = Array.from(event.dataTransfer?.files ?? []);
      resetDragState();
      if (!target || !files.length) {
        return;
      }

      void uploadDroppedFiles(target, files);
    };

    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);
    return () => {
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("dragleave", handleDragLeave);
      document.removeEventListener("drop", handleDrop);
    };
  }, [activeCase?.caseId, aiOpen, aiInstructionUploading, attachmentUploading, caseId]);

  async function handleValidate() {
    try {
      const result = await validateCase(yaml);
      setValidation(result);
      if (result.valid) {
        messageApi.success("DSL 校验通过");
      } else {
        messageApi.warning("DSL 仍有校验问题");
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const result = await saveCase(caseId, yaml);
      setValidation(result.validation);
      if (result.saved) {
        messageApi.success("保存成功");
        if (result.caseId && result.caseId !== caseId) {
          navigate(`/cases/${result.caseId}`, { replace: true });
        }
      } else {
        messageApi.error("保存失败，请先修复校验问题");
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function saveCurrentCaseForRun(): Promise<{ saved: boolean }> {
    setSaving(true);
    try {
      const result = await saveCase(caseId, yaml);
      setValidation(result.validation);
      if (result.saved) {
        messageApi.success("保存成功，准备执行");
      }
      return { saved: result.saved };
    } finally {
      setSaving(false);
    }
  }

  async function handlePreflight(): Promise<CasePreflightResult | undefined> {
    setPreflighting(true);
    try {
      const result = await preflightCaseContent(yaml, env);
      setPreflight(result);
      if (result.runnable) {
        messageApi.success("运行前预检通过");
      } else {
        messageApi.warning(`运行前预检发现 ${result.summary.errors} 个错误`);
      }
      return result;
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : String(error));
      return undefined;
    } finally {
      setPreflighting(false);
    }
  }

  function handleMetaChange(_: Partial<CaseMetaFormValues>, values: CaseMetaFormValues) {
    setYaml(updateYamlMeta(yaml, {
      caseId: normalizeCaseId(values.caseId),
      caseName: values.caseName,
      caseType: values.caseType,
      description: values.description
    }));
  }

  async function handleRun() {
    setRunning(true);
    try {
      const result = await runCaseAfterSave({
        validate: async () => {
          const validationResult = await validateCase(yaml);
          setValidation(validationResult);
          return { valid: validationResult.valid };
        },
        save: saveCurrentCaseForRun,
        preflight: async () => {
          const preflightResult = await handlePreflight();
          return preflightResult ? { runnable: preflightResult.runnable } : undefined;
        },
        start: () => createTestRun({ caseId, env })
      });

      if (result.status === "validation_failed") {
        messageApi.error("DSL 校验失败，请先修复后再执行");
        return;
      }
      if (result.status === "save_failed") {
        messageApi.error("保存失败，请先修复校验问题后再执行");
        return;
      }
      if (result.status === "preflight_failed") {
        messageApi.error("运行前预检未通过，请先修复错误后再执行");
        return;
      }

      navigate(`/runs/${result.runId}`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }

  function openAiAssistant(mode: CaseYamlAssistMode = aiMode) {
    setAiMode(mode);
    setAiOpen(true);
    setAiError("");
    if (!aiDraft) {
      setAiDraft("");
      setAiValidation(undefined);
    }
  }

  async function handleAiGenerate() {
    setAiStreaming(true);
    setAiDraft("");
    setAiValidation(undefined);
    setAiError("");

    try {
      const generated = await assistCaseYaml({
        mode: aiMode,
        caseId,
        currentYaml: yaml,
        instruction: aiInstruction,
        validationIssues: validation?.issues,
        files: aiInstructionAttachments.map(aiInstructionAttachmentToFile)
      });
      const typing = playTypewriterText(generated, {
        maxCharsPerTick: 14,
        onTypingChange: setAiTyping,
        onUpdate: setAiDraft
      });
      await typing.done;

      const normalized = await normalizeCaseYaml(normalizeAiYaml(generated));
      setAiDraft(normalized);
      const result = await validateCase(normalized);
      setAiValidation(result);
      if (result.valid) {
        messageApi.success("AI YAML 已生成并通过校验");
      } else {
        messageApi.warning("AI YAML 已生成，但仍有校验问题，请确认后再应用");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAiError(message);
      messageApi.error(message);
    } finally {
      setAiTyping(false);
      setAiStreaming(false);
    }
  }

  async function handleApplyAiDraft() {
    const normalized = await normalizeCaseYaml(normalizeAiYaml(aiDraft));
    if (!normalized) return;
    const result = aiValidation ?? await validateCase(normalized);
    if (!result.valid) {
      setAiValidation(result);
      messageApi.warning("AI YAML 仍未通过校验，请修复后再应用");
      return;
    }
    setYaml(normalized);
    setValidation(result);
    setAiOpen(false);
    messageApi.success("AI YAML 已应用到编辑器，请确认后保存");
  }

  async function copyAiDraft() {
    if (!aiDraft) return;
    await navigator.clipboard.writeText(await normalizeCaseYaml(normalizeAiYaml(aiDraft)));
    messageApi.success("AI YAML 已复制");
  }

  async function handleAttachmentBeforeUpload(file: RcFile) {
    const maxBytes = attachmentUploadMaxMb * 1024 * 1024;
    if (file.size > maxBytes) {
      messageApi.error(`${file.name} 超过 ${attachmentUploadMaxMb}MB，请压缩或拆分后再上传`);
      return Upload.LIST_IGNORE;
    }

    setAttachmentUploading(true);
    try {
      const result = await uploadCaseAttachment({
        caseId: normalizeCaseId(caseId || activeCase?.caseId || "_draft"),
        fileName: file.name,
        mimeType: file.type,
        base64: await localFileBase64CacheRef.current.read(file)
      });
      setAttachments((items) => [result, ...items.filter((item) => item.file !== result.file)]);
      setSelectedPromptFiles((current) => ({ ...current, [result.file]: attachmentToPromptFile(result) }));
      messageApi.success("已上传附件，可引用到步骤或生成提示词");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : String(error));
    } finally {
      setAttachmentUploading(false);
    }
    return Upload.LIST_IGNORE;
  }

  async function handleAiInstructionAttachmentBeforeUpload(file: RcFile) {
    const maxBytes = aiMaterialUploadMaxMb * 1024 * 1024;
    if (file.size > maxBytes) {
      messageApi.error(`${file.name} 超过 ${aiMaterialUploadMaxMb}MB，请压缩或拆分后再上传`);
      return Upload.LIST_IGNORE;
    }

    setAiInstructionUploading(true);
    let uid = "";
    try {
      uid = `${file.uid}-${Date.now()}`;
      const isImage = isImageAttachmentFile({ name: file.name, file: file.name, mimeType: file.type });
      const preview = isImage ? createObjectUrlPreview(file) : undefined;
      if (preview) {
        aiInstructionPreviewRevokeRef.current.set(uid, preview.revoke);
      }
      const attachment: AiInstructionAttachmentItem = {
        uid,
        name: file.name,
        mimeType: file.type,
        base64: await localFileBase64CacheRef.current.read(file),
        sizeBytes: file.size,
        previewUrl: preview?.url
      };
      setAiInstructionAttachments((items) => [attachment, ...items]);
      messageApi.success("已加入本次 AI 对话资料，不会保存为用例附件");
    } catch (error) {
      if (uid) {
        aiInstructionPreviewRevokeRef.current.get(uid)?.();
        aiInstructionPreviewRevokeRef.current.delete(uid);
      }
      messageApi.error(error instanceof Error ? error.message : String(error));
    } finally {
      setAiInstructionUploading(false);
    }
    return Upload.LIST_IGNORE;
  }

  async function uploadDroppedFiles(target: CaseEditorDropTarget, files: File[]) {
    for (const [index, file] of files.entries()) {
      const uploadFile = toRcFile(file, index);
      if (target === "aiInstruction") {
        await handleAiInstructionAttachmentBeforeUpload(uploadFile);
      } else {
        await handleAttachmentBeforeUpload(uploadFile);
      }
    }
  }

  function removeAiInstructionAttachment(uid: string) {
    aiInstructionPreviewRevokeRef.current.get(uid)?.();
    aiInstructionPreviewRevokeRef.current.delete(uid);
    setAiInstructionAttachments((items) => items.filter((item) => item.uid !== uid));
  }

  async function copyAttachmentPath(file: string) {
    await navigator.clipboard.writeText(file);
    messageApi.success("附件路径已复制");
  }

  function previewCaseAttachment(file: string, name = attachmentFileName(file)) {
    setPreviewAttachment({
      name,
      previewUrl: caseAttachmentFileUrl(file)
    });
  }

  function removeAttachmentsFromState(files: string[]) {
    const fileSet = new Set(files);
    setAttachments((items) => items.filter((item) => !fileSet.has(item.file)));
    setAttachmentSearchResults((items) => items.filter((item) => !fileSet.has(item.file)));
    setSelectedPromptFiles((current) => {
      const next = { ...current };
      for (const file of files) {
        delete next[file];
      }
      return next;
    });
  }

  function deleteAttachments(files: string[]) {
    const uniqueFiles = [...new Set(files.map((file) => file.trim()).filter(Boolean))];
    if (!uniqueFiles.length) {
      return;
    }

    const referencedInYaml = uniqueFiles.filter((file) => yaml.includes(file));
    Modal.confirm({
      title: uniqueFiles.length === 1 ? "删除附件" : `批量删除 ${uniqueFiles.length} 个附件`,
      width: 520,
      content: (
        <Space orientation="vertical" size={8} className="w-full">
          <Typography.Text>
            {uniqueFiles.length === 1 ? "确定删除这个附件/图片吗？" : `确定删除以下 ${uniqueFiles.length} 个附件吗？`}
          </Typography.Text>
          <div className="max-h-[220px] overflow-auto rounded border border-slate-100 px-2 py-1.5">
            {uniqueFiles.map((file) => (
              <Typography.Text key={file} code className="!mb-1 block truncate !text-xs">
                {file}
              </Typography.Text>
            ))}
          </div>
          {referencedInYaml.length ? (
            <Alert
              type="warning"
              showIcon
              title={
                referencedInYaml.length === 1
                  ? "当前 YAML 已引用该路径，删除后运行前预检会报文件缺失。"
                  : `其中 ${referencedInYaml.length} 个路径已被 YAML 引用，删除后运行前预检会报文件缺失。`
              }
            />
          ) : null}
        </Space>
      ),
      okText: uniqueFiles.length === 1 ? "删除" : `删除 ${uniqueFiles.length} 项`,
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        setAttachmentDeleting(true);
        try {
          const caseKey = caseId || activeCase?.caseId || "_draft";
          const results = await Promise.allSettled(uniqueFiles.map((file) => deleteCaseAttachment(caseKey, file)));
          const succeeded = uniqueFiles.filter((_, index) => results[index]?.status === "fulfilled");
          const failedCount = uniqueFiles.length - succeeded.length;
          if (succeeded.length) {
            removeAttachmentsFromState(succeeded);
          }
          if (failedCount > 0) {
            messageApi.error(`${failedCount} 个附件删除失败`);
          } else if (succeeded.length === 1) {
            messageApi.success("附件已删除");
          } else {
            messageApi.success(`已删除 ${succeeded.length} 个附件`);
          }
        } finally {
          setAttachmentDeleting(false);
        }
      }
    });
  }

  function deleteAttachment(file: string) {
    deleteAttachments([file]);
  }

  function deleteSelectedAttachments() {
    if (!selectedAttachmentFiles.length) {
      messageApi.warning("请先勾选要删除的附件");
      return;
    }
    deleteAttachments(selectedAttachmentFiles);
  }

  function toggleSelectAllVisibleAttachments(checked: boolean) {
    setSelectedPromptFiles((current) => {
      const next = { ...current };
      if (checked) {
        for (const item of visibleAttachments) {
          next[item.file] = attachmentToPromptFile(item);
        }
      } else {
        for (const item of visibleAttachments) {
          delete next[item.file];
        }
      }
      return next;
    });
  }

  async function handleSearchAttachments() {
    setAttachmentSearching(true);
    try {
      const result = await searchCaseAttachments({
        caseId: caseId || activeCase?.caseId || "_draft",
        query: attachmentQuery,
        limit: 200
      });
      setAttachmentSearchResults(result);
      messageApi.success(`找到 ${result.length} 个文件/文件夹`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : String(error));
    } finally {
      setAttachmentSearching(false);
    }
  }

  function applyAttachment(file: string) {
    if (!effectiveUploadStepId) {
      if (/^admin_/i.test(caseId || activeCase?.caseId || "") && isImageAttachmentFile({ file })) {
        setYaml(insertUploadStepBeforeSubmit(yaml, {
          stepId: "upload_avatar",
          name: "上传头像",
          session: "admin",
          target: "admin_avatar_upload",
          file,
          beforeTarget: "admin_profile_save"
        }));
        messageApi.success("已新增 upload_avatar 并引用附件");
        return;
      }
      messageApi.warning("当前 YAML 中没有 web_upload 步骤，请先新增上传步骤或使用 AI 优化");
      return;
    }
    setYaml(upsertUploadStepFile(yaml, effectiveUploadStepId, file));
    setFlashAttachmentFile(file);
    messageApi.success(`已引用到 ${effectiveUploadStepId}`);
  }

  function handleAttachmentRowClick(file: string) {
    const usageTone = resolveAttachmentUsageTone(file, effectiveUploadStepId, fileToUploadStepsMap);
    if (!effectiveUploadStepId) {
      messageApi.warning("请先选择要写入 file 的 web_upload 步骤");
      return;
    }
    if (usageTone === "active") {
      messageApi.info("该附件已是当前步骤引用");
      return;
    }
    applyAttachment(file);
  }

  function togglePromptFile(file: AttachmentPromptFile, checked: boolean) {
    setSelectedPromptFiles((current) => {
      const next = { ...current };
      if (checked) {
        next[file.file] = file;
      } else {
        delete next[file.file];
      }
      return next;
    });
  }

  function openAttachmentPrompt(attachment?: CaseAttachmentResult) {
    const files = selectedPromptFileList.length
      ? selectedPromptFileList
      : attachment
        ? [attachmentToPromptFile(attachment)]
        : attachments.map(attachmentToPromptFile);
    setPromptAttachment(attachment);
    setPromptFiles(files);
    setPromptOpen(true);
  }

  function selectedUploadStep(): UploadStepOption | undefined {
    return uploadSteps.find((step) => step.stepId === effectiveUploadStepId);
  }

  function currentAttachmentPrompt(): string {
    if (promptFiles.length > 1) {
      return buildAttachmentBatchAiPrompt({
        caseId: caseId || activeCase?.caseId || "_draft",
        files: promptFiles,
        steps: uploadSteps
      });
    }
    const file = promptFiles[0]?.file || promptAttachment?.file;
    if (!file) {
      return "";
    }
    return buildAttachmentAiPrompt({
      caseId: caseId || activeCase?.caseId || "_draft",
      file,
      step: selectedUploadStep()
    });
  }

  async function copyAttachmentPrompt() {
    const prompt = currentAttachmentPrompt();
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    messageApi.success("附件提示词已复制");
  }

  function fillAttachmentPromptToAi() {
    const prompt = currentAttachmentPrompt();
    if (!prompt) return;
    setAiMode("continue");
    setAiInstruction(prompt);
    setAiOpen(true);
    setPromptOpen(false);
    messageApi.success("已填入 AI 助手");
  }

  if (loading) {
    return (
      <div className="flex min-h-full flex-col gap-2.5">
        {contextHolder}
        <PageHeader title="用例编辑" description={caseId} />
        <Card className="min-h-[420px]">
          <div className="flex min-h-[360px] items-center justify-center">
            <Spin description="读取用例中">
              <div className="h-12 w-36" />
            </Spin>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-2.5">
      {contextHolder}
      {dropCopy ? (
        <div className="case-editor-drop-sense fixed inset-0 z-[2147483000] flex items-center justify-center px-8">
          <div
            className={cn(
              "case-editor-drop-sense__panel",
              pageDropTarget === "aiInstruction" ? "case-editor-drop-sense__panel--ai" : "case-editor-drop-sense__panel--case"
            )}
          >
            <UploadOutlined className="case-editor-drop-sense__icon" />
            <Typography.Title level={3} className="!mb-2 !mt-0 !text-inherit">
              {dropCopy.title}
            </Typography.Title>
            <Typography.Text className="!text-inherit">
              {dropCopy.description}
            </Typography.Text>
            <div className="case-editor-drop-sense__line" />
          </div>
        </div>
      ) : null}
      <PageHeader
        title={activeCase?.caseName ?? caseId}
        description={activeCase?.file}
        extra={
          <>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/cases")}>
              返回
            </Button>
            <Button icon={<CheckCircleOutlined />} onClick={() => void handleValidate()}>
              校验
            </Button>
            <Button icon={<SafetyCertificateOutlined />} loading={preflighting} onClick={() => void handlePreflight()}>
              预检
            </Button>
            <Button icon={<RobotOutlined />} onClick={() => openAiAssistant()}>
              AI 助手
            </Button>
            <Button icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
              保存
            </Button>
            <Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={() => void handleRun()}>
              执行
            </Button>
          </>
        }
      />
      <Row gutter={[10, 10]}>
        <Col xs={24} xl={16}>
          <Card title="基础信息" size="small" className="mb-3 [&_.ant-card-body]:py-3">
            <Form<CaseMetaFormValues>
              key={activeCase?.caseId}
              layout="vertical"
              className="[&_.ant-form-item]:mb-0"
              initialValues={{
                caseId: activeCase?.caseId,
                caseName: activeCase?.caseName,
                caseType: activeCase?.caseType ?? "uncategorized",
                description: activeCase?.description ?? ""
              }}
              onValuesChange={handleMetaChange}
            >
              <Row gutter={12}>
                <Col span={6}>
                  <Form.Item
                    label="caseId"
                    name="caseId"
                    normalize={normalizeCaseId}
                    rules={[
                      { required: true, message: "请输入 caseId" },
                      {
                        pattern: /^[a-z][a-z0-9_-]{2,63}$/,
                        message: "只能使用小写字母、数字、下划线或中划线，且必须以小写字母开头，长度 3-64 位"
                      }
                    ]}
                  >
                    <Input size="small" placeholder="例如 admin_profile_update" />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item label="名称" name="caseName" rules={[{ required: true, message: "请输入名称" }]}>
                    <Input size="small" placeholder="例如 admin 修改资料" />
                  </Form.Item>
                </Col>
                <Col span={5}>
                  <Form.Item label="用例类型" name="caseType" rules={[{ required: true, message: "请选择用例类型" }]}>
                    <Select
                      size="small"
                      options={caseTypes.map((item) => ({ label: item.label, value: item.key }))}
                      placeholder="选择类型"
                    />
                  </Form.Item>
                </Col>
                <Col span={7}>
                  <Form.Item label="说明" name="description">
                    <Input size="small" placeholder="简要说明用例覆盖的流程或断言目标" />
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          </Card>
          <Card
            className="overflow-hidden [&_.ant-card-body]:bg-[#1e1e1e] [&_.ant-card-body]:p-0"
            style={{ backgroundColor: "#1e1e1e", borderColor: "#1e1e1e" }}
          >
            <YamlEditor value={yaml} onChange={setYaml} />
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <div className="xl:sticky xl:top-0 xl:max-h-[calc(100vh-120px)] xl:overflow-y-auto xl:pr-1">
          <Card title="AI YAML 助手" className="mb-2.5">
            <div className="flex flex-col gap-2.5">
              <Typography.Text type="secondary">选择生成方式，AI 会先给出可校验草稿，确认后再应用到编辑器。</Typography.Text>
              <Segmented<CaseYamlAssistMode> block value={aiMode} options={aiModeOptions} onChange={setAiMode} />
              <Input.TextArea
                rows={4}
                value={aiInstruction}
                placeholder="例如：续写 admin 审核 KYC，并在 user 端断言状态变为已通过"
                onChange={(event) => setAiInstruction(event.target.value)}
              />
              <Button block type="primary" icon={<RobotOutlined />} className="mt-0.5" onClick={() => openAiAssistant(aiMode)}>
                打开 AI 助手
              </Button>
            </div>
          </Card>
          <Card
            title="测试附件"
            className="mb-2.5"
            extra={selectedPromptFileList.length ? <Tag color="processing">已选 {selectedPromptFileList.length}</Tag> : null}
          >
            <div className="flex flex-col gap-2.5">
              <Typography.Text type="secondary">
                附件会保存到 uploads/cases/{normalizeCaseId(caseId || activeCase?.caseId || "_draft")}，YAML 使用返回的项目相对路径。
              </Typography.Text>
              <Select
                size="small"
                placeholder="选择要写入 file 的 web_upload 步骤"
                value={effectiveUploadStepId}
                options={uploadSteps.map((step) => ({
                  label: (
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <span className="truncate">{step.stepId} · {step.name}</span>
                      {isConcreteAttachmentPath(step.file) ? <Tag color="blue" className="!m-0 !text-[10px]">已绑定</Tag> : <Tag className="!m-0 !text-[10px]">待绑定</Tag>}
                    </span>
                  ),
                  value: step.stepId
                }))}
                disabled={!uploadSteps.length}
                onChange={setSelectedUploadStepId}
              />
              {uploadSteps.length ? (
                <div
                  className={cn(
                    "case-attachment-step-hint px-2.5 py-2 text-xs",
                    isConcreteAttachmentPath(activeUploadStep?.file) ? "case-attachment-step-hint--bound" : "case-attachment-step-hint--empty"
                  )}
                >
                  {activeUploadStep ? (
                    <Space orientation="vertical" size={4} className="w-full">
                      <span className="text-slate-600">
                        当前步骤：<Typography.Text code className="!text-[11px]">{activeUploadStep.stepId}</Typography.Text>
                        {activeUploadStep.target ? <span className="text-slate-400"> · target: {activeUploadStep.target}</span> : null}
                      </span>
                      {isConcreteAttachmentPath(activeUploadStep.file) ? (
                        <span className="text-blue-700">
                          已引用附件：<Typography.Text code className="!text-[11px] !text-blue-700">{activeUploadStep.file}</Typography.Text>
                        </span>
                      ) : (
                        <span className="text-slate-500">尚未绑定附件，可在下方列表点击行或引用按钮写入 file。</span>
                      )}
                    </Space>
                  ) : null}
                </div>
              ) : (
                <Alert type="warning" showIcon className="!py-2" title="当前 YAML 没有 web_upload 步骤" description="可先使用 AI 助手补充上传步骤，或在 admin 类用例中上传图片自动插入。" />
              )}
              {attachments.length ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>
                    {referencedAttachmentCount}/{attachments.length} 个附件已被 YAML 引用
                    {effectiveUploadStepId ? ` · 当前步骤 ${activeStepAttachmentCount} 个` : ""}
                  </span>
                  <Checkbox
                    checked={attachmentStepFilter}
                    disabled={!effectiveUploadStepId}
                    onChange={(event) => setAttachmentStepFilter(event.target.checked)}
                  >
                    仅看当前步骤
                  </Checkbox>
                </div>
              ) : null}
              <Upload.Dragger
                multiple
                showUploadList={false}
                beforeUpload={handleAttachmentBeforeUpload}
                disabled={attachmentUploading}
              >
                <p className="ant-upload-drag-icon">
                  <UploadOutlined />
                </p>
                <p className="ant-upload-text">上传图片或任意测试附件</p>
                <p className="ant-upload-hint">单文件最大 {attachmentUploadMaxMb}MB；复杂表单可上传多张，再生成通用提示词。</p>
              </Upload.Dragger>
              <Space.Compact className="w-full">
                <Input
                  allowClear
                  size="small"
                  value={attachmentQuery}
                  placeholder="搜索文件夹/文件名/路径"
                  onChange={(event) => setAttachmentQuery(event.target.value)}
                  onPressEnter={() => void handleSearchAttachments()}
                />
                <Button size="small" icon={<SearchOutlined />} loading={attachmentSearching} onClick={() => void handleSearchAttachments()}>
                  搜索
                </Button>
              </Space.Compact>
              <Space wrap size={6}>
                <Button
                  size="small"
                  icon={<RobotOutlined />}
                  disabled={!attachments.length && !selectedPromptFileList.length}
                  onClick={() => openAttachmentPrompt()}
                >
                  生成通用提示词
                </Button>
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  loading={attachmentDeleting}
                  disabled={!selectedAttachmentFiles.length || attachmentDeleting}
                  onClick={() => deleteSelectedAttachments()}
                >
                  批量删除{selectedAttachmentFiles.length ? ` (${selectedAttachmentFiles.length})` : ""}
                </Button>
                <Button
                  size="small"
                  disabled={!selectedPromptFileList.length || attachmentDeleting}
                  onClick={() => setSelectedPromptFiles({})}
                >
                  清空选择
                </Button>
              </Space>
              {visibleAttachments.length ? (
                <div ref={attachmentListRef} className="case-attachment-panel__list max-h-[260px] divide-y divide-slate-100 overflow-auto rounded border border-slate-100">
                  <div className="sticky top-0 z-[1] flex items-center gap-2 border-b border-slate-100 bg-slate-50/95 px-2 py-1.5">
                    <Checkbox
                      indeterminate={someVisibleAttachmentsSelected}
                      checked={allVisibleAttachmentsSelected}
                      disabled={attachmentDeleting}
                      onChange={(event) => toggleSelectAllVisibleAttachments(event.target.checked)}
                    >
                      <span className="text-xs text-slate-600">
                        全选当前列表 ({selectedVisibleAttachmentCount}/{visibleAttachments.length})
                      </span>
                    </Checkbox>
                  </div>
                  {visibleAttachments.map((item) => (
                    <AttachmentListRow
                      key={item.file}
                      item={item}
                      usageTone={resolveAttachmentUsageTone(item.file, effectiveUploadStepId, fileToUploadStepsMap)}
                      linkedSteps={getStepsUsingFile(item.file, fileToUploadStepsMap)}
                      activeStepId={effectiveUploadStepId}
                      checked={Boolean(selectedPromptFiles[item.file])}
                      selectionDisabled={attachmentDeleting}
                      flash={flashAttachmentFile === item.file}
                      onToggleCheck={(checked) => togglePromptFile(attachmentToPromptFile(item), checked)}
                      onPreview={() => previewCaseAttachment(item.file, item.name)}
                      onDownloadUrl={primaryAttachmentViewAction(item) === "download" ? caseAttachmentFileUrl(item.file, { download: true }) : undefined}
                      onApply={() => applyAttachment(item.file)}
                      onPrompt={() => openAttachmentPrompt(item)}
                      onCopyPath={() => void copyAttachmentPath(item.file)}
                      onDelete={() => deleteAttachment(item.file)}
                      onRowClick={() => handleAttachmentRowClick(item.file)}
                    />
                  ))}
                </div>
              ) : (
                <Alert
                  type="info"
                  showIcon
                  title={
                    attachmentStepFilter
                      ? "当前步骤尚未绑定附件，可上传新文件或从列表引用。"
                      : attachmentQuery
                        ? "当前附件列表没有匹配项，可以点击搜索从附件目录继续查找。"
                        : "暂无附件，先上传图片或文件。"
                  }
                />
              )}
              {visibleSearchResults.length ? (
                <div className="case-attachment-panel__list max-h-[220px] divide-y divide-slate-100 overflow-auto rounded border border-dashed border-amber-200 bg-amber-50/30">
                  <div className="sticky top-0 z-[1] border-b border-amber-100 bg-amber-50/95 px-2 py-1 text-[11px] text-amber-700">
                    目录搜索结果（未在当前列表中的文件）
                  </div>
                  {visibleSearchResults.map((item) => (
                    item.kind === "directory" ? (
                      <div key={`${item.kind}-${item.file}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2 py-2 text-sm transition-colors hover:bg-amber-50/70">
                        <span className="min-w-0" title={item.file}>
                          <span className="flex min-w-0 items-center gap-1.5">
                            <FolderOpenOutlined className="shrink-0 text-amber-500" />
                            <span className="truncate font-mono text-xs text-slate-700">{item.name || attachmentFileName(item.file)}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-slate-400">{item.file}</span>
                        </span>
                        <Tooltip title="复制路径">
                          <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => void copyAttachmentPath(item.file)} />
                        </Tooltip>
                      </div>
                    ) : (
                      <AttachmentListRow
                        key={`${item.kind}-${item.file}`}
                        item={item}
                        usageTone={resolveAttachmentUsageTone(item.file, effectiveUploadStepId, fileToUploadStepsMap)}
                        linkedSteps={getStepsUsingFile(item.file, fileToUploadStepsMap)}
                        activeStepId={effectiveUploadStepId}
                        checked={Boolean(selectedPromptFiles[item.file])}
                        flash={flashAttachmentFile === item.file}
                        showCheckbox={false}
                        showDeleteAction={false}
                        showPromptAction
                        onApply={() => applyAttachment(item.file)}
                        onPrompt={() => togglePromptFile(searchResultToPromptFile(item), true)}
                        onPreview={() => previewCaseAttachment(item.file, item.name)}
                        onDownloadUrl={primaryAttachmentViewAction(item) === "download" ? caseAttachmentFileUrl(item.file, { download: true }) : undefined}
                        onCopyPath={() => void copyAttachmentPath(item.file)}
                        onRowClick={() => handleAttachmentRowClick(item.file)}
                      />
                    )
                  ))}
                </div>
              ) : null}
            </div>
          </Card>
          <Card
            title="DSL 校验结果"
            extra={validation ? <Tag color={validation.valid ? "success" : "error"}>{validation.valid ? "通过" : "失败"}</Tag> : null}
          >
            {!validation ? (
              <Alert type="info" showIcon title="尚未校验" description="保存会自动校验，也可以先手动校验 YAML DSL。" />
            ) : validation.valid ? (
              <Alert type="success" showIcon title="校验通过" description={`${validation.caseId ?? "-"} · ${validation.caseName ?? "-"}`} />
            ) : (
              <IssueStack>
                {validation.issues.map((item) => (
                  <IssueItem key={`${item.path}-${item.message}`} title={item.path} description={item.message} />
                ))}
              </IssueStack>
            )}
          </Card>
          <Card
            title="运行前预检"
            className="mt-2.5"
            extra={preflight ? <Tag color={preflight.runnable ? "success" : "error"}>{preflight.runnable ? "可执行" : "需修复"}</Tag> : null}
          >
            {!preflight ? (
              <Alert type="info" showIcon title="尚未预检" description="预检会检查环境变量、定位文件、API baseUrl、DB 开关和上传文件等运行前风险。" />
            ) : preflight.runnable ? (
              <Alert
                type="success"
                showIcon
                title="预检通过"
                description={`${preflight.summary.steps} 步 · Web ${preflight.summary.webSteps} · API ${preflight.summary.apiSteps} · DB ${preflight.summary.dbSteps}`}
              />
            ) : (
              <IssueStack>
                {preflight.issues.map((item) => (
                  <IssueItem
                    key={`${item.path}-${item.code}-${item.message}`}
                    title={
                      <Space>
                        <Tag color={item.severity === "error" ? "error" : "warning"}>{item.severity}</Tag>
                        <span>{item.path}</span>
                      </Space>
                    }
                    description={`${item.code} · ${item.message}`}
                  />
                ))}
              </IssueStack>
            )}
          </Card>
          </div>
        </Col>
      </Row>
      <Drawer
        title="AI YAML 助手"
        size="min(920px, 92vw)"
        open={aiOpen}
        destroyOnHidden={false}
        extra={
          <Space wrap>
            <Button icon={<CopyOutlined />} disabled={!aiDraft} onClick={() => void copyAiDraft()}>
              复制
            </Button>
            <Button disabled={!aiDraft || aiStreaming} onClick={() => void handleApplyAiDraft()}>
              应用到编辑器
            </Button>
            <Button type="primary" icon={<RobotOutlined />} loading={aiStreaming} disabled={aiInstructionUploading} onClick={() => void handleAiGenerate()}>
              {aiDraft ? "重新生成" : "生成"}
            </Button>
          </Space>
        }
        onClose={() => setAiOpen(false)}
      >
        <div className="grid h-full min-h-0 grid-cols-1 gap-2.5 xl:grid-cols-[280px_minmax(0,1fr)]">
          <div className="space-y-2.5">
            <Card size="small" title="生成模式">
              <Space orientation="vertical" size={12} className="w-full">
                <Segmented<CaseYamlAssistMode> block value={aiMode} options={aiModeOptions} onChange={setAiMode} />
                <Alert type="info" showIcon title={aiModeTips[aiMode]} />
              </Space>
            </Card>
            <Card size="small" title="补充要求">
              <Space orientation="vertical" size={10} className="w-full">
                <Input.TextArea
                  rows={8}
                  value={aiInstruction}
                  placeholder="描述你要 AI 写什么、续写什么，或需要修复的问题。"
                  onChange={(event) => setAiInstruction(event.target.value)}
                />
                <Upload.Dragger
                  multiple
                  showUploadList={false}
                  beforeUpload={handleAiInstructionAttachmentBeforeUpload}
                  disabled={aiInstructionUploading}
                >
                  <p className="ant-upload-drag-icon">
                    <UploadOutlined />
                  </p>
                  <p className="ant-upload-text">上传文件/图片作为本次 AI 对话资料</p>
                  <p className="ant-upload-hint">只随本次生成发送给 AI，不保存到本地，也不会进入右侧测试附件。支持 docx、PDF、文本和 PNG/JPG/WebP，单文件最大 {aiMaterialUploadMaxMb}MB。</p>
                </Upload.Dragger>
                {aiInstructionAttachments.length ? (
                  <div className="divide-y divide-slate-100 rounded border border-slate-100">
                    {aiInstructionAttachments.map((item) => (
                      <div key={item.uid} className="flex items-center gap-2 px-2 py-2 text-xs">
                        {item.previewUrl ? (
                          <button
                            type="button"
                            className="h-10 w-10 shrink-0 overflow-hidden rounded border border-slate-200 bg-slate-50"
                            title="预览图片"
                            onClick={() => setPreviewAttachment({ name: item.name, previewUrl: item.previewUrl! })}
                          >
                            <img src={item.previewUrl} alt={item.name} className="h-full w-full object-cover" />
                          </button>
                        ) : (
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-400">
                            <PaperClipOutlined />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-slate-900" title={item.name}>{item.name}</span>
                          <span className="block truncate text-[11px] text-slate-500" title="仅本次 AI 对话使用，不保存为用例附件">
                            仅本次 AI 对话 · {formatBytes(item.sizeBytes)}{item.mimeType ? ` · ${item.mimeType}` : ""}
                          </span>
                        </span>
                        <Space size={2}>
                          {item.previewUrl ? (
                            <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => setPreviewAttachment({ name: item.name, previewUrl: item.previewUrl! })}>
                              预览
                            </Button>
                          ) : null}
                          <Button size="small" danger type="link" icon={<DeleteOutlined />} title="从本次对话移除" onClick={() => removeAiInstructionAttachment(item.uid)} />
                        </Space>
                      </div>
                    ))}
                  </div>
                ) : null}
              </Space>
            </Card>
            {aiValidation ? (
              <Alert
                type={aiValidation.valid ? "success" : "warning"}
                showIcon
                title={aiValidation.valid ? "草稿校验通过" : "草稿仍需调整"}
                description={aiValidation.valid ? `${aiValidation.caseId ?? "-"} · ${aiValidation.caseName ?? "-"}` : `${aiValidation.issues.length} 个问题`}
              />
            ) : null}
            {aiError ? <Alert type="error" showIcon title="AI 生成失败" description={aiError} /> : null}
          </div>
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
            <div className="flex min-h-[44px] items-center justify-between border-b border-slate-800 px-3 text-slate-200">
              <span>AI YAML 预览</span>
              <Tag color={aiStreaming ? "processing" : aiValidation?.valid ? "success" : aiDraft ? "warning" : "default"}>
                {aiStreaming ? "生成中" : aiValidation?.valid ? "可应用" : aiDraft ? "待确认" : "未生成"}
              </Tag>
            </div>
            <div className="min-h-[520px] flex-1 overflow-auto p-4">
              {aiStreaming && !aiDraft ? (
                <div className="mb-3 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3">
                  <AiThinking text={aiYamlPreviewPlaceholder(true)} />
                </div>
              ) : null}
              <pre className="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-200">
                {aiDraft || (!aiStreaming ? aiYamlPreviewPlaceholder(false) : "")}
                {aiTyping && aiDraft ? <span className="typewriter-caret typewriter-caret--mono" aria-hidden="true" /> : null}
              </pre>
            </div>
          </div>
        </div>
      </Drawer>
      <Modal
        title="附件 AI 提示词"
        open={promptOpen}
        width={760}
        okText="填入 AI 助手"
        cancelText="关闭"
        onOk={fillAttachmentPromptToAi}
        onCancel={() => setPromptOpen(false)}
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space>
            <Button icon={<CopyOutlined />} disabled={!promptFiles.length && !promptAttachment} onClick={() => void copyAttachmentPrompt()}>
              复制提示词
            </Button>
            <CancelBtn />
            <OkBtn />
          </Space>
        )}
      >
        <Space orientation="vertical" size={12} className="w-full">
          <Alert
            type="info"
            showIcon
            title="复制给 AI，或直接填入右侧 AI YAML 助手的补充要求。"
          />
          <Input.TextArea rows={16} value={currentAttachmentPrompt()} readOnly />
        </Space>
      </Modal>
      <Modal
        title={previewAttachment?.name ?? "图片预览"}
        open={Boolean(previewAttachment)}
        width={IMAGE_PREVIEW_MODAL_WIDTH}
        footer={null}
        onCancel={() => setPreviewAttachment(undefined)}
      >
        {previewAttachment?.previewUrl ? (
          <img src={previewAttachment.previewUrl} alt={previewAttachment.name} className={`${IMAGE_PREVIEW_MAX_HEIGHT_CLASS} w-full object-contain`} />
        ) : null}
      </Modal>
    </div>
  );
}

function IssueStack({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-slate-100">{children}</div>;
}

function IssueItem({ title, description }: { title: ReactNode; description: ReactNode }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="mb-1 text-sm text-slate-900">{title}</div>
      <div className="text-sm text-slate-500">{description}</div>
    </div>
  );
}

function attachmentToPromptFile(attachment: CaseAttachmentResult): AttachmentPromptFile {
  return {
    name: attachment.name,
    file: attachment.file
  };
}

function searchResultToPromptFile(item: CaseAttachmentSearchResult): AttachmentPromptFile {
  return {
    name: item.name,
    file: item.file
  };
}

function aiInstructionAttachmentToFile(item: AiInstructionAttachmentItem): AiMaterialFileInput {
  return {
    name: item.name,
    mimeType: item.mimeType,
    base64: item.base64
  };
}

function attachmentMatches(attachment: CaseAttachmentResult, query: string): boolean {
  const keyword = query.trim().toLowerCase();
  if (!keyword) {
    return true;
  }
  return attachment.name.toLowerCase().includes(keyword) || attachment.file.toLowerCase().includes(keyword);
}

function toRcFile(file: File, index: number): RcFile {
  const rcFile = file as RcFile;
  rcFile.uid = `${file.name}-${file.lastModified}-${index}`;
  return rcFile;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function attachmentFileName(file: string): string {
  return file.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? file;
}

function normalizeAiYaml(content: string): string {
  return content
    .replace(/^\s*```(?:yaml|yml)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim()
    .concat("\n");
}

function updateYamlMeta(content: string, meta: { caseId: string; caseName: string; caseType: string; description?: string }): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const nextLines = upsertYamlScalar(lines, "case_id", meta.caseId);
  const withName = upsertYamlScalar(nextLines, "case_name", meta.caseName);
  const withType = upsertYamlScalar(withName, "case_type", meta.caseType || "uncategorized");
  return upsertYamlScalar(withType, "description", meta.description?.trim() ?? "").join("\n");
}

function upsertYamlScalar(lines: string[], key: "case_id" | "case_name" | "case_type" | "description", value: string): string[] {
  const next = [...lines];
  const lineIndex = next.findIndex((line) => line.startsWith(`${key}:`));
  if (!value && key === "description") {
    if (lineIndex >= 0) {
      next.splice(lineIndex, 1);
    }
    return next;
  }

  const line = `${key}: ${quoteYamlScalar(value)}`;
  if (lineIndex >= 0) {
    next[lineIndex] = line;
    return next;
  }

  const insertIndex = key === "case_id"
    ? 0
    : key === "case_name"
      ? afterKey(next, "case_id")
      : key === "case_type"
        ? afterKey(next, "case_name")
        : afterKey(next, "case_type");
  next.splice(insertIndex, 0, line);
  return next;
}

function afterKey(lines: string[], key: string): number {
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  return index >= 0 ? index + 1 : 0;
}

function quoteYamlScalar(value: string): string {
  return JSON.stringify(value);
}

function normalizeCaseId(value?: string): string {
  return (value ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}
