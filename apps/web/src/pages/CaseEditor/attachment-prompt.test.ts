import assert from "node:assert/strict";
import { test } from "node:test";
import { appendInstructionBlock, buildAttachmentAiPrompt, buildAttachmentBatchAiPrompt, buildFileToUploadStepsMap, collectUploadSteps, filterNewAttachmentSearchResults, getStepsUsingFile, insertUploadStepBeforeSubmit, isImageAttachmentFile, resolveAttachmentUsageTone, upsertUploadStepFile } from "./attachment-prompt";

test("builds an AI prompt for attaching any local upload file to a web_upload step", () => {
  const prompt = buildAttachmentAiPrompt({
    caseId: "admin_zilkiaoxiugai001",
    file: "uploads/cases/admin_zilkiaoxiugai001/favicon.png",
    step: {
      stepId: "upload_avatar",
      name: "上传头像",
      target: "admin_avatar_upload"
    }
  });

  assert.match(prompt, /admin_zilkiaoxiugai001/);
  assert.match(prompt, /uploads\/cases\/admin_zilkiaoxiugai001\/favicon\.png/);
  assert.match(prompt, /type: web_upload/);
  assert.match(prompt, /target: admin_avatar_upload/);
  assert.match(prompt, /file: uploads\/cases\/admin_zilkiaoxiugai001\/favicon\.png/);
  assert.doesNotMatch(prompt, /绝对路径/);
});

test("guides admin profile image attachments to the avatar upload target", () => {
  const prompt = buildAttachmentAiPrompt({
    caseId: "admin_zilkiaoxiugai001",
    file: "uploads/cases/admin_zilkiaoxiugai001/111.png"
  });

  assert.match(prompt, /admin_profile_save/);
  assert.match(prompt, /target: admin_avatar_upload/);
  assert.match(prompt, /step_id: upload_avatar/);
});

test("builds a reusable AI prompt for multiple form attachments", () => {
  const prompt = buildAttachmentBatchAiPrompt({
    caseId: "admin_zilkiaoxiugai001",
    files: [
      { name: "license.png", file: "uploads/cases/admin_zilkiaoxiugai001/license.png" },
      { name: "bank.png", file: "uploads/cases/admin_zilkiaoxiugai001/bank.png" },
      { name: "license-copy.png", file: "uploads/cases/admin_zilkiaoxiugai001/license.png" }
    ],
    steps: [
      { stepId: "upload_license", name: "上传营业执照", target: "business_license_upload" },
      { stepId: "upload_bank", name: "上传银行开户许可证", target: "bank_license_upload" }
    ]
  });

  assert.match(prompt, /复杂表单/);
  assert.match(prompt, /步骤名称使用真实业务含义/);
  assert.match(prompt, /license\.png -> uploads\/cases\/admin_zilkiaoxiugai001\/license\.png/);
  assert.match(prompt, /bank\.png -> uploads\/cases\/admin_zilkiaoxiugai001\/bank\.png/);
  assert.match(prompt, /同一个路径可以被多个上传步骤复用/);
  assert.match(prompt, /name: 上传xxx/);
  assert.match(prompt, /target: business_license_upload/);
  assert.match(prompt, /file: uploads\/cases\/admin_zilkiaoxiugai001\/license\.png/);
  assert.doesNotMatch(prompt, /上传头像/);
});

test("collects web_upload steps with target and file from yaml", () => {
  const steps = collectUploadSteps([
    "upload_slots:",
    "  - step_id: upload_avatar",
    "    name: 上传头像",
    "    type: web_upload",
    "    target: admin_avatar_upload",
    "    file: \"uploads/cases/demo/favicon.png\"",
    "  - step_id: click_save",
    "    name: 保存",
    "    type: web_click"
  ].join("\n"));

  assert.deepEqual(steps, [
    {
      stepId: "upload_avatar",
      name: "上传头像",
      target: "admin_avatar_upload",
      file: "uploads/cases/demo/favicon.png"
    }
  ]);
});

