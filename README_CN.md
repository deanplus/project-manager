# Project Manager

[English](README.md)

`project-mgr` 是一个本地优先、只追加的项目状态账本。它把项目进展、阻塞、决策和下一步保存为带时间的状态快照，让个人或 AI Agent 能快速查询每个项目的当前状态、完整历史以及某个时间点的状态。

首版提供本地 CLI、SQLite 和可选的 Agent Skill，不包含 HTTP API 或常驻服务。数据默认保存在本机，无需账号或云服务。

## 从 npm 运行

需要 Node.js 22+。

无需安装即可运行：

```bash
npx --yes --package project-mgr pmgr current
```

也可以全局安装 CLI：

```bash
npm install --global project-mgr
pmgr current
```

无论在哪个目录执行 `pmgr`，数据库都默认位于 `~/.local/share/project-mgr/project-mgr.sqlite`。CLI 会根据当前用户的主目录将其解析为绝对路径，并自动创建父目录。

通过 `PMGR_DB_PATH` 指定其他位置：

```bash
PMGR_DB_PATH=/absolute/path/projects.sqlite npx --yes --package project-mgr pmgr current
```

## 安装 Agent Skill

仓库包含 `project-mgr` Skill，在 Skill 选择器中显示为 **project-mgr**。它用于指导兼容 Skills 的 AI Agent 新增、导入、查询和导出本地项目状态历史。通过 [skills CLI](https://skills.sh/docs/cli) 安装：

```bash
npx skills add deanplus/project-manager
```

安装器会检测支持的 Agent，并询问安装目标。无需单独安装 `project-mgr`：该 Skill 会通过 `npx` 运行 CLI。安装后重启或重新加载所选 Agent。

### 调用 Skill

在 Codex 的提示词中直接写 `$project-mgr`。也可以输入 `/pro`，然后在选择器中选择 **project-mgr**。其他 Agent 请使用其显式 Skill 语法，或从 Skills 菜单选择 `project-mgr`。

Skill 名称后直接使用自然语言即可，Agent 会把请求转换成 CLI 命令。例如：

```text
使用 $project-mgr 查询 project-mgr 的当前状态和最近 10 条更新。

使用 $project-mgr 记录 project-mgr 的状态：active；已发布 Agent Skill；
下一步收集用户反馈。

使用 $project-mgr 批量记录状态：api 因认证问题 blocked；web 为 active，
dashboard 已完成。

使用 $project-mgr 和 PMGR_DB_PATH=/tmp/project-mgr-test.sqlite 添加一条测试状态，
然后查询其历史。
```

Agent 应在写入前先查询；如果缺少项目名、状态或摘要等必填信息，它会向用户确认。

该 Skill 与 CLI 使用相同的 `PMGR_DB_PATH` 规则：默认使用 `~/.local/share/project-mgr/project-mgr.sqlite`；如需使用其他账本，请设置绝对路径。手工或探索性操作请使用独立数据库，例如 `PMGR_DB_PATH=/tmp/project-mgr-skill-test.sqlite`，避免写入默认账本。

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

## CLI 帮助与版本

```bash
pmgr                    # 显示通用帮助
pmgr -h                 # 也可使用 --help 或 help
pmgr add --help          # 命令用法与可用选项
pmgr help history       # 等价于 history -h
pmgr -v                 # 也可使用 -V、--version 或 version
```

帮助与版本命令会成功退出，且不会打开或创建数据库。版本输出来自已安装包的元数据。也支持兼容形式 `pmgr status <command> --help`。

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

# 查询全部项目的近期历史。
pnpm start history --limit 20 --json

pnpm start at \
  --project project-mgr \
  --at 2026-08-03T12:00:00+08:00 \
  --json
```

## 状态写入

`add` 必需参数：

- `--project`：唯一的项目名称。可包含英文字母、数字、`.`、`_` 和 `-`，且必须以字母或数字开头。
- `--summary`：本次动态的摘要。

可选参数：

- `--status`：`idea`、`planned`、`active`、`blocked`、`paused`、`completed`、`archived` 之一（`done` 可作为 `completed` 的别名）。若省略则默认值为 `completed`。它表示项目状态：`current.status` 取最新快照，open 待办不会让项目保持 `active`。阶段性完成写在 `--summary`/`--progress`，项目仍有工作时保持 `active`。

- `--description`：项目简介/描述（更新项目元数据）。
- `--notes`：中长期项目备注（如架构约束、长期备忘、关键限制等；更新项目元数据）。
- `--progress`：已完成的工作、证据，以及观察/复核的上下文（主题、判定 gate、下次复核时间、哪些未验证）。
- `--blocker`、`--next`、`--decision`、`--tag`：可以重复传入。`--next` 只写具体行动，见[行动项与观察项](#行动项与观察项)。
- `--at`：状态实际发生时间，必须是带时区的 ISO 8601 时间；缺省为当前时间。
- `--source`：`human`、`agent` 或 `import`；缺省为 `human`。
- `--external-ref`：全局幂等键。重复写入同一项目时返回原记录；若被其他项目占用则报错。
- `--json`：输出稳定 JSON。

### 项目元数据与模糊查询

可通过 `set-project` 设置或更新项目的名称、简介与备注，或使用 `--clear-description` / `--clear-notes` 清空：

```bash
pnpm start set-project \
  --project project-mgr \
  --display-name "Project Manager" \
  --description "本地优先、只追加的项目状态账本" \
  --notes "核心 CLI 与 Agent Skill 已上线"

# 清空简介或备注
pnpm start set-project --project project-mgr --clear-description --clear-notes
```

可通过 `projects`（或 `list`）列出所有项目或使用 `--query` 进行模糊匹配搜索（匹配项目名称 slug、显示名称、简介、备注、最新状态摘要及标签）：

```bash
pnpm start projects
pnpm start list --query "账本"
pnpm start projects --query "mvp" --json
```

## 批量导入

`import` 接受一个 JSON 对象、JSON 数组，或每行一个对象的 JSONL 文件。所有记录先校验，再在同一个 SQLite 事务中写入；任一记录失败时整批回滚。下面的示例是旧格式条目：字符串 `nextSteps` 会保留，且不会创建待办。用 `add` 写入的新快照会改为存储 `nextTodoUids`。

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

## 本地 Web 画布 (Web Server)

启动本地 HTTP 服务器，在浏览器中可视化查看项目概览与项目动态（Timeline 演进）：

```bash
pmgr serve
```

默认情况下，`pmgr serve` 监听 `http://127.0.0.1:3000` 并自动在默认浏览器中打开页面。

可选项：

- `--port`：HTTP 服务器端口（默认 `3000` 或环境变量 `PORT`）。
- `--host`：绑定主机地址（默认 `127.0.0.1`）。
- `--no-open`：禁止自动打开浏览器。
- `--json`：以 JSON 格式输出服务器启动信息。

### REST API 接口

服务器同时暴露以下 JSON API 接口：

- `GET /api/projects`：列出项目概览（支持 `?query=...` 检索）。
- `GET /api/projects/:slug`：查看指定项目的元数据与最新状态。
- `GET /api/history`：查看全量或指定项目的状态动态演进（支持 `?project=...`, `?since=...`, `?until=...`, `?limit=...`, `?offset=...`）。
- `GET /api/stats`：查看整体统计指标（项目总数、不同状态分布、动态总条数）。

## 查询与导出

| 命令          | 用途                                      | 主要选项                                                                                                    |
| ------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `projects`    | 列出所有项目或按关键词模糊匹配搜索项目    | `--query`、`--json`                                                                                         |
| `set-project` | 设置/更新/清空项目的显示名称、简介与备注  | `--project`、`--display-name`、`--description`、`--notes`、`--clear-description`、`--clear-notes`、`--json` |
| `current`     | 所有项目或单项目的当前状态                | `--project`、`--json`                                                                                       |
| `history`     | 全部或单个项目的历史，最新记录在前        | `--project`、`--since`、`--until`、`--limit`、`--offset`、`--json`                                          |
| `at`          | 指定时间点及之前的最后状态                | `--project`、`--at`、`--json`                                                                               |
| `export`      | 导出全部或单项目记录                      | `--project`、`--format json\|jsonl`                                                                         |
| `serve`       | 启动本地 HTTP 服务器与 Web 动态可视化画布 | `--port`、`--host`、`--open`、`--no-open`、`--json`                                                         |

全部 action 仍可使用 `status <action>` 的兼容形式，例如 `pmgr status projects`。人类可读的多条结果按项目及其最新状态输出；为空时输出 `No entries found.` 或 `No projects found.`。`add`、`import`、`current`、`projects`、`list`、`set-project`、`history`、`at`、`serve` 支持 `--json`；`export` 由 `--format` 控制格式。

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

## 补全更早的动态

项目状态和动态是否完成是两回事。关联条目前，先查看 `pmgr history --project demo --json`。`status` 是原始快照；`effectiveStatus` 计入显式的后续完成；`isCurrent` 标识该项目的最新快照。缺少 `completedBy` 并不表示这条动态尚未完成。

```bash
# 一次更新可完成多条更早的记录（本地数字 ID 或可移植 UUID）。
pmgr add --project demo --status active --summary "部署已验收" \
  --completes 12 --completes 15 --source agent --json
# 关联一条已有的后续记录，或不删除历史地纠正错误关联。
pmgr complete --entry 12 --by 18 --source agent --json
pmgr revoke-completion --entry 12 --by 18 --reason "验收仍未完成" --source agent --json
```

只关联那些全部未完成工作（包括阻塞和下一步）都已解决的条目。同一项目内的关联要求后续记录的发生时间严格更晚；发生时间相同的关联会被拒绝。每个目标只能有一个有效的完成来源。重复同一关联是空操作；要替换时需先撤销。`add --completes` 会原子写入快照、元数据和关联。已有历史不会自动对账。

动态卡片会显示已完成，并链到后续动态；原始详情保留在可展开的「原始记录」中。「当前状态」和「已有后续更新」只表示快照新旧，与是否完成相互独立。`/api/entries/<id-or-uid>` 和 `/?entry=<uid>` 即使不在初始动态页，也能打开一条记录。日期筛选选择的是快照；完成标注反映的是当前结果。`at` 仍然返回不含完成信息的历史项目快照；按历史时点查询完成状态暂不支持。

导出现在会输出 version 2 包 `{ "version": 2, "entries": [...], "completions": [...] }`。JSONL 每行输出一个完整包。条目保留 UUID 和记录时间；事件保留 UUID，以及每个目标的前驱链接（含撤销）。导入同时接受旧版条目对象、数组、JSONL 和 version 2 包，会检查身份冲突，并按文件原子应用。重复导入同一包是幂等的。事件顺序有意义：须按导出顺序导入；历史不一致时导入失败，不会静默合并。旧客户端无法导入 version 2 包。迁移会给已有快照补上 UUID，不改变其内容。

各自独立迁移的旧数据副本会得到不同的 UUID。跨库导入可能因已存在的 `externalRef` 失败，不会隐式沿用对方身份。要忠实迁移，请把包恢复到一个全新数据库。省略 UUID 的旧写入会被拒绝。若 `externalRef` 已存在，`add` 会保留原快照，并把显式传入的 `--completes` 关联应用到该快照；相同且仍然有效的关联是空操作。事后补关联请使用 `complete`，让对账显式发生。

### 待办与仪表板操作

待办是具体工作的来源。新的状态快照按顺序存储 `nextTodoUids`，不再把下一步原文写入快照。
CLI `add` 现在默认沿用仍处于 open 的钉住项：不带下一步的 `add` 不再清空它们，`--next` 会追加新工作。
去掉首尾空白后，标题与该项目已有的 open 待办（或已钉在该项目上的未归属待办）完全一致（区分大小写）时，会复用那个待办：优先已钉住的，其次最早创建的。来源信息保持不变。
同一次写入里重复的新标题仍会各自创建待办。要显式钉住已有 UID，请传 `--next-todo`。
不要把 `--next` 和 `--next-todo` 写在同一次 `add` 里。同一列表里的重复 UID 会被拒绝。

```sh
pmgr add --project demo --status active --summary "已排队复查" \
  --next "收集日志" --next "写说明" --source agent --json
pmgr todo-add --title "未归属的想法" --json
pmgr add --project demo --status active --summary "钉住这个想法" \
  --next-todo <todo-uuid> --source agent --json
pmgr next --project demo --json
pmgr todo-update --uid <todo-uuid> --status completed --json
pmgr todo-update --uid <todo-uuid> --status cancelled --json
```

每日清单统一使用 `pmgr next --json`（也可写作 `pmgr status next`），不要手动拼接 `nextSteps`、`nextTodos` 和 `todos`。
`--done-todo <uid>` 和 `--cancel-todo <uid>` 可重复，并与快照在同一事务中执行。未钉住的工作仍会作为积压项显示。系统不会按时间或相似度自动取消任何待办。

#### 行动项与观察项

待办是具体工作。写 `--next` 前先问：“如果现在有人有空，能马上开始并靠干活把它做完吗？”

| 类型     | 判断                               | 写到哪里                                                                         |
| -------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| 行动     | 能                                 | `--next`（待办）                                                                 |
| 定时行动 | 能，但在确定时间做                 | `--next`，把时间写进标题                                                         |
| 观察     | 不能，要等样本、外部事件或时间窗口 | 仓库 `todo.md`（判定 gate、证据）；有复核时间时用定时任务；`--progress` 中提一句 |
| 免责说明 | 不是工作（如“本轮未验证”）         | 只写 `--progress`                                                                |

`--blocker` 只写阻止某个行动的事。不要用 `--next` 复述本次快照自己已完成的事。每一项只归一处：

| 位置           | 负责                                                      |
| -------------- | --------------------------------------------------------- |
| 仓库 `todo.md` | 仓库的详细积压和观察项：判定 gate、证据、验收标准         |
| 定时任务       | 何时复核                                                  |
| project-mgr    | 项目当前行动：短标题，钉住约 5 条以内，链接到详情而不复制 |

#### 每次 add 前对账

1. 运行 `pmgr next --project P --json`。
2. 对每个要写的行动，把同主题的 open 项列为候选：**重复**（同一交付物或同一次事项）保留原 UID；**被取代**（日期、决定或范围变了）在同一次 `add` 里用 `--cancel-todo` 退役，并在 `--progress` 写明依据；同主题下**相互独立**的行动保持 open。
3. 只对账本次写入涉及的事项；其他疑似重复或观察项只报告，不关闭。
4. 写入后再运行 `pmgr next --project P --json`：保留或新增的 open 事项各出现一次，已完成或已取消的 UID 不再出现；需要时用 `pmgr todos --project P --json` 核对最终状态。

| 场景                         | 命令                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 保留已钉住的项               | 什么都不做，carry 模式会沿用                                                                                                                 |
| 钉住已有的未钉住项，无新工作 | `add --next-todo <uid>`                                                                                                                      |
| 只有新行动                   | `add --next "<标题>"`；核对返回的 UID                                                                                                        |
| 保留或钉住已有项，同时加新项 | 每个新行动先 `todo-add --project P --title "<新>" --json`（记下 UID），再一次 `add --next-todo <已有> --next-todo <新> [--cancel-todo <旧>]` |

最后一种写法是多条命令而不是一个事务，且 `add` 先提交再输出结果。任何一步失败或结果不明时，先读回 `current`、`todos` 和完整历史（`history --limit 100 --offset <n>` 翻页到不满一页为止，不用 `--since`），再决定重试或清理。最终快照已存在就保留全部新建待办；否则只取消或复用 UID 来自本次 `todo-add` 输出、且从未被任何快照引用过的待办。状态读不到或 UID 没记下时不做改动并报告。观察类待办只有在它带的每个 gate 都已记录到归属位置、承诺的复核已有验证过的定时任务时，才能退役。逐步说明见 [Agent Skill](skills/project-mgr/SKILL.md)。

`--replace-next` 恢复替换语义：不带下一步时取消全部钉住，带下一步时只钉住这些 UID。它不会关闭待办。
领域层 `addStatus` 默认仍是 `nextMode: "replace"`；CLI `add` 除非带 `--replace-next`，否则传 `"carry"`。导入仍保持严格校验。
已知限制：领域 API 用固定 UID 重新钉住一个已沿用的待办时，原样重试会报 `conflicting entry uid`。CLI 不传固定 UID，`--external-ref` 重放不受影响。

旧快照保留字符串 `nextSteps`，并省略 `nextTodoUids`，直到显式转换。
只要还有来源下标未转换，沿用模式的 `add`（以及完成活动时的后续快照）会复制完整字符串列表和 `nextStepsSourceUid`；此时要写入新的下一步，需先转换或使用 `--replace-next`。
转换是幂等的，不会追加快照：

```sh
pmgr todo-convert --entry <id-or-uid> --index 0 --json
pmgr todo-convert --project demo --json
# 对所有当前旧快照做显式转换前，先备份；仅在用户要求时执行。
pmgr export --format json > backup.json
pmgr todo-convert --all --json
```

每个下标都已有待办之后，下一次沿用模式的 `add` 会按原下标顺序写入引用，并过滤掉已关闭的待办。历史快照保持不变。
`next` 会合并已转换的待办和未转换的字符串，不会重复。

`current --json` 为每个项目增加实时的 `openWork` 清单；存储的 `nextSteps`、`nextTodoUids` 以及实时的 `nextTodos` 含义不变，仍包含已关闭的钉住项。
文本模式的 `current` 会列出未完成工作，并用 `[pinned]` 标出钉住项。
`history`、`at` 和 `getEntry` 不带 `openWork`；`history` 文本输出和完成活动的后续快照复制规则不变。
`at` 返回当时存储的快照，不附加实时待办状态。

快照只能引用未归属的待办，或已经属于该项目的待办。
待办一旦出现在任意 `nextTodoUids` 中，或关联了来源动态，就不能再改项目。
从当前快照拿掉引用，也不会解除这个限制。

带引用的导出使用 version 4，并包含被引用的待办。
没有引用、但有待办的导出仍是 version 3。
version 2 和旧版导入不会凭空创建待办。
悬空、重复、混用或跨项目引用会使整批导入失败。
仪表板写入仍只接受同源的 localhost JSON 请求。
动态卡片上的 **标为已完成** 会追加一条后续动态，既不完成项目，也不完成待办。
在仪表板里新增待办不会把它钉进当前下一步；钉住需要再写一条快照。
