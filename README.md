# DWT Testing

DWT Testing 是一个可定制的 AI 辅助端到端测试平台模板，核心技术栈为 `Node.js + TypeScript + Playwright + YAML DSL + Fastify + React + Electron`。

它不是把测试逻辑写死在某个业务系统里的 Playwright spec 集合，而是把“业务流程、页面定位、运行环境、报告产物、AI 辅助生成”拆成可维护的工程模块。团队可以用 YAML 描述登录、提交、审批、接口断言、只读 DB 校验等流程，再通过 CLI、Web 控制台或桌面端执行，并沉淀报告、日志、截图、trace 和视频。

## 目录

- [适合场景](#适合场景)
- [核心能力](#核心能力)
- [整体架构](#整体架构)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [常用命令](#常用命令)
- [用例与 DSL](#用例与-dsl)
- [Web 控制台](#web-控制台)
- [配置说明](#配置说明)
- [运行产物](#运行产物)
- [CI 与质量检查](#ci-与质量检查)
- [桌面端与构建](#桌面端与构建)
- [安全边界](#安全边界)
- [文档索引](#文档索引)

## 适合场景

- 将登录、资料提交、KYC、审批、后台操作等长链路流程沉淀为可读、可复用的用例。
- 让测试、业务和研发共同维护 YAML 用例，而不是直接修改 Playwright 代码。
- 同一套用例覆盖本地调试、CI 预检、真实浏览器回归和桌面端交付。
- 在 Web 登录后复用浏览器 session cookie，继续执行接口断言或数据核验。
- 接入 OpenAI 兼容模型，根据需求文档、页面资料、路由上下文、失败截图辅助生成和修复用例。
- 为不同业务系统快速定制品牌名、端口、目录、环境变量、上传限制、桌面端应用信息和报告产物路径。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| YAML DSL | 用 `cases/scenario/*.yaml` 描述流程，用 `cases/location/*.yaml` 维护页面定位，用 `cases/shared/*.yaml` 沉淀复用能力。 |
| 多 session 编排 | 支持 `user`、`admin` 等多个业务端同时参与同一条流程，适合提交后由后台审核的场景。 |
| Playwright Runner | 支持有头/无头、慢放、截图、trace、视频、默认视口、步骤超时、网络等待和运行事件输出。 |
| Web 步骤 | 覆盖打开页面、输入、点击、选择、上传、等待、断言、提取变量、截图和内置业务 flow。 |
| API 步骤 | 支持请求、状态码、业务码、响应字段断言、变量保存，并可复用浏览器 session cookie。 |
| DB 只读校验 | 支持查询和断言，用于关键流程后的落库核验；默认需要显式开启 DB 能力。 |
| 运行前预检 | 在真正启动浏览器前检查 DSL、环境变量、定位文件、API baseUrl、DB 开关和上传文件。 |
| Web 控制台 | 提供 Dashboard、用例列表、用例编辑、运行详情、报告查看、历史记录、设置页。 |
| AI 辅助 | 支持生成用例草稿、对话式补全、截图分析、资料导入、复用能力推荐和失败分析。 |
| Electron 桌面端 | 复用 Web 控制台和 Fastify API，适合打包给非研发人员本地执行。 |

## 整体架构

```text
YAML 用例 / Web 控制台 / CLI
          |
          v
Fastify API  --------------------  AI Generator
          |                         |
          v                         v
Scenario Loader -> Preflight -> Scenario Orchestrator
                                      |
                                      v
                      Web Executor / API Executor / DB Executor
                                      |
                                      v
                logs / reports / screenshots / traces / videos / ai-reports
```

核心包职责：

- `@ai-e2e/shared`：公共类型、常量、Zod Schema、变量解析、路径和脱敏工具。
- `@ai-e2e/runner`：YAML 加载、预检、执行器、session 管理、编排器和报告生成。
- `@ai-e2e/ai-generator`：OpenAI 兼容客户端、提示词构建、截图分析和 DSL 生成。
- `@ai-e2e/server`：Fastify API，封装用例、运行、报告、设置、上下文和 AI 接口。
- `@ai-e2e/web`：React 控制台。
- `@ai-e2e/desktop`：Electron 桌面端。

## 项目结构

```text
apps/
  server/       Fastify API 服务
  web/          React + Vite 控制台
  desktop/      Electron 桌面端
packages/
  shared/       公共类型、Schema、常量、工具函数
  runner/       CLI、YAML Loader、预检、执行器、编排器、报告生成
  ai-generator/ AI 提示词、OpenAI 兼容客户端、截图分析、DSL 生成
cases/
  scenario/     示例业务流程 YAML
  location/     页面元素定位 YAML
  shared/       可复用流程能力 YAML
  templates/    用例模板
docs/           DSL、预检、CI、定制、data-testid、AI 上下文等说明
logs/           本地运行日志，默认不提交
reports/        HTML/JSON 报告，默认不提交
screenshots/    步骤截图，默认不提交
traces/         Playwright trace，默认不提交
videos/         Playwright 视频录制，默认不提交
uploads/        上下文资料、AI 材料、用例附件，默认不提交
```

## 快速开始

环境要求：

- Node.js 20+
- pnpm 9+
- Playwright 支持的浏览器环境

安装依赖：

```bash
pnpm install
```

如本机还没有 Playwright 浏览器，可安装浏览器资源：

```bash
pnpm exec playwright install
```

准备本地配置：

```bash
cp .env.example .env
```

只填写你要运行的能力所需变量。真实账号、密码、token、DB 密码和 AI Key 只放在本地 `.env*` 或 CI Secret 中，不要提交。

也可以用初始化脚本生成自己的平台配置：

```bash
pnpm setup:platform --brand="你的团队" --product="你的测试平台" --user-login-url="https://example.com/user/login" --admin-login-url="https://example.com/admin/login"
```

启动 API 和 Web 控制台：

```bash
pnpm dev
```

默认地址：

- API: `http://localhost:4300`
- Web: `http://localhost:4301`

桌面端开发模式：

```bash
pnpm desktop:dev
```

## 常用命令

### 用例 CLI

```bash
pnpm dwt list
pnpm dwt doctor
pnpm dwt setup --check
pnpm dwt validate [caseId|file]
pnpm dwt preflight <caseId|file> [--env=local|dev|sit] [--no-env-file]
pnpm dwt plan <caseId|file> [--env=local|dev|sit] [--no-env-file]
pnpm dwt run <caseId|file> [--env=local|dev|sit] [--headless|--headed] [--no-env-file]
```

说明：

- `list`：列出 `cases/scenario/` 下的用例。
- `doctor` / `setup --check`：只读检查 Node.js、项目根目录、Playwright 依赖、用例目录、AI 配置和登录入口配置，不写入 `.env*`。
- `validate`：校验单个或全部 YAML 用例结构。
- `preflight` / `plan`：执行运行前预检，不启动真实浏览器流程。
- `run`：执行用例并生成日志、报告、截图和 trace。
- 未指定 `--env` 时默认使用 `sit`，并加载 `.env` + `.env.sit`。
- `--no-env-file`：只读取当前进程或 CI 注入的环境变量，不加载本地 `.env*`。

### 开发与检查

```bash
pnpm typecheck
pnpm test
pnpm dwt validate
pnpm ci:check
```

`pnpm ci:check` 会依次执行类型检查、单测和 DSL 校验，适合作为基础 CI 门禁。

## 用例与 DSL

一个用例通常由三类文件组成：

- `cases/scenario/*.yaml`：业务流程、会话、变量、步骤、断言。
- `cases/location/*.yaml`：页面元素定位，推荐优先使用 `data-testid`。
- `cases/shared/*.yaml`：登录、上传、审核等可复用流程能力。

示例：

```yaml
case_id: login_user
case_name: 用户登录
case_type: uncategorized
mode: web
sessions:
  - name: user
    login_url: "${env.USER_LOGIN_URL}"
    username: "${env.USER_USERNAME}"
    password: "${env.USER_PASSWORD}"
locations:
  file: cases/location/login.user.yaml
steps:
  - step_id: open_login
    name: 打开登录页
    type: web_open
    session: user
    url: "${session.login_url}"
  - step_id: login
    name: 登录
    type: flow_login
    session: user
    username: "${session.username}"
    password: "${session.password}"
```

支持的步骤类型包括：

- Web：`web_open`、`web_reload`、`web_input`、`web_select`、`web_click`、`web_upload`、`web_wait_text`、`web_wait_element`、`web_assert_text`、`web_assert_visible`、`web_assert_url`、`web_extract`、`web_screenshot`。
- 内置 flow：`flow_login`、`flow_submit_kyc`、`flow_admin_approve_kyc`。
- API：`api_request`、`api_assert`。
- DB：`db_query`、`db_assert`；`db_clean` 是预留步骤，当前执行器会拒绝，默认只开放只读能力。

变量支持 `${env.KEY}`、`${session.login_url}`、`${session.username}`、`${session.password}`、`${var.name}`、`${timestamp}` 和 `${runId}`。缺失变量会在校验或预检阶段暴露，避免跑到一半才失败。

更多说明见 [docs/dsl-design.md](docs/dsl-design.md) 和 [docs/how-to-add-case.md](docs/how-to-add-case.md)。

## Web 控制台

启动 `pnpm dev` 后，Web 控制台提供这些主要页面：

- Dashboard：查看用例、运行状态、近期结果和快捷入口。
- 用例列表：管理 YAML 用例，导入资料，让 AI 生成用例草稿，并选择共享能力复用。
- 用例编辑：编辑 YAML、上传附件、运行预检、执行用例。
- 运行详情：查看实时状态、步骤时间线、日志、报告和产物链接。
- 报告查看：查看 HTML/JSON 报告、开发摘要、失败信息和复现建议。
- 历史记录：查看和清理历史运行记录。
- 设置页：维护本地环境配置、业务上下文来源、路由/菜单资料和 DB 连通性。

后端主要接口覆盖：

- `/api/cases`：用例列表、详情、保存、删除、校验、预检、附件。
- `/api/test-runs`：创建运行、历史记录、运行详情、报告、日志。
- `/api/artifacts`：报告、截图、trace 等产物查询和清理。
- `/api/settings/env-files`：本地环境配置读取、保存和导入。
- `/api/app/context`：业务上下文读取、保存、解析和删除。
- `/api/ai/*`：AI 对话、用例草稿、截图分析和资料辅助生成。
- `/api/db/health`：DB 只读连接健康检查。

## 配置说明

`platform.config.json` 保存可提交的非敏感定制项：

- `app`：品牌名和产品名。
- `server`：API 监听地址、端口和 CORS 来源。
- `web`：Web dev server 地址、端口、代理目标、请求超时和 localStorage key。
- `desktop`：桌面端应用 ID、产品名、维护者、安装包命名、内置 API 端口和窗口尺寸。
- `workspace.directories`：桌面端首次启动时需要创建的工作目录。
- `artifacts`：日志、报告、截图、trace、视频的本地目录。
- `browser.defaultViewport`：Playwright 默认视口，可被环境变量临时覆盖。
- `context`：设置页默认上下文来源和路由分组关键词。
- `uploads`：上下文导入、AI 资料、用例附件目录/大小和文本截断限制。

`.env*` 保存本地或环境级敏感配置，例如：

- 被测系统登录地址和账号密码。
- API baseUrl、业务码路径和成功码。
- AI 服务地址、模型名和 API Key。
- DB 只读连接信息。
- 浏览器运行参数，如 `HEADLESS`、`SLOW_MO`、`VISUAL_MODE`、视口覆盖。

环境文件约定：

| 环境 | 文件 | 说明 |
| --- | --- | --- |
| `sit`（默认） | `.env` + `.env.sit` | CLI、Web 控制台和 `.env.example` 的默认执行环境。 |
| `local` | `.env` + `.env.local` | 本机联调覆盖项。 |
| `dev` | `.env` + `.env.dev` | 开发环境。 |
| `prod` | `.env` + `.env.prod` | 仅配置和构建识别，自动化运行会被拦截。 |

`prod` 可用于配置和构建场景，但自动化运行守卫会阻止在 `prod/production` 环境或疑似生产域名执行流程。

## 运行产物

默认运行产物：

- `logs/`：运行日志。
- `reports/`：HTML/JSON 报告。
- `screenshots/`：步骤截图。
- `traces/`：Playwright trace。
- `videos/`：Playwright 视频录制。
- `ai-reports/`：AI 失败分析或辅助报告。
- `uploads/`：业务上下文、AI 资料、用例附件。

这些目录主要用于本地调试和执行结果留存，通常不应提交到仓库。目录位置可在 `platform.config.json` 中调整。

## CI 与质量检查

基础 CI 建议：

```bash
pnpm install --frozen-lockfile
pnpm ci:check
```

如果 CI 中已经注入测试环境变量，可以增加环境级预检：

```bash
pnpm dwt preflight login_user --env=sit --no-env-file
pnpm dwt preflight login_admin --env=sit --no-env-file
```

确认 runner 已安装 Playwright 浏览器后，再逐步加入真实浏览器回归：

```bash
pnpm dwt run login_user --env=sit --headless --no-env-file
```

更多建议见 [docs/ci.md](docs/ci.md)。

## 桌面端与构建

Web 静态构建：

```bash
pnpm web:build
```

桌面端开发、打包和分发：

```bash
pnpm desktop:dev
pnpm desktop:build
pnpm desktop:pack
pnpm desktop:dist:win
pnpm desktop:dist:linux
pnpm desktop:dist:mac
```

说明：

- Linux 和 macOS 安装包建议在对应系统的 CI runner 中构建和验证。
- 当前默认未配置代码签名、公证或浏览器资源内置策略。
- 桌面端默认复用同一套 Web 控制台与 API 能力，首次启动会按 `workspace.directories` 创建工作目录。

## 安全边界

- 示例用例是模板，不包含真实业务账号或生产地址。
- 账号、密码、token、证书、DB 密码、AI Key 只能放在本地 `.env*` 或 CI Secret 中。
- 自动化运行禁止面向 `prod/production` 环境，且会拦截疑似生产域名。
- DB 能力应使用只读账号；涉及数据清理、资金、状态机、审批和历史数据时需要人工确认。
- AI 生成结果必须人工审阅，尤其是业务状态、金额口径、接口断言和 DB 断言。
- 报告、日志、截图、trace、视频和上传资料可能包含业务信息，交付或共享前需要脱敏。

## 文档索引

- [docs/dsl-design.md](docs/dsl-design.md)：YAML DSL、共享步骤、变量和上传附件。
- [docs/how-to-add-case.md](docs/how-to-add-case.md)：新增用例流程。
- [docs/preflight.md](docs/preflight.md)：运行前预检范围和接口。
- [docs/customization.md](docs/customization.md)：平台定制说明。
- [docs/ci.md](docs/ci.md)：CI 检查建议。
- [docs/front-end.md](docs/front-end.md)：当前前端实现说明。
- [docs/data-testid-guide.md](docs/data-testid-guide.md)：页面定位与 `data-testid` 建议。
- [docs/ai-prompt](docs/ai-prompt)：当前项目实现上下文。
- [docs/ai-prompt-templates.md](docs/ai-prompt-templates.md)：AI 辅助生成用例与失败分析的提示词模板。
- [docs/bailian.md](docs/bailian.md)：阿里云百炼模型接入示例。
- [docs/dowalet-regression-case-matrix.md](docs/dowalet-regression-case-matrix.md)：Dowalet 核心业务流程用例矩阵。
- [docs/test-data-preparation.md](docs/test-data-preparation.md)：测试数据与环境配置说明。
- [docs/assertion-and-exception-checklist.md](docs/assertion-and-exception-checklist.md)：页面断言与异常场景清单。
- [docs/execution-and-demo-guide.md](docs/execution-and-demo-guide.md)：执行与演示说明。