test("maps attachment usage tone by selected upload step", () => {
  const steps = collectUploadSteps([
    "  - step_id: upload_user_auth_id",
    "    name: 上传个人认证证件照片",
    "    type: web_upload",
    "    file: uploads/cases/kyc_submit/id.png",
    "  - step_id: upload_business_license",
    "    name: 上传企业营业执照",
    "    type: web_upload",
    "    file: uploads/cases/kyc_submit/license.jpg"
  ].join("\n"));
  const map = buildFileToUploadStepsMap(steps);

  assert.equal(resolveAttachmentUsageTone("uploads/cases/kyc_submit/id.png", "upload_user_auth_id", map), "active");
  assert.equal(resolveAttachmentUsageTone("uploads/cases/kyc_submit/license.jpg", "upload_user_auth_id", map), "linked");
  assert.equal(resolveAttachmentUsageTone("uploads/cases/kyc_submit/unused.pdf", "upload_user_auth_id", map), "unused");
  assert.deepEqual(getStepsUsingFile("uploads/cases/kyc_submit/license.jpg", map).map((step) => step.stepId), ["upload_business_license"]);
});

test("upserts attachment file path into selected upload step", () => {
  const next = upsertUploadStepFile([
    "steps:",
    "  - step_id: upload_avatar",
    "    name: 上传头像",
    "    type: web_upload",
    "    target: admin_avatar_upload",
    "  - step_id: click_save",
    "    name: 保存",
    "    type: web_click"
  ].join("\n"), "upload_avatar", "uploads/cases/admin_zilkiaoxiugai001/favicon.png");

  assert.match(next, /file: "uploads\/cases\/admin_zilkiaoxiugai001\/favicon\.png"/);
  assert.match(next, /  - step_id: click_save/);
});

test("inserts a new upload step before the submit step when yaml has no web_upload step", () => {
  const next = insertUploadStepBeforeSubmit([
    "steps:",
    "  - step_id: input_password",
    "    name: 输入登录密码",
    "    type: web_input",
    "    session: admin",
    "    target: admin_profile_password",
    "    value: ${env.ADMIN_PASSWORD}",
    "  - step_id: click_save",
    "    name: 点击保存按钮",
    "    type: web_click",
    "    session: admin",
    "    target: admin_profile_save"
  ].join("\n"), {
    stepId: "upload_avatar",
    name: "上传头像",
    session: "admin",
    target: "admin_avatar_upload",
    file: "uploads/cases/admin_zilkiaoxiugai001/111.png",
    beforeTarget: "admin_profile_save"
  });

  assert.match(next, /step_id: upload_avatar/);
  assert.match(next, /target: admin_avatar_upload/);
  assert.match(next, /file: "uploads\/cases\/admin_zilkiaoxiugai001\/111\.png"/);
  assert.ok(next.indexOf("step_id: upload_avatar") < next.indexOf("step_id: click_save"));
});

test("filters search results already shown in current attachment list", () => {
  const results = filterNewAttachmentSearchResults(
    [
      { kind: "file", file: "uploads/cases/admin_zilkiaoxiugai001/license.png" },
      { kind: "directory", file: "uploads/cases/admin_zilkiaoxiugai001/company" },
      { kind: "file", file: "uploads/cases/admin_zilkiaoxiugai001/company/bank.png" }
    ],
    [
      { file: "uploads/cases/admin_zilkiaoxiugai001/license.png" }
    ]
  );

  assert.deepEqual(results.map((item) => item.file), [
    "uploads/cases/admin_zilkiaoxiugai001/company",
    "uploads/cases/admin_zilkiaoxiugai001/company/bank.png"
  ]);
});

test("appends uploaded attachment instruction without losing existing text", () => {
  assert.equal(
    appendInstructionBlock("先补充开户资料表单", "请上传 uploads/cases/demo/license.png"),
    "先补充开户资料表单\n\n请上传 uploads/cases/demo/license.png"
  );
  assert.equal(
    appendInstructionBlock("", "请上传 uploads/cases/demo/license.png"),
    "请上传 uploads/cases/demo/license.png"
  );
});

test("detects image attachments from mime type or file extension", () => {
  assert.equal(isImageAttachmentFile({ name: "license.png", file: "uploads/cases/demo/license.png" }), true);
  assert.equal(isImageAttachmentFile({ name: "photo", file: "uploads/cases/demo/photo.webp" }), true);
  assert.equal(isImageAttachmentFile({ name: "scan", file: "uploads/cases/demo/file.bin", mimeType: "image/jpeg" }), true);
  assert.equal(isImageAttachmentFile({ name: "contract.pdf", file: "uploads/cases/demo/contract.pdf" }), false);
});
