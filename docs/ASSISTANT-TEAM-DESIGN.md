# 「组长 + 助理组」预设团队设计稿

> 目标:新增预设团队,组长配 3 个**轻分工助理**(调研员 / 资料梳理 / 草拟汇总)分摊动手活。助理**只执行、不决策**;组长专注决策/拆解/验收,不再自己埋头干。boss 已拍板组成。本稿为实现契约。

## 1. 痛点

调研/前期阶段组长常自己埋头干——现有专职 worker(前端/后端/测试/UX)只接本行活,没人接"通用体力活"(读代码、查资料、跑命令、起草、汇总),组长只能自己上,拖慢节奏。

## 2. 方案概览

- 新增预设团队 **`assisted`**「组长 + 助理组」:1 组长 + 3 助理。
- 把「助理(assistant)」做成**一等标记**(对称于 `lead`):任何 agent 可标 `assistant: true`,获得"执行不决策"的行为 bootstrap。
- 「不决策」三重兜底:① 助理非 lead → 决策类工具(todoplan/todostart/taskdone/taskwait/leadstate)本就组长专属,助理用不了;② 助理 bootstrap 明确"执行不决策、岔路口给组长列选项";③ 默认助理不直接找 boss 要决策,经组长。
- 组长 bootstrap 补一段:有助理就把体力活并行分出去,自己专注决策。

## 3. 预设团队 `assisted`(templates.ts)

| name | role(简述) | lead | assistant |
|---|---|---|---|
| `lead` | 组长,统筹决策:拆解任务、给助理派活、决策与验收,少动手 | ✅ | |
| `调研员`(researcher) | 调研与事实查证:读代码/查资料/跑命令,产出结构化发现 | | ✅ |
| `资料梳理`(curator) | 整理归纳调研产出,结构化成可用资料/清单 | | ✅ |
| `草拟汇总`(drafter) | 据组长意图起草文档/汇总,产出初稿交组长定稿 | | ✅ |

- 全部 `cli: 'claude'`(默认);`cwd` 缺省随项目。
- 名字英文 key 用拼音/英文(researcher/curator/drafter),roster 显示名与 role 走 i18n(中/英)。

## 4. `assistant` 一等标记(对称 lead)

- **AgentConfig**(core/config.ts):加 `assistant?: boolean`。
- **TeamMember**(templates.ts):加 `assistant?: boolean`;`configFromMembers` 把 `member.assistant → agentConfig.assistant`(如同 lead)。
- **AgentRuntime**(core/types.ts):加 `assistant?: boolean`(供 roster/可视化)。
- **校验**(config.ts):`assistant: a.assistant === true`;**`assistant && lead` 互斥 → 报错**。
- 无数量上限。

## 5. bootstrap 组合(index.ts composeBootstrap)

现有顺序:houseRules + identity + roleBootstrap + **coordinatorRules(lead)** + projectState。新增:

- **assistantRules**:当 `agent.assistant === true` 时注入(放在 roleBootstrap 之后,与 coordinatorRules 互斥位置——助理不会是 lead)。
- **coordinator addendum**:当**本团队存在 ≥1 个 assistant** 时,在 coordinatorRules 末尾追加"把体力活分给助理"的话(composeBootstrap 可见 config.agents,判断是否有 assistant)。无助理的团队(如 fullstack)组长不加这段。

### 4.1 文案(中,en 由 ux 出 parity;最终入 i18n zh/en)

**assistantRules(zh)**:
> 你是组长(lead)的助理。职责:执行组长交办的具体活儿——调研、读代码/查资料、跑命令、整理与起草、汇总产出——把结论与成果交回组长。
> 你不做决策:不定方案/架构/优先级,不给其他成员派活,不替组长回答 boss 的决策问题。遇到需要拍板的岔路口,把"可选项 + 各自利弊 + 你的建议"整理清楚发给组长,由组长定夺。
> 需要澄清找组长,不要直接找 boss 要决策。干完向组长汇报并 idle。

**coordinator addendum(zh,仅当有助理)**:
> 本团队配有助理(assistant):把动手的体力活(调研、读取查证、资料梳理、起草、汇总)尽量拆解并行分给助理,你专注决策、设计、任务拆解、验收与对 boss 沟通,别自己埋头干。助理只执行不决策,他们汇报后由你判断定夺。

## 6. 决策/委派机制(无需新代码)

- 派活/汇报走现有 `sendmsg`;助理→组长汇报、组长→助理派活。
- 决策类工具组长专属(bus/server.ts 现有 `router.get(agentName)?.lead` 门禁),助理天然用不了 → 不额外加门禁。
- `ask(to="boss")`:**不硬禁**助理(避免过度约束 + 额外代码),靠 bootstrap 行为约束"经组长、不要直接找 boss 要决策"。boss 后续要收紧可再议。

## 7. /office 可视化(frontend,可选,低优先)

- roster 已含 role;可给 assistant 加个小标识(类似 lead 的皇冠,助理用别的小角标)。**本期可不做**,先上行为;要做再排。

## 8. 验收要点(qa)

