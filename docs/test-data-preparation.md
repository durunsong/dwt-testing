# Dowalet 前端测试数据准备说明

本文档用于说明执行核心自动化用例前需要准备的本地环境变量、测试账号、附件和数据边界。真实账号、密码、token、DB 密码只允许放在本地 `.env*` 或 CI Secret 中。

## 环境文件

本地建议从 `.env.example` 复制生成 `.env`，按目标环境补齐。项目默认执行环境为 `sit`（`TEST_ENV=sit`），对应 `.env` + `.env.sit`：

```bash
cp .env.example .env
cp .env.example .env.sit
```

执行 CI 或共享演示时，优先使用 Secret 注入，并在命令中追加 `--no-env-file`，避免读取本机私有配置。

## 基础账号

| 数据项 | 变量 | 用途 | 要求 |
| --- | --- | --- | --- |
| user 登录页 | `USER_LOGIN_URL` | user 端登录入口 | 指向测试环境，不允许使用生产域名。 |
| user 注册页 | `USER_REGISTER_URL` | 邮箱/手机号注册流程 | 指向测试环境注册页，不允许使用生产域名。 |
| user 账号 | `USER_USERNAME` | user 登录、KYC、钱包、消息、账号安全 | 账号状态正常，具备访问目标菜单权限；邮箱账号建议使用 `@test.com` 域名。 |
| user 密码 | `USER_PASSWORD` | user 登录 | 放在本地环境变量。 |
| 注册默认密码 | `USER_REGISTER_PASSWORD` | 注册后密码登录、验证码登录流程 | 8-20 位，需同时包含字母、数字和 `._~!@#$^&*` 中的特殊字符，例如 `Test@12345.`。 |
| 注册测试邮箱 | `${mail_email}` / `${kyc_mail_email}` / `${kyc_apv_mail_email}` | 邮箱注册、KYC 提交流程 | 用例运行时自动生成 `6位数字+6位小写字母@test.com`，每次执行自动更换。 |
| admin 登录页 | `ADMIN_LOGIN_URL` | admin 端登录入口 | 指向测试环境，不允许使用生产域名。 |
| admin 账号 | `ADMIN_USERNAME` | 后台登录、KYC 审核、资料修改 | 具备审核和资料编辑权限。 |
| admin 密码 | `ADMIN_PASSWORD` | admin 登录和资料修改确认 | 放在本地环境变量。 |

## KYC 数据

| 数据项 | 变量 | 建议值 |
| --- | --- | --- |
| 企业名称前缀 | `KYC_ENTERPRISE_NAME_PREFIX` | `自动化测试企业` |
| 营业执照号前缀 | `KYC_LICENSE_NO_PREFIX` | `AUTO` |
| 法人姓名 | `KYC_LEGAL_PERSON` | 使用测试环境允许的虚拟姓名。 |
| 法人身份证号 | `KYC_ID_CARD_NO` | 使用测试环境白名单或虚拟证件号。 |
| 审核备注 | `KYC_REVIEW_REMARK` | `自动化测试审核通过` |
| 营业执照图片 | `KYC_BUSINESS_LICENSE_FILE` | 项目相对路径，例如 `uploads/business-license.png`。 |
| 身份证人像面 | `KYC_ID_CARD_FRONT_FILE` | 项目相对路径。 |
| 身份证国徽面 | `KYC_ID_CARD_BACK_FILE` | 项目相对路径。 |

KYC 用例会用 `${timestamp}` 拼接企业名称和执照号，减少重复数据冲突。若测试环境对证件号唯一性有约束，需要准备可重复回收的数据池。

## 附件要求

- 用例附件放在 `uploads/cases/<caseId>/` 下，**已提交到仓库**；运行时上下文在 `uploads/app-context/`（不入库）。
- YAML 中只写项目相对路径，不写本机绝对路径。
- 演示前确认附件不包含真实证件、真实姓名、手机号、邮箱或客户资料。
- 上传失败时先执行 `pnpm dwt preflight <caseId> --env=local` 检查路径；缺失占位图可运行 `pnpm fixtures:uploads` 补齐。

## API 与 DB

