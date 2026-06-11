# DWT核心业务流程端到端AI自动化测试操作文档

本文档面向评审、研发、业务和后续接手同学，说明如何在 `dwt-testing` 项目中配置、执行、查看报告、新增用例和做评审演示。

核心目标：让 Dowalet 登录、注册、KYC、后台审核、资料修改、钱包首页、消息中心等高频人工回归流程，优先由自动化平台执行，减少重复测试人力投入，让研发和业务把时间投入到更有价值的质量判断和业务交付中。

## 1. 适用场景

- 发版前：执行 `login_user`、`login_admin`、`kyc_submit_and_approve` 等核心冒烟用例。
- 修复后：只运行受影响用例，验证页面跳转、接口返回、弹窗提示、列表渲染和异常提示。
- 回归时：批量执行 YAML 用例，生成 HTML/JSON 报告、截图、trace 和视频。
- 失败后：用日志、截图、trace、视频和 AI 失败分析报告定位原因。
- 新增流程时：用 AI 生成用例矩阵和 YAML 草稿，人工确认后纳入用例库。

## 2. 项目能力概览

| 能力 | 位置 | 作用 |
| --- | --- | --- |
| 业务流程用例 | `cases/scenario/*.yaml` | 描述登录、KYC、审核、资料修改等业务流程。 |
| 页面元素定位 | `cases/location/*.yaml` | 维护按钮、输入框、菜单、提示文案等定位方式。 |
| 共享流程 | `cases/shared/*.yaml` | 沉淀登录、审核、验证码获取等可复用步骤。 |
| CLI 执行 | `pnpm dwt ...` | 列表、校验、预检、执行用例并生成报告。 |
| Web 控制台 | `http://localhost:4301` | 查看用例、运行详情、报告、历史记录和设置。 |
| 运行产物 | `reports/`、`screenshots/`、`traces/`、`videos/`、`ai-reports/` | 保存报告、截图、trace、视频和 AI 分析结果。 |
| AI Prompt | `docs/ai-prompt-templates.md` | 复用 AI 生成用例、YAML、定位建议和失败分析。 |

## 3. 环境准备

本机需要准备：

- Node.js 20+
- pnpm 9+
- Playwright 支持的浏览器环境

进入项目并安装依赖：

```bash
cd dwt-testing
pnpm install
pnpm exec playwright install
```

复制本地环境文件：

```bash
cp .env.example .env
```

在 `.env` 中补齐测试环境信息。真实账号、密码、token、DB 密码、AI Key 只允许放在本地 `.env*` 或 CI Secret 中，不要提交、不要截图展示。

最小必填项通常包括：

```text
USER_LOGIN_URL=<user端测试环境登录地址>
USER_USERNAME=<user端测试账号>
USER_PASSWORD=<user端测试密码>
ADMIN_LOGIN_URL=<admin端测试环境登录地址>
ADMIN_USERNAME=<admin端测试账号>
ADMIN_PASSWORD=<admin端测试密码>
```

如果执行 KYC、上传、API 或 DB 校验，还需要按 `docs/test-data-preparation.md` 补齐 KYC 附件、API baseUrl、业务成功码和只读 DB 配置。

## 4. 快速自检

```bash
pnpm dwt doctor
pnpm dwt validate
pnpm dwt list
```

常见核心用例：

```text
login_user
login_admin
kyc_submit
kyc_submit_and_approve
admin_zilkiaoxiugai001
admin_zilkiaoxiugai002
register_email_login
register_email_verifycode_login
register_phone_login
```

## 5. CLI 执行自动化回归

预检只检查配置、变量、附件和用例依赖，不真正打开浏览器执行完整流程。建议每次真实执行前先预检。

```bash
pnpm dwt preflight login_user --env=local
pnpm dwt preflight kyc_submit_and_approve --env=local
```

有界面模式，适合演示和排查：

```bash
pnpm dwt run login_user --env=local --headed
pnpm dwt run kyc_submit_and_approve --env=local --headed
```

无界面模式，适合批量回归或 CI：

```bash
pnpm dwt run login_user --env=local --headless
```

共享机器建议使用 Secret 注入环境变量，并避免读取本地 `.env*`：

```bash
pnpm ci:check
pnpm dwt preflight login_user --env=sit --no-env-file
pnpm dwt run login_user --env=sit --headless --no-env-file
```

## 6. Web 控制台操作

启动 API 和 Web 控制台：

```bash
pnpm dev
```

默认地址：

- API：`http://localhost:4300`
- Web：`http://localhost:4301`

推荐操作路径：

1. 打开 `http://localhost:4301`。
2. 进入“用例列表”，查看 `cases/scenario/` 中的 YAML 用例。
3. 打开 `login_user` 或 `kyc_submit_and_approve`，查看步骤、定位文件和环境变量引用。
4. 先点击预检，确认环境变量、附件和用例配置完整。
5. 点击执行，进入运行详情页查看步骤状态、日志和失败产物。
6. 打开报告页，查看 HTML/JSON 报告、截图、trace、视频和失败摘要。
7. 进入设置页，查看环境配置、业务上下文资料和 AI 资料导入入口。

停止本地端口：

```bash
pnpm dev:stop
```

## 7. 查看报告和失败产物

| 目录 | 内容 | 用途 |
| --- | --- | --- |
| `logs/` | 运行日志 | 查看每一步执行情况和错误原因。 |
| `reports/` | HTML/JSON 报告 | 对外展示测试结果和执行摘要。 |
| `screenshots/` | 截图 | 查看失败页面状态或关键步骤状态。 |
| `traces/` | Playwright trace | 复现浏览器操作、网络请求和 DOM 状态。 |
| `videos/` | 视频 | 演示或排查复杂交互问题。 |
| `ai-reports/` | AI 分析报告 | 查看 AI 对失败原因的归类和修复建议。 |