- 预设 `assisted` 存在:成员 = lead + 3 助理,flag/role 正确(lead.lead===true、3 个 assistant===true、互不为 lead)。
- `configFromMembers`:assistant 标记正确传到 AgentConfig;lead 仍正确。
- config 校验:`assistant` 取布尔;**`assistant && lead` 同时为真 → 抛错**。
- composeBootstrap:① assistant agent 含 assistantRules、不含 coordinatorRules;② `assisted` 的 lead 含 coordinatorRules **且含 addendum**;③ 无助理团队(fullstack)的 lead **不含** addendum;④ 普通 worker(frontend)不含 assistantRules。
- 决策工具:assistant 调 todoplan/taskdone 等被拒(非 lead),沿用现有门禁(加一条断言即可)。
- i18n:新增 key 的 zh/en parity(role 名 ×3、assistantRules、addendum)。
- 回归:其余预设(solo/pair/fullstack/research)不变。

## 9. 任务切分

- **backend(主线)**:§3 预设 + §4 assistant 标记(config/types/templates/校验/configFromMembers)+ §5 bootstrap(assistantRules + addendum,条件注入)+ i18n key 接线。
- **ux**:assistantRules / addendum / 3 个 role 名 的 zh+en 文案(parity,口吻同现有 bootstrap);先草拟发我过目再交 backend 落地。
- **qa**:§8 测试。
- **frontend**:§7 可选,本期暂不排。

---

## 附录 A:i18n 文案串(ux 草拟,待 lead 过目;backend 接进 src/i18n/zh.ts + en.ts)

> 口吻对齐现有 `houseRules`/`coordinatorRules`/`tpl*Role`(带【】头、祈使、简洁无废话)。key 名沿用现有风格(`coordinatorRules` → `assistantRules`;`tplFullstackLead` → `tplAssistedLead`)。
> **成员 name 建议沿用英文标识符**(`lead`/`researcher`/`curator`/`drafter`,与 @寻址/现有预设一致);**role 走 i18n**。若 boss 要本地化 roster 显示名(调研员…),另见 A4(可选)。

### A1. `assistantRules`(助理行为,`agent.assistant===true` 时注入,位置同 coordinatorRules 互斥位)
| lang | 文案 |
|---|---|
| zh | `【助理工作法】你是组长(lead)的助理。职责:执行组长交办的具体活儿——调研、读代码/查资料、跑命令、整理与起草、汇总产出——把结论与成果交回组长。你不做决策:不定方案/架构/优先级,不给其他成员派活,不替组长回答 boss 的决策问题。遇到需要拍板的岔路口,把「可选项 + 各自利弊 + 你的建议」整理清楚发给组长,由组长定夺。需要澄清找组长,不要直接找 boss 要决策。干完向组长汇报并 idle。` |
| en | `[Assistant playbook] You are the team lead's assistant. Your job: carry out the concrete work the lead hands you — investigation, reading code / looking things up, running commands, organizing & drafting, aggregating output — and hand the conclusions and results back to the lead. You do NOT make decisions: do not settle approach/architecture/priorities, do not assign work to other members, and do not answer the boss's decision questions on the lead's behalf. At any fork that needs a call, write up "the options + each one's pros/cons + your recommendation" and send it to the lead to decide. For clarification go to the lead, not directly to the boss for decisions. When done, report to the lead and idle.` |

### A2. `coordinatorAssistAddendum`(团队存在 ≥1 assistant 时追加到 coordinatorRules 末尾)
| lang | 文案 |
|---|---|
| zh | `【有助理时】本团队配有助理(assistant):把动手的体力活(调研、读取查证、资料梳理、起草、汇总)尽量拆解并行分给助理,你专注决策、设计、任务拆解、验收与对 boss 沟通,别自己埋头干。助理只执行不决策,他们汇报后由你判断定夺。` |
| en | `[When you have assistants] This team has assistants: push the hands-on legwork (investigation, reading & verifying, organizing material, drafting, aggregating) out to them in parallel as much as possible, and focus yourself on decisions, design, task breakdown, review, and communicating with the boss — do not get heads-down doing it yourself. Assistants only execute, not decide; after they report, the call is yours.` |

### A3. `assisted` 预设的队名 + role 描述(`tpl*Role` 风格)
| key | zh | en |
|---|---|---|
| `tplAssistedName` | `组长 + 助理组(调研员+资料梳理+草拟汇总)` | `Lead + assistants (researcher + curator + drafter)` |
| `tplAssistedLead` | `组长,统筹决策:拆解任务、给助理派活、决策与验收,少动手` | `Lead, coordinates and decides: breaks work down, assigns to assistants, decides and reviews — hands-off on the doing` |
| `tplAssistedResearcher` | `调研员,调研与事实查证:读代码/查资料/跑命令,产出结构化发现` | `Researcher, investigation and fact-checking: reads code / looks things up / runs commands, produces structured findings` |
| `tplAssistedCurator` | `资料梳理,把调研产出整理归纳成结构化、可用的资料/清单` | `Curator, organizes research output into structured, usable material/checklists` |
| `tplAssistedDrafter` | `草拟汇总,据组长意图起草文档/汇总,产出初稿交组长定稿` | `Drafter, drafts docs/summaries per the lead's intent and hands first drafts back to the lead for finalizing` |

### A4.(可选)本地化 roster 显示名 —— 仅当 boss 要 roster 显示中文名时启用;默认用英文标识符
| key | zh | en |
|---|---|---|
| `tplAssistedResearcherName` | `调研员` | `researcher` |
| `tplAssistedCuratorName` | `资料梳理` | `curator` |
| `tplAssistedDrafterName` | `草拟汇总` | `drafter` |

> 一致性约束:zh/en 同义;assistantRules 与 coordinatorAssistAddendum 的"只执行不决策 / 经组长不直接找 boss / 列选项+利弊+建议"口径两边一致;role 描述与 §3 表一致。
