# 多办公室(Multi-Office)设计稿

> 目标:**同一个项目目录下可并行开多个独立办公室**(各自独立 config + bus/端口 + roster + 消息 + leadstate + /office 页面)。默认办公室(不填名)**沿用旧路径,老项目零改动、完全向后兼容**。
>
> 状态:boss 已拍板 UX(办公室名 + 裸 `falinks` 交互选择)。本稿为实现契约。

## 1. 根因(现状)

falinks 现在是「一个目录 = 一个办公室」单例:
- config 固定读 `<cwd>/falinks.config.json`(`src/cli.ts:35`)。
- 运行态全部以 `sha1(realpath(cwd)).slice(0,16)` 为 key,落在 `~/.falinks/`:
  - 实例文件 `~/.falinks/runtime/<key>.json`(`src/runtime.ts:36-42`)
  - 会话 `~/.falinks/sessions/<key>-<agent>.json`
  - 消息记录 `~/.falinks/messages/<key>.jsonl`
  - leadstate `~/.falinks/leadstate/<key>.md`
- 同目录二次启动被 `src/index.ts:305` 的双启动检查直接挡掉。

→ 不止 config 撞,是**整套生命周期按目录单例**。

## 2. 核心概念:office id

- **office id**:短名,正则 `^[a-z0-9][a-z0-9._-]{0,31}$`(ascii,长度 1–32,不含路径分隔符 / `..`)。**只允许小写**(正则即小写-only,大写一律拒绝)。
- **保留名 `default`**:即「不填名的默认办公室」。`--office default` 一律**拒绝**并提示「默认办公室不用 --office,直接 `falinks` / `falinks up`」。内部默认 office id 记作常量 `DEFAULT_OFFICE`。
  - ⚠ 分工:`isValidOfficeName` 是**纯正则**校验,`'default'` 字符合法 → 返回 `true`;**保留名拦截只在 `assertOfficeName`**(对 `'default'` throw)。调用用户输入处一律走 `assertOfficeName`,别误以为 `isValidOfficeName` 会拦 `default`。
- 非法名 → 明确报错(列出允许字符)。

## 3. 数据布局

### 3.1 config 路径(`resolveConfigPath(cwd, office)`)
- 默认办公室:`<cwd>/falinks.config.json`(**不变**)。
- 具名办公室:`<cwd>/.falinks/<name>.config.json`。
- `.falinks/` 目录在首次创建具名办公室时自动建。
- **不**自动写 .gitignore:config 是团队定义,是否提交交用户(与现有 `falinks.config.json` 一致)。

### 3.2 运行态 key(`keyFor(cwd, office)`)
```
base = sha1(realpath(cwd)).slice(0,16)
key  = office === DEFAULT_OFFICE ? base : `${base}--${office}`
```
应用到全部四类文件,默认办公室得到**与旧版逐字节相同**的路径(故无需迁移):
- `~/.falinks/runtime/<key>.json`
- `~/.falinks/sessions/<key>-<agent>.json`
- `~/.falinks/messages/<key>.jsonl`
- `~/.falinks/leadstate/<key>.md`
- `~/.falinks/todos/<key>.json`(走 `keyFor`,默认逐字节兼容)
- `~/.falinks/diag/<base>.jsonl`(diag 用自身 `sha1(原始 cwd)` base + officeSuffix,同 message-log)

> ⚠ 三处现状必须**原样保留**(否则破坏零迁移,qa 已按实际代码锚定基线):
> 1. **leadstate 扩展名是 `.md`**(非 `.txt`)。
> 2. **message-log 与 diag 的 base 哈希用 `sha1(原始 cwd)`(未过 realpath)**,与其余(runtime/sessions/leadstate/todos 走 `sha1(realpath(cwd))` = `keyFor`)不同。这两类 office 化只在其自身 base 上追加 officeSuffix,**不并入 `keyFor`**。实跑中 index 传的是已 realpath 的 cwd,二者同值;但单测基准要分开锚。

> 实现要求:`src/runtime.ts` / `src/session/store.ts` / `src/message-log.ts` / `src/leadstate-store.ts` 现有取 key/路径的函数统一**新增 office 形参(默认 = DEFAULT_OFFICE)**,默认值保证旧调用点行为不变。

## 4. CLI 形态

- `falinks up [--office <name>]`
  - 带 `--office`:config = `.falinks/<name>.config.json`;不存在则走建队向导写到该路径再启动。
  - 不带:`falinks.config.json`(旧行为)。
- `falinks console [--office <name>] [--port N]`:`--office` 解析 (cwd, office) 的实例端口;`--port` 优先。
- 其余任何「启动/连接/停止」类子命令统一接受 `--office <name>`(backend 落地时清点 `src/cli.ts` 全部子命令)。
- **裸 `falinks`(TTY)**:
  1. 枚举本项目办公室 = 默认(若 `falinks.config.json` 存在)+ 每个 `.falinks/*.config.json`;各自标注**运行中 / 已停**(查实例文件存活)。
  2. 列表让用户:选已有(运行中→连其控制台;已停→启动它)或「＋ 新建办公室」(问名字→向导→启动)。
  3. 若一个都没有 → 旧行为(向导建默认办公室)。
  - **非 TTY**:行为不变(默认办公室),不弹交互。

## 5. 生命周期改动