失败时建议按这个顺序排查：

1. 看 CLI 或 Web 运行详情中的失败步骤。
2. 打开 `reports/` 中的 HTML 报告。
3. 查看失败截图，确认页面停在哪一步。
4. 用 Playwright trace 复现操作和接口请求。
5. 判断失败类型：环境变量缺失、账号数据异常、页面定位失效、接口异常、业务规则变更或脚本缺陷。
6. 必要时把 YAML、关键日志、截图说明交给 AI，生成失败分析和最小修复建议。

## 8. 新增业务用例 SOP

### 8.1 确认测试范围

先明确业务流程名称、前置测试账号和数据、入口页面或菜单路径、关键操作步骤、成功页面表现、接口成功码或关键字段、异常场景。

涉及资金、审批、权限、验证码、历史数据或 DB 校验时，先找业务或研发确认，不要让 AI 猜口径。

### 8.2 用 AI 生成用例矩阵

使用 `docs/ai-prompt-templates.md` 中的“生成业务用例矩阵”Prompt，把需求、页面资料、接口资料粘贴给 AI。

生成结果必须人工确认优先级、断言和异常场景。

### 8.3 生成 YAML DSL

将确认后的测试流程交给 AI，生成 `cases/scenario/*.yaml` 草稿。

规范：

- 登录地址、账号、密码使用 `${env.KEY}` 或 `${session.*}`。
- 不写死 token、生产地址、本机绝对路径。
- 页面元素通过 `target` 引用 `cases/location/*.yaml`。
- 提交、保存、审核类步骤补 `wait_for_api`。
- 每条用例至少有一个页面断言、API 断言或只读 DB 断言。

### 8.4 补页面定位

页面定位维护在 `cases/location/*.yaml`。定位优先级建议为 `data-testid`、role、label、placeholder、text、name、css、xpath。

xpath 只作为最后兜底。长期建议推动前端补充稳定 `data-testid`。

### 8.5 校验和执行

```bash
pnpm dwt validate <caseId>
pnpm dwt preflight <caseId> --env=local
pnpm dwt run <caseId> --env=local --headed
```

通过后更新：

- `docs/dowalet-regression-case-matrix.md`
- `docs/test-data-preparation.md`
- `docs/assertion-and-exception-checklist.md`
- 必要时更新 `docs/ai-prompt-templates.md`

## 9. AI 使用规范

AI 适合做：

- 梳理测试流程。
- 生成用例矩阵。
- 生成 YAML 草稿。
- 生成定位建议。
- 补充页面断言和异常场景。
- 根据日志、截图、trace 进行失败分析。
- 编写执行说明和复盘材料。

AI 不允许直接决定：

- 资金金额、余额展示、费率、账务口径。
- KYC 状态机和审批规则。
- 账号权限和数据可见范围。
- 历史数据清理、补偿和迁移策略。
- 生产环境执行策略。
- DB 写操作。

所有 AI 输出必须人工复核后才能进入用例库。

## 10. 安全与脱敏要求

对外提交、演示或分享前必须检查：

- `.env*` 不提交、不展示。
- 报告、截图、trace、视频中不出现真实账号、手机号、邮箱、证件号、客户名称、token、生产域名。
- 上传附件使用虚拟素材。
- 不面向生产环境执行自动化回归。
- DB 使用只读账号，只允许只读 SQL。
- AI 分析材料中不粘贴客户隐私和生产密钥。

## 11. 常见问题

| 问题 | 检查命令 | 处理方式 |
| --- | --- | --- |
| 端口被占用 | `pnpm dev:stop` | 停止本地 API/Web 端口后重启。 |
| YAML 格式错误 | `pnpm dwt validate <caseId>` | 按错误字段修正 YAML。 |
| 环境变量缺失 | `pnpm dwt preflight <caseId> --env=local` | 在 `.env` 或 CI Secret 中补齐变量。 |
| 页面元素找不到 | 查看截图和 trace | 优先补 `data-testid`，再更新 `cases/location/`。 |
| 接口成功但页面断言失败 | 查看 report 和 trace | 增加等待条件，确认页面刷新逻辑或断言文案。 |
| 上传附件失败 | `pnpm dwt preflight <caseId> --env=local` | 确认附件存在且路径为项目相对路径。 |
| KYC 数据重复 | 查看测试数据准备文档 | 使用 `${timestamp}` 或准备可回收数据池。 |
| 生产环境被拦截 | 检查 `--env` 和登录 URL | 切换到 local/dev/sit 测试环境。 |

## 12. 评审演示脚本

建议演示控制在 5-8 分钟：

1. 说明业务痛点：钱包部门测试人力有限，核心流程每次发版都要重复人工回归。
2. 展示用例矩阵：打开 `docs/dowalet-regression-case-matrix.md`，说明 P0/P1 覆盖情况。
3. 展示 YAML：打开 `cases/scenario/login.user.yaml` 或 `cases/scenario/kyc.submit-and-approve.yaml`，说明业务流程没有写死在 Playwright spec 里。
4. 执行预检：运行 `pnpm dwt preflight login_user --env=local`。
5. 执行用例：运行 `pnpm dwt run login_user --env=local --headed`，展示真实浏览器操作。
6. 展示报告：打开 `reports/`、`screenshots/`、`traces/`，说明失败可复现、可定位。
7. 展示 AI 沉淀：打开 `docs/ai-prompt-templates.md`，说明如何继续生成新用例和失败分析。
8. 总结价值：重复回归自动化，减少 50% 以上人工回归时间，降低对新增测试人力的依赖，让研发和业务把时间投入更高价值工作。
