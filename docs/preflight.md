# 运行前预检

预检用于在真正执行用例前发现可静态判断的问题，降低跑到一半才失败的概率。

## CLI

```bash
pnpm dwt preflight login_user
pnpm dwt plan cases/scenario/login.user.yaml --env=local
```

CLI 未指定 `--env` 时默认使用 `sit`，并读取 `.env` + `.env.sit`；`local` 读取 `.env` + `.env.local`，其他环境读取 `.env` + `.env.<env>`。如需只使用当前进程环境变量：

```bash
pnpm dwt preflight login_user --env=sit --no-env-file
```

## 服务端接口

```text
GET /api/cases/:caseId/preflight?env=sit
POST /api/cases/preflight
```

`POST /api/cases/preflight` 请求体：

```json
{
  "env": "sit",
  "content": "case_id: example\n..."
}
```

## 检查范围

- DSL 结构是否通过 schema 校验。
- `${env.KEY}` 引用是否在当前环境中存在。
- `locations.file` 是否存在且符合定位文件 schema。
- `step_id` 和 session 是否重复。
- Web 步骤是否缺少 `session`、`target`、`url`、`value`、`expected` 等必填字段。
- target 未在定位文件中定义时给出 warning，保留运行时按文本或选择器兜底定位的能力。
- API 相对 URL 是否能从 `API_BASE_URL` 或 session 登录域名解析。
- `api_assert` 是否配置了足够强的断言。
- DB 步骤是否在 `DB_ENABLED=true` 下运行。
- 上传文件是否存在；变量化文件路径只提示 warning。
- `prod/production` 环境和疑似生产域名会被拦截。

## 页面入口

用例编辑页提供“预检”按钮；点击后会展示可执行状态、步骤统计和错误/警告列表。

点击“执行”时也会自动预检。存在 error 级问题时，页面不会启动运行。
