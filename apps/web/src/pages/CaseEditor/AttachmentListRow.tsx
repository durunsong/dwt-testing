import { Button, Checkbox, Space, Tag, Tooltip, Typography } from "antd";
import { CheckCircleFilled, CopyOutlined, DeleteOutlined, DownloadOutlined, EyeOutlined, LinkOutlined, PaperClipOutlined, RobotOutlined } from "@ant-design/icons";
import { cn } from "../../utils/cn";
import { primaryAttachmentViewAction } from "./attachment-actions";
import type { AttachmentUsageTone, UploadStepOption } from "./attachment-prompt";

export interface AttachmentListRowItem {
  file: string;
  name?: string;
}

export interface AttachmentListRowProps {
  item: AttachmentListRowItem;
  usageTone: AttachmentUsageTone;
  linkedSteps: UploadStepOption[];
  activeStepId?: string;
  checked: boolean;
  flash?: boolean;
  showApplyAction?: boolean;
  showDeleteAction?: boolean;
  showPromptAction?: boolean;
  showCheckbox?: boolean;
  selectionDisabled?: boolean;
  onToggleCheck?: (checked: boolean) => void;
  onPreview?: () => void;
  onDownloadUrl?: string;
  onApply?: () => void;
  onPrompt?: () => void;
  onCopyPath?: () => void;
  onDelete?: () => void;
  onRowClick?: () => void;
}

export function AttachmentListRow({
  item,
  usageTone,
  linkedSteps,
  activeStepId,
  checked,
  flash = false,
  showApplyAction = true,
  showDeleteAction = true,
  showPromptAction = true,
  showCheckbox = true,
  selectionDisabled = false,
  onToggleCheck,
  onPreview,
  onDownloadUrl,
  onApply,
  onPrompt,
  onCopyPath,
  onDelete,
  onRowClick
}: AttachmentListRowProps) {
  const displayName = item.name || attachmentFileName(item.file);
  const activeLinkedStep = linkedSteps.find((step) => step.stepId === activeStepId);
  const otherLinkedSteps = linkedSteps.filter((step) => step.stepId !== activeStepId);
  const viewAction = primaryAttachmentViewAction(item);

  return (
    <div
      data-attachment-file={item.file}
      className={cn(
        "case-attachment-row group grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2 text-sm transition-[background-color,box-shadow,border-color] duration-200",
        usageTone === "active" && "case-attachment-row--active",
        usageTone === "linked" && "case-attachment-row--linked",
        usageTone === "unused" && "case-attachment-row--unused",
        flash && "case-attachment-row--flash",
        checked && "case-attachment-row--selected"
      )}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("button, a, .ant-checkbox-wrapper, input, label")) {
          return;
        }
        onRowClick?.();
      }}
    >
      {showCheckbox ? (
        <Checkbox
          checked={checked}
          disabled={selectionDisabled}
          onChange={(event) => onToggleCheck?.(event.target.checked)}
        />
      ) : (
        <span className="w-4" />
      )}
      <span className="min-w-0" title={item.file}>
        <span className="flex min-w-0 items-center gap-1.5">
          {usageTone === "active" ? (
            <CheckCircleFilled className="shrink-0 text-blue-500" aria-hidden="true" />
          ) : (
            <PaperClipOutlined className={cn("shrink-0", usageTone === "unused" ? "text-slate-300" : "text-slate-400")} />
          )}
          <span
            className={cn(
              "truncate font-mono text-xs",
              usageTone === "active" ? "font-medium text-blue-900" : usageTone === "linked" ? "text-slate-800" : "text-slate-600"
            )}
          >
            {displayName}
          </span>
          {usageTone === "active" && activeLinkedStep ? (
            <Tag color="blue" className="!m-0 !px-1.5 !py-0 !text-[10px] !leading-5">
              当前步骤
            </Tag>
          ) : null}
          {otherLinkedSteps.length ? (
            <Tooltip
              title={otherLinkedSteps.map((step) => `${step.stepId} · ${step.name}`).join("\n")}
            >
              <Tag color="gold" className="!m-0 !px-1.5 !py-0 !text-[10px] !leading-5">
                {linkedSteps.length > 1 ? `${linkedSteps.length} 步引用` : otherLinkedSteps[0]?.stepId}
              </Tag>
            </Tooltip>
          ) : null}
          {usageTone === "unused" ? (
            <Tag className="!m-0 !border-dashed !bg-transparent !px-1.5 !py-0 !text-[10px] !leading-5 !text-slate-400">
              未引用
            </Tag>
          ) : null}
        </span>
        <Typography.Text
          type="secondary"
          className={cn("mt-0.5 block truncate !text-[11px]", usageTone === "active" && "!text-blue-500/80")}
          copyable={false}
        >
          {item.file}
        </Typography.Text>
      </span>
      <Space size={0} className="shrink-0 opacity-80 transition-opacity duration-150 group-hover:opacity-100">
        {viewAction === "preview" ? (
          <Tooltip title="预览">
            <Button size="small" type="text" icon={<EyeOutlined />} onClick={onPreview} />
          </Tooltip>
        ) : onDownloadUrl ? (
          <Tooltip title="下载">
            <Button size="small" type="text" icon={<DownloadOutlined />} href={onDownloadUrl} />
          </Tooltip>
        ) : null}
        {showApplyAction ? (
          <Tooltip title={usageTone === "active" ? "已是当前步骤附件" : "引用到当前上传步骤"}>
            <Button
              size="small"
              type="text"
              icon={<LinkOutlined />}
              disabled={!activeStepId || usageTone === "active"}
              className={usageTone === "active" ? "!text-blue-500" : undefined}
              onClick={onApply}
            />
          </Tooltip>
        ) : null}
        {showPromptAction ? (
          <Tooltip title="生成提示词">
            <Button size="small" type="text" icon={<RobotOutlined />} onClick={onPrompt} />
          </Tooltip>
        ) : null}
        <Tooltip title="复制路径">
          <Button size="small" type="text" icon={<CopyOutlined />} onClick={onCopyPath} />
        </Tooltip>
        {showDeleteAction ? (
          <Tooltip title="删除附件">
            <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={onDelete} />
          </Tooltip>
        ) : null}
      </Space>
    </div>
  );
}

function attachmentFileName(file: string): string {
  return file.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? file;
}
