# Project Manager

[English](README.md)

`project-mgr` 是一个本地优先、只追加的项目状态账本。它把项目进展、阻塞、决策和下一步保存为带时间的状态快照，让个人或 AI Agent 能快速查询每个项目的当前状态、完整历史以及某个时间点的状态。

首版只提供本地 CLI 和 SQLite，不包含 HTTP API、常驻服务或 Agent Skills。数据默认保存在本机，无需账号或云服务。

## 从 npm 运行

需要 Node.js 22+。

无需安装即可运行：

```bash
npx --yes project-mgr current
```

也可以全局安装 CLI：

```bash
npm install --global project-mgr
pmgr current
```

无论在哪个目录执行 `pmgr`，数据库都默认位于 `~/.local/share/project-mgr/project-mgr.sqlite`。CLI 会根据当前用户的主目录将其解析为绝对路径，并自动创建父目录。

通过 `PMGR_DB_PATH` 指定其他位置：

```bash
PMGR_DB_PATH=/absolute/path/projects.sqlite npx --yes project-mgr current
```

## 从源码构建

需要 Node.js 22+ 和 pnpm 10.30.2。

```bash
pnpm install --frozen-lockfile
cp .env_sample .env
pnpm build
```

`.env_sample` 提供全部环境配置示例；复制得到的 `.env` 已被 Git 忽略。`pnpm start` 和 `pnpm pmgr` 会自动读取项目根目录下的 `.env`，已有的 shell 环境变量优先级更高。

构建后通过以下方式运行：

```bash
pnpm start current
```

开发时也可以直接运行 TypeScript：

```bash
pnpm pmgr current
```

默认数据库路径是：

```text
~/.local/share/project-mgr/project-mgr.sqlite
```

`.env_sample` 中的 `PMGR_DB_PATH` 是可选配置。可以在 `.env` 中指定其他位置，也可以为单条命令临时覆盖：

```bash
PMGR_DB_PATH=/absolute/path/projects.sqlite pnpm start current
```

在 `.env` 中应填写字面量绝对路径；`.env` 文件不会展开 `~` 或 `$HOME`。数据库会在第一次执行有效命令时自动创建。

### 使用独立测试数据库

手工测试时，建议在 `.env` 中固定设置一个与正式数据分离的路径：

```dotenv
PMGR_DB_PATH=/tmp/project-mgr-manual-test.sqlite
```

随后正常执行命令：

```bash
pnpm start add \
  --project test-project \
  --status active \
  --summary "测试独立数据库"

pnpm start history --project test-project
```

项目键必须完全一致：写入 `test-project` 的记录不会出现在 `project-mgr` 的历史中。人类可读的空列表查询会输出 `No entries found.`；使用 `--json` 时则输出 `[]`。

不需要保留时，可以删除 `/tmp/project-mgr-manual-test.sqlite`。

自动化测试会使用内存数据库或系统临时目录中的 SQLite 文件，不会读写默认数据库。`PMGR_DB_PATH=:memory:` 也可用于单条命令，但每个 CLI 命令都是独立进程，命令结束后数据就会消失，不适合连续手工测试。

## 快速开始

追加一条项目状态：

```bash
pnpm start add \
  --project project-mgr \
  --status active \
  --summary "本地状态账本已可用" \
  --progress "完成 SQLite 与 CLI" \
  --next "接入真实项目" \
  --tag mvp
```

查询所有项目或单个项目的当前状态：

```bash
pnpm start current
pnpm start current --project project-mgr --json
```

查询历史与指定时间点状态：

```bash
pnpm start history \
  --project project-mgr \
  --since 2026-08-01T00:00:00Z \
  --limit 20 \
  --offset 0

pnpm start at \
  --project project-mgr \
  --at 2026-08-03T12:00:00+08:00 \
  --json
```

## 状态写入

`add` 必须提供：

- `--project`：项目唯一名称，只能使用英文字母、数字、`.`、`_`、`-`，并以字母或数字开头。
- `--status`：`idea`、`planned`、`active`、`blocked`、`paused`、`completed` 或 `archived`。
- `--summary`：本次状态摘要。

可选参数：

- `--progress`：已经完成的工作。
- `--blocker`、`--next`、`--decision`、`--tag`：可以重复传入。
- `--at`：状态实际发生时间，必须是带时区的 ISO 8601 时间；缺省为当前时间。
- `--source`：`human`、`agent` 或 `import`；缺省为 `human`。
- `--external-ref`：全局幂等键。重复写入同一项目时返回原记录；若被其他项目占用则报错。
- `--json`：输出稳定 JSON。

## 批量导入

`import` 接受一个 JSON 对象、JSON 数组，或每行一个对象的 JSONL 文件。所有记录先校验，再在同一个 SQLite 事务中写入；任一记录失败时整批回滚。

```json
{
  "project": "project-mgr",
  "status": "active",
  "summary": "核心功能实现完成",
  "progress": "CLI 与 SQLite 已通过测试",
  "blockers": [],
  "nextSteps": ["接入真实项目"],
  "decisions": ["首版只做本地 CLI"],
  "tags": ["mvp"],
  "occurredAt": "2026-08-03T12:00:00+08:00",
  "source": "human",
  "externalRef": "project-mgr-2026-08-03-core"
}
```

```bash
pnpm start import statuses.jsonl
# 等价写法
pnpm start import --file statuses.jsonl --json
```

未知字段、未知 CLI 参数、多余位置参数、非法状态和无时区时间都会被拒绝。

## 查询与导出

| 命令      | 用途                       | 主要选项                                                           |
| --------- | -------------------------- | ------------------------------------------------------------------ |
| `current` | 所有项目或单项目的当前状态 | `--project`、`--json`                                              |
| `history` | 单项目历史，最新记录在前   | `--project`、`--since`、`--until`、`--limit`、`--offset`、`--json` |
| `at`      | 指定时间点及之前的最后状态 | `--project`、`--at`、`--json`                                      |
| `export`  | 导出全部或单项目记录       | `--project`、`--format json\|jsonl`                                |

全部六个 action 仍可使用 `status <action>` 的兼容形式，例如 `pmgr status export`。人类可读的多条结果按“项目、状态、发生时间、摘要”输出；为空时输出 `No entries found.`。`add`、`import`、`current`、`history`、`at` 支持 `--json`；`export` 由 `--format` 控制格式。

导出内容不包含数据库内部的 `id` 和 `recordedAt`，可以直接重新导入。记录按时间从旧到新导出，从而在恢复时保留相同时间戳记录的先后关系：

```bash
pnpm start export --format jsonl > project-statuses.jsonl

PMGR_DB_PATH=/tmp/project-mgr-restored.sqlite \
  pnpm start import project-statuses.jsonl
```

## 开发与验证

```bash
pnpm typecheck
pnpm lint
pnpm format-check
pnpm test
pnpm coverage
pnpm build
```

Statements、branches、functions、lines 的覆盖率门槛均为 100%。详细设计见[架构文档](docs/architecture.md)。
