# 用例附件目录

各自动化用例的上传文件请放在 `uploads/cases/<case_id>/` 下，**已纳入 Git 版本管理**（桌面端 seed 同步会镜像到 workspace）。  
在 **Case 编辑页**（如 `http://localhost:4301/cases/kyc_submit`）可直接上传/替换附件，路径会写入用例 YAML 的 `web_upload.file` 字段。

## 目录约定

| 用例 ID | 目录 | 说明 |
|---------|------|------|
| `kyc_submit` | `uploads/cases/kyc_submit/` | KYC 全流程（`flow_submit_kyc` 默认读取，亦可通过 `.env` 覆盖） |
| `kyc_submit_and_approve` | 同上或独立目录 | 可与 `kyc_submit` 共用附件 |
| `admin_zilkiaoxiugai001` | `uploads/cases/admin_zilkiaoxiugai001/` | admin 头像上传 |
| `admin_zilkiaoxiugai002` | `uploads/cases/admin_zilkiaoxiugai002/` | admin 头像上传 |

## 当前 YAML 引用的文件（须与 scenario 一致）

| 用例 | 文件 |
|------|------|
| `admin_zilkiaoxiugai001` | `111-2.png` |
| `admin_zilkiaoxiugai002` | `222.png` |
| `kyc_submit` | `Snipaste_2026-03-02_18-32-35.png`、`20260106-183548.jpg`、`20260106-183532.jpg` |

## kyc_submit 可选默认文件（`.env.example` / `flow_submit_kyc` 回退）

- `business-license.png` — 营业执照
- `office-scene.png` — 企业办公场景
- `id-card-front.png` — 身份证人像面 / 个人认证证件
- `id-card-back.png` — 身份证国徽面
- `id-card-handheld.png` — 手持身份证
- `live-prove.png` — 居住证明（选填）

## 环境变量覆盖

可在 `.env.sit` / `.env.local` 中覆盖默认路径，例如：

```env
KYC_BUSINESS_LICENSE_FILE=uploads/cases/kyc_submit/business-license.png
KYC_ID_CARD_FRONT_FILE=uploads/cases/kyc_submit/id-card-front.png
```

## 维护命令

```bash
# 扫描 scenario YAML，补齐缺失的最小 PNG/JPG 占位图
pnpm fixtures:uploads
```

桌面端 `build` 前会自动执行上述检查；缺失文件会导致 seed manifest 生成失败或 preflight 报 `upload_file_missing_on_disk`。

## 注意事项

- 附件建议使用 PNG/JPG，尺寸不必过大（测试用 100KB 以内即可）。
- 占位图为 1×1 最小合法图片，仅保证路径与格式校验通过；可在 Case 编辑页替换为真实样例。
- `uploads/app-context/` 为运行时上下文，仍在 `.gitignore` 中，勿提交。