| 能力 | 变量 | 默认 | 说明 |
| --- | --- | --- | --- |
| API 断言 | `API_ENABLED` | `false` | 启用后补齐 `API_BASE_URL` 或同义变量。 |
| API 基础地址 | `API_BASE_URL` / `APP_API_BASE_URL` / `DWT_API_BASE_URL` / `TEST_API_BASE_URL` | 空 | 相对 API URL 会按该顺序解析，也可复用已登录 session 的域名。 |
| API 鉴权 token | `API_TOKEN` | 空 | 需要接口鉴权且不能复用 session cookie 时配置。 |
| 业务码路径 | `API_BUSINESS_CODE_PATHS` | `code` | 多个路径用英文逗号分隔。 |
| 业务成功码 | `API_BUSINESS_SUCCESS_CODES` | `0000` | 多个值用英文逗号分隔。 |
| 业务失败码 | `API_BUSINESS_FAILURE_CODES` | 空 | 留空时按“出现业务码但不在成功码内”为失败。 |
| 业务码严格模式 | `API_BUSINESS_CODE_STRICT` | `true` | 设为 `false` 时放宽业务码判断。 |
| DB 校验 | `DB_ENABLED` | `false` | 只允许只读账号和只读 SQL。 |
| DB 类型 | `DB_TYPE` | `mysql` | 当前主要面向 MySQL。 |
| DB 连接 | `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | 空 | 只配置测试环境只读账号。 |

DB 用例只允许 `select/show/desc/describe/explain`。涉及清理、状态回滚、资金或审批历史时，不在自动化脚本中直接改库，必须走人工确认的补偿流程。

## AI 与运行参数

| 能力 | 变量 | 默认 | 说明 |
| --- | --- | --- | --- |
| AI 服务 | `AI_BASE_URL` / `AI_MODEL` / `AI_API_KEY` | 空 | 只影响 AI 生成、失败分析和资料辅助，不影响普通用例运行。 |
| AI 重试 | `AI_TIMEOUT_MS` / `AI_MAX_RETRIES` / `AI_RETRY_DELAY_MS` | `60000` / `2` / `1000` | OpenAI 兼容客户端请求参数。 |
| 失败分析 | `AI_FAILURE_ANALYSIS` | `true` | 设为 `false` 可关闭失败步骤 AI 分析。 |
| 浏览器模式 | `HEADLESS` / `SLOW_MO` / `VISUAL_MODE` | `false` / `100` / 空 | 控制 Playwright 执行体验。 |
| 采集策略 | `TRACE` / `VIDEO` / `SCREENSHOT` | `on` / `retain-on-failure` / `only-on-failure` | trace 由 Playwright 配置读取，视频保留也会被 runner 参考。 |
| 视口 | `BROWSER_VIEWPORT_WIDTH` / `BROWSER_VIEWPORT_HEIGHT` | `1920` / `1080` | 留空时使用 `platform.config.json`。 |
| 登录等待 | `FLOW_LOGIN_TIMEOUT_MS` | `3000` | 登录 flow 的等待超时时间，慢环境可适当调大。 |
| 服务端口 | `SERVER_HOST` / `SERVER_PORT` / `WEB_HOST` / `WEB_PORT` | `127.0.0.1` / `4300` / `0.0.0.0` / `4301` | 本地服务监听配置；也可使用 `PORT` 覆盖服务端口。 |
| Web 构建 | `VITE_*` | 见 `.env.example` | 前端品牌、API 地址、上传限制、请求超时和 dev proxy。 |
| 桌面端 | `DWT_DESKTOP_DEV_SERVER_URL` / `DWT_DESKTOP_API_PORT` / `PLAYWRIGHT_BROWSERS_PATH` | 见 `.env.example` | 桌面端开发或打包运行时使用。 |

## 演示前检查

```bash
pnpm dwt doctor
pnpm dwt validate
pnpm dwt preflight login_user --env=local
pnpm dwt preflight login_admin --env=local
pnpm dwt preflight kyc_submit_and_approve --env=local
```

预检通过后再执行真实浏览器回归。对外展示报告、截图、trace 和视频前，需要完成脱敏检查。