- **双启动检查**(`src/index.ts:305`):按 (cwd, office) 判定。同一办公室在跑→挡;**不同办公室同目录→放行**(各自独立端口与实例文件)。
- `writeInstance` / `removeInstanceIfOwner`(`src/runtime.ts`)带 office。
- **bus identity** 增加 `office` 字段;`/admin/info` 返回它(`src/bus/server.ts:203-229`)。console 连上后校验 office 匹配,不匹配则报错。
- 端口:仍 `cfg.busPort ?? 0` 自动分配 + 占用回退;**多办公室天然不同进程不同端口**,无需额外协调。

## 6. 发现(discovery)

- `resolveBus(cwd, office)`(`src/discovery.ts:50`):读 (cwd, office) 的实例文件并探活。
- 「借用全局唯一存活实例」的旧兼容仅对**默认办公室**保留(`falinks console` 无 --office 时);具名办公室必须 (cwd, office) 命中,不借用。
- 因为「无 --office = 默认办公室」是确定的,不存在歧义,无需新增「多实例选哪个」报错。

## 7. /office 页面(frontend,小改,核心落地后)

- `/office/state` 增加 `office` 字段(取自 bus identity)。
- 非默认办公室时页眉/标题显示办公室名:`falinks · 像素办公室 · <office>`;默认办公室不显示后缀(零变化)。
- 各办公室 bus 各自端口、各自 /office,本就隔离。

## 8. 向后兼容 / 迁移

- **无迁移**:默认办公室路径逐字节不变;`falinks` / `falinks up` 旧用法行为完全一致。
- `.falinks/` 仅在首次建具名办公室时出现。

## 9. 验收要点(qa)

- `keyFor`:默认→无后缀(== 旧 key);具名→ `--<office>` 后缀;两办公室 key/路径互不相同。
- `resolveConfigPath`:默认 `falinks.config.json` vs 具名 `.falinks/<n>.config.json`。
- office 名校验:拒 `/`、`..`、空、>32、`default`、非法字符;接受合法名。
- 双启动:同 (cwd,office) 挡;不同 office 同目录放行(用实例文件模拟)。
- discovery:`resolveBus(cwd,office)` 命中正确实例;默认办公室借用兼容仍在。
- `listOffices(cwd)`:枚举默认 + `.falinks/*.config.json`,带运行/停止标注。
- 回归:默认办公室全流程与旧版一致(路径/行为)。

## 10. 任务切分

- **backend(主线)**:§2–§6 全部(office 助手 + runtime/session/message-log/leadstate 加 office 形参 + cli `--office` 与裸交互选择 + index up() 流程 + discovery + bus identity)。作为一个内聚改动。
- **qa**:§9 测试(可依本稿先起草,backend 落地后跑通)。
- **frontend**:§7(核心落地后,低优先)。
- **ux/lead**:文档(OFFICE.md 多办公室章节 + README + help 文案)。

---

## 附录 A:CLI 文案串(ux 草拟,待 lead 过目;backend 落地直接用,key 名占位)

> 选项名暂用 `--office`(以 backend 落地为准,变了改这里);`<x>`/`<name>`/`<名字>` 为占位。中英口吻与现有 `falinks` 文案一致(简洁、命令用反引号)。

### A1. `--office` help 文本(up/console 及其它接受该选项的子命令通用)
| key | en | zh |
|---|---|---|
| `optOffice` | `--office <name>   Target a named office (config: .falinks/<name>.config.json). Omit for the default office.` | `--office <名字>   指定具名办公室(配置:.falinks/<名字>.config.json);不填即默认办公室。` |

### A2. 裸 `falinks` 交互选择
| key | en | zh |
|---|---|---|
| `officePickHeader` | `falinks — pick an office (↑↓ select · Enter confirm)` | `falinks — 选择办公室(↑↓ 选 · Enter 确认)` |
| `officeItemDefaultRunning` | `(default office)  · running — open its console` | `(默认办公室)  · 运行中 — 打开控制台` |
| `officeItemDefaultStopped` | `(default office)  · stopped — start it` | `(默认办公室)  · 已停 — 启动` |
| `officeItemRunning` | `<name>  · running — open its console` | `<名字>  · 运行中 — 打开控制台` |
| `officeItemStopped` | `<name>  · stopped — start it` | `<名字>  · 已停 — 启动` |
| `officeItemNew` | `＋ New office…` | `＋ 新建办公室…` |
| `officeNamePrompt` | `Office name (a-z 0-9 . _ - , 1–32 chars):` | `办公室名字(a-z 0-9 . _ - ,1–32 字符):` |

### A3. 错误提示
| key | en | zh |
|---|---|---|
| `officeNameInvalid` | `Invalid office name "<x>". Use 1–32 chars: lowercase letters, digits, . _ - (no / or ..).` | `办公室名 "<x>" 非法。请用 1–32 个字符:小写字母、数字、. _ -(不能含 / 或 ..)。` |
| `officeNameReserved` | `"default" is reserved. For the default office just run \`falinks\` or \`falinks up\` (no --office).` | `"default" 是保留名。要用默认办公室,直接 \`falinks\` / \`falinks up\`(不要加 --office)。` |
| `officeNotRunning` | `Office "<name>" isn't running in this directory. Start it: \`falinks up --office <name>\`.` | `办公室 "<名字>" 在本目录没有运行。启动它:\`falinks up --office <名字>\`。` |
| `officeConfigNotFound` | `No office "<name>" here (looked for .falinks/<name>.config.json). Create it: \`falinks up --office <name>\`.` | `本目录没有办公室 "<名字>"(找不到 .falinks/<名字>.config.json)。创建:\`falinks up --office <名字>\`。` |

> 一致性约束:zh/en 同义、命令片段一字不差对应;`default` 保留名与命名规则错误提示要和 OFFICE.md「办公室命名规则」一节口径一致。
