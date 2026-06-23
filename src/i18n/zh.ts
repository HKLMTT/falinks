/** 中文基准词典:全部用户可见/注入员工的文案都从这里出。纯文本=字符串,带变量=箭头函数。 */
export const zh = {
  clipboardNoImage: '剪贴板里没有图片',
  officeReady: (n: number) => `✅ 办公室就绪：${n} 名员工 + 控制台。Ctrl-C 收工。`,

  // —— console/clipboard.ts ——
  imageToken: (n: number) => `[图片${n}]`,

  // —— console/app.tsx ——
  taglines: [
    '一屋 AI 牛马，您只管动嘴 🐴',
    '活归它们，功归你 🐴',
    '不喊累不要钱的 AI 牛马天团',
    '您发句话，牛马跑断腿',
    'AI 牛马已就位，老板请下令',
    '招了一窝电子牛马',
    '您动嘴，它们秃头',
    '7×24 AI 牛马，永不摸鱼（大概）',
    '老板一句话，牛马忙到趴',
  ] as string[],
  helpStatus: '@名字 私聊 · @all 群发 · 纯文本=回复上次对话目标 · /add 加员工 · /remove 删员工 · /clear [名字] 清空上下文 · /restart 重启员工 · /todo 任务清单 · /lead 选组长 · !消息 插队直送(全角！也行)',
  guardrailBlocked: '被护栏拦截',
  sayUndelivered: (to: string, err: string) => `未送达 ${to}：${err}`,
  sayOk: (to: string) => `→ ${to}`,
  broadcastOk: '→ 全员',
  replyOk: (to: string) => `→ ${to}（回复）`,
  urgentOk: (to: string) => `⚡ → ${to}(直送)`,
  urgentBroadcastOk: '⚡ 已群发(直送)',
  noReplyTarget: '没有上次对话目标，请 @某人 私聊 或 @all 群发',
  addOk: (name: string) => `＋ ${name}`,
  removeOk: (name: string) => `－ ${name}`,
  addFailed: 'add 失败',
  removeFailed: 'remove 失败',
  clearFailed: 'clear 失败',
  restartOk: (n: string) => `已重启 ${n}(等它重新报到)`,
  restartFailed: '重启失败',
  restartBusy: (n: string) => `${n} 正在重启/清空中,稍后再试`,
  // 失联警告行:先按触发规则分流(mute=有活无声),register-timeout 再按"是否连过 MCP"分流两种病因文案。
  unresponsiveWarn: (items: { name: string; mcpSeen: boolean; rule?: string }[]) =>
    '⚠ ' +
    items.map((i) => `${i.name}${i.rule === 'mute' ? '(收到消息却全程零工具调用——会话可能瘫痪,如上下文耗尽)' : i.mcpSeen ? '(MCP 连过但未报到,会话可能瘫痪)' : '(CLI 可能没挂 falinks 工具,手动重启过?)'}`).join('、') +
    (items.some((i) => i.rule === 'mute') ? ' —— 试试 /restart <名字> fresh' : ' —— 试试 /restart <名字> [fresh]'),
  clearAll: '全员',
  clearNone: '无',
  clearJoiner: '、',
  cleared: (name: string, list: string) => `🧹 已清空 ${name}（${list}）`,
  wizardAddOk: (name: string, role: string, path: string) => `＋ ${name}(${role}) @ ${path}`,
  wizardCancelled: '已取消添加',
  attached: (token: string) => `📎 已附加 ${token}，加 @员工 后回车，员工会去读这张图`,
  answeredOk: (from: string, picked: string) => `✓ 已回复 ${from}：${picked}`,
  exitConfirmTitle: '⚠ 退出 falinks —— 关闭所有员工窗口吗？ ',
  exitConfirmKeys: 'y/Enter=关闭并退出 · n=保留窗口退出 · Esc=取消',
  wizardAddPrefix: '添加员工 ',
  wizardCliSuffix: ' — 选择 CLI（↑↓ 选 · Enter 下一步 · Esc 取消）',
  wizardExperimental: '  (实验)',
  wizardModelSuffix: ' — 模型（Enter 下一步 · 留空=CLI 默认 · Esc 取消）',
  wizardModelHint: '例：claude-opus-4-8 / claude-opus-4-8[1m]（1M 上下文）。留空用 CLI 全局默认；填错会启动失败并触发 ⚠ 未报到告警。',
  wizardModelPickSuffix: ' — 选模型（↑↓ 选 · Enter 确认 · Esc 取消）',
  wizardModelDefaultLabel: '(默认)',
  wizardModelPresets: {
    default: '默认（跟随 CLI 全局设置）',
    opus1m: 'Opus 4.8 · 1M 上下文',
    opus: 'Opus 4.8',
    sonnet1m: 'Sonnet 4.6 · 1M 上下文',
    sonnet: 'Sonnet 4.6',
    haiku: 'Haiku 4.5 · 快/省',
    custom: '自定义…（手动输入模型名）',
  } as Record<string, string>,
  wizardRoleSuffix: ' — 角色/职责（Enter 下一步 · Esc 取消）',
  wizardRoleExample: '例：负责后端开发 / 审查代码 / 调研查证。留空=通用员工。',
  wizardDefaultRole: '员工',
  wizardCwdSuffix: ' — 工作目录（Enter 确认 · Tab 补全 · Esc 取消）',
  wizardCwdDefault: '默认=当前目录，直接 Enter 即用它（多数情况员工同目录）',
  questionAsk: (from: string, question: string) => `❓ ${from} 问你：${question}`,
  answerKeys: '↑↓ 选 · Enter 回复 · Esc 跳过',
  answerMore: (n: number) => ` · 还有 ${n} 个待答`,
  answerOrType: ' · 或打字改普通输入',
  answerCustom: '✏️ 自定义回答…',
  answerCustomPrompt: '自定义回答(Enter 发送 · Esc 返回选项): ',
  bossAnswered: (question: string, text: string) => `对“${question}”，老板回复：${text}`,
  roster: '花名册',
  messages: '消息',
  /** 花名册里的员工状态本地化（未知值原样返回，前向兼容新状态）。 */
  agentStatus: (s: string): string =>
    ({ launching: '启动中', idle: '空闲', busy: '工作中', stuck: '卡住', dead: '已下线' } as Record<string, string>)[s] ?? s,
  msgQueued: '⏳ 排队中',
  msgDelivered: '✓ 已送达',
  /** 诊断警告行:有消息被守卫丢/注入失败/可疑过早 idle 时提示(可能导致协作卡死)。0 项时调用方不显示。 */
  diagWarn: (drops: number, injFails: number, fastIdle: number) => {
    const parts: string[] = [];
    if (drops) parts.push(`${drops} 条被守卫拦下`);
    if (injFails) parts.push(`${injFails} 条注入失败`);
    if (fastIdle) parts.push(`${fastIdle} 次可疑过早空闲`);
    return `⚠ 协作诊断:${parts.join(' · ')}(可能致卡死;/clear 全员可清空)`;
  },
  /** 底部活区"等送达"行:仍在对方 inbox 排队、尚未投出的目标聚合(targets 形如 `→ qa ×2 · → backend`)。空则不显示。 */
  pendingDeliver: (targets: string) => `⏳ 等送达: ${targets} · Esc 取消排队`,
  /** 取消排队浮层 */
  qcancelTitle: (n: number) => `排队消息(共 ${n} 条)（↑↓ 选 · Enter 取消 · ! 插队直送 · Esc 关闭）`,
  qcancelOk: (to: string) => `✗ 已取消 1 条排队消息(→ ${to})`,
  qcancelFailed: '取消失败(可能刚已送达)',
  qpromoteOk: (to: string) => `⚡ 已插队直送 1 条(→ ${to})`,
  qpromoteFailed: '插队失败(可能刚已送达、员工未就绪或已下线)',
  /** 历史里被撤销消息的标记 */
  canceledMark: ' ✗已取消',
  /** 历史里插队直送消息的标记 */
  urgentMark: ' ⚡直送',
  /** 回看态提示:offset=距最新多少行。 */
  browseHint: (offset: number) => `↑ 回看中(距最新 ${offset} 行)· 滚轮/↑↓ 移动 · PgUp/PgDn 翻页 · Esc 或输入回到最新`,
  langAuto: '跟随系统',
  langZh: '中文',
  langEn: 'English',
  langPickTitle: '选择语言（↑↓ 选 · Enter 确认 · Esc 取消）',
  langSwitched: (l: string) => `已切换语言：${l}`,
  leadCmdPickTitle: '选组长(协调者，全队唯一，换则取消旧的)（↑↓ 选 · Enter 确认 · Esc 取消）',
  leadPickEmpty: '（暂无可选员工）',
  leadSwitched: (name: string) => `♔ 已指定 ${name} 为组长`,
  leadFailed: 'lead 失败',
  leadAssignedMsg: '你已被指定为本团队组长(协调者)。即日起按以下工作法统筹团队:',
  leadRevokedMsg: '你不再是组长(协调者),无需再做团队协调统筹,专注自己的任务即可。',
  inputHint: (target: string) => `直接打字=回复 @${target} · @all 群发 · @名字 私聊 · \\\\+回车 换行 · 滚轮回看 · / 命令`,
  noReplyTargetShort: '(无·先 @某人)',
  broadcastAllHint: '群发全员',

  // —— console/commands.ts ——
  cmdHint: {
    add: '加一个员工',
    remove: '删一个员工',
    clear: '清空某员工上下文,不带名=全员(含 boss 历史)',
    lang: '切换语言(中/英)',
    lead: '指定组长(协调者):弹出选择器选一个员工',
    office: '在浏览器打开像素办公室(实时看员工干活)',
    help: '显示用法',
    restart: '重启某员工的 CLI(带 falinks 配置;加 fresh=全新会话)',
    todo: '任务清单:add/list/rm/clear/start/stop/resume,无人值守按序执行',
  } as Record<string, string>,

  // —— console/parse.ts ——
  usageRemove: '用法: /remove <name>',
  usageRestart: '用法: /restart <name> [fresh]',
  usageAdd: '用法: /add <名字>（按向导选 cli 和目录），或 /add <名字> <cli> <目录>',
  usageLang: '用法: /lang（按提示选语言）',
  usageLead: '用法: /lead（按提示选组长）',
  officeOpened: '已在浏览器打开像素办公室',
  unknownCommand: (cmd: string) => `未知命令: /${cmd}`,
  usageMention: '用法: @<name> <message> 或 @all <message>',
  usageUrgent: '插队直送用法:!@名字 消息 · !消息(插队回复) · !@all 消息——跳过排队直接送达;命令不可插队',
  unknownError: '未知错误',
  langFailed: 'lang 失败',
  usageTodo: '用法: /todo add <内容> | list | rm <序号> | clear | start [巡查分钟] | stop | resume',
  usageTodoAdd: '用法: /todo add <任务内容>(可多行)',
  usageTodoRm: '用法: /todo rm <序号>',
  usageTodoStart: '用法: /todo start [巡查间隔分钟,正整数,默认10]',
  usageLeadReset: '用法:/todo leadreset on|off|<正整数>(开关 lead 周期重置 / 设周期 K)',
  leadResetSet: (enabled: boolean, k: number) => `lead 周期重置:${enabled ? '开' : '关'},每 ${k} 条`,

  // —— discovery.ts:按 cwd 寻址运行中的总线 ——
  busNotFound: '找不到运行中的 falinks —— `falinks` 在运行吗？',
  busMultiple: (n: number, list: string) => `有 ${n} 个 falinks 在运行，请到对应目录执行：\n${list}`,
  busInstanceLine: (cwd: string, port: number) => `  ${cwd}（端口 ${port}）`,

  // —— cli.ts ——
  exitUpdateHint: (cmd: string) => `已退出。更新命令：${cmd}`,
  defaultBootstrap: '你是办公室里的 AI 员工，风格简练。',
  configReady: (path: string) => `✅ 配置已就绪（${path}）。运行：falinks`,
  langCurrent: (l: string) => `当前语言：${l}（用 falinks lang 在交互终端里切换）`,
  doctorClaudeNote: '可选（claude 员工需要）',
  doctorCodexNote: '可选（codex 员工需要）',
  doctorPermHint: '提示：首次运行会弹"自动化"权限请求，需允许 iTerm 被控制。',
  upConfigNotFound: (path: string) =>
    `没找到配置 ${path}。\n先在当前目录运行 \`falinks init\` 生成默认配置，或指定路径：falinks up <config.json>`,
  defaultHelp:
    'falinks — 在当前目录把多个 AI CLI 编排成一间办公室。\n' +
    '直接运行：  falinks            （首次自动生成配置并启动）\n' +
    '子命令：    falinks init | doctor | lang | up [config] | say <agent> <msg> | broadcast <msg> | roster | log',

  // —— setup/app.tsx ——
  setupUpdateFound: (latest: string, current: string) => `🆕 发现新版 ${latest}（当前 v${current}）`,
  setupChooseKeys: '↑↓ 选 · Enter 确认',
  setupKeepCurrentVersion: '  ▶ 继续使用当前版本',
  setupQuitForUpdate: (cmd: string) => `  ⤓ 退出去更新（${cmd}）`,
  setupChooseTeam: 'falinks — 选择团队（↑↓ 选 · Enter 确认）',
  setupReuseTeam: (current: string) => `  ▶ 继续当前团队（${current}）`,
  setupTplMine: ' ·我的',
  setupTplLabel: (name: string, mine: string, n: number) => `  ${name}${mine}（${n} 人）`,
  setupCustomTeam: '  ＋ 自定义团队…',
  setupCustomTitle: '自定义团队（输入名字+角色逐个加，留空名字回车=完成）',
  setupMemberLine: (i: number, name: string, cli: string, role: string) => `  ${i}. ${name}（${cli}） — ${role}`,
  setupNewMemberName: '新成员名字: ',
  setupWhichCli: (name: string) => `${name} 用哪个 CLI?（↑↓ 选 · Enter 确认）`,
  setupRolePrompt: (name: string, cli: string) => `${name}（${cli}） 的角色/职责: `,
  setupCwdPrompt: (name: string) => `${name} 的工作目录(↑↓ 选建议 · Tab 补全 · Enter 确认): `,
  setupSaveTeamName: '保存为团队模板，起个名: ',
  setupDefaultRole: '员工',

  // —— orchestrator.ts:注入目标窗口的消息格式 ——
  incomingMsg: (from: string, body: string) =>
    `【来自 ${from}】${body}\n(回复请调用 sendmsg(to="${from}", message="..."))`,

  // —— index.ts:注入员工的协作规则 + 启动日志 ——
  houseRules:
    '【falinks 协作规则】你是办公室里的 AI 员工，通过 falinks 的 MCP 工具协作。' +
    '① 开机立刻调用 register 报到。' +
    '② 收到形如「【来自 X】…」的消息后，只有当你有实质内容（答案/数据/明确问题）时，才用 sendmsg(to="X", message="…") 回复。' +
    '③ 严禁发送任何寒暄、确认、客套或表情——例如「收到」「好的」「谢谢」「不客气」「没问题」「👍」一律不要发，这些纯属浪费。' +
    '④ 完成任务、或没有实质内容要说时，直接调用 idle 结束本回合，不要发任何结束语。' +
    '⑤ 转达/汇报要一次说完，不要来回确认。' +
    '⑥ 只要对方让你「给选项 / 做个选择题 / 二选一 / 列出可选项 / 给我N个…让我挑」，就必须调用 ask(to, question, options=[...]) ——把候选项放进 options 数组，绝不要把选项写进 sendmsg 的文本里。面向老板用 ask(to="boss", …)，老板端会渲染成可点选项。需要别人在有限选项里做决定时同理用 ask。',
  identityLine: (name: string, role?: string) => `你的身份：${name}${role ? `（${role}）` : ''}。`,
  /** 组长(协调者)专属工作法,仅注入给 lead:true 的员工——先对齐需求→完整设计→定稿→才拆解分派。 */
  coordinatorRules:
    '【组长(协调者)工作法】你是这个团队的组长,像真实研发团队的 tech lead。务必按顺序来,不要一上来就派活、更不要在方案没定稿前让任何人写代码:' +
    '① 先和老板(boss)把需求与细节聊清楚——用 ask(to="boss", …) 对关键决策做选择题、用 sendmsg(to="boss", …) 追问不明确处,确认目标、范围、约束、验收标准。' +
    '② 用 superpowers 技能做设计:先用 brainstorming 技能探讨方案与取舍,再用 writing-plans 技能写出明确的设计/实现计划。设计阶段可以调度其他员工协助你(让他们调研代码、找资料、对方案提建议),但此阶段严禁让任何人开始编码。' +
    '③ 方案敲定后,再把它拆解成具体任务,用 sendmsg 逐一分派给对应员工(前端/后端/测试…),然后持续管理:跟进进度、协调依赖、汇总结果、必要时复盘。' +
    '④ 当 boss 明确要求用 todo 模式执行时:拆解定稿后调用 todoplan(tasks:[每条一个任务]) 建成清单 → 用 ask(to:"boss") 确认是否开始执行(选项里给巡查间隔,如「开始(巡查10分钟)/开始(巡查30分钟)/暂不」)→ boss 同意后调 todostart(nudgeMinutes) 启动;之后每完成一条用 taskdone(seq, status, result) 上报,系统会自动下发下一条。未经 boss 同意绝不 todostart;要修订刚建的清单用 todoplan(…, replace:true)。todo 模式下每条任务下发时系统会把其他员工重置为全新会话,你需对他们完整交底,且只有所有分派出去的员工都回报后才调 taskdone。' +
    '⑤ todo 模式下你有「项目状态档」作为跨会话记忆:每条任务推进时系统可能把你重置为新会话再重加载此档,所以务必随每次 taskdone 用 leadstate(content) 把目标/关键决策/已完成/下一步整篇刷新、保持精炼;这样即使被重置或重启也能无缝续接。' +
    '一句话:对齐需求 → 完整设计(可调度协助) → 方案定稿 → 才拆解、分派、管理。',
  preparingWorkers: (n: number, names: string) => `⏳ falinks 正在准备 ${n} 名员工（${names}）…`,
  preparingHint: '首次启动每个员工要等 CLI 就绪，可能十几秒，请稍候。',
  launchingWorker: (name: string, cli: string) => `[falinks] 启动员工 ${name} (${cli})…`,
  workerWindowClosed: (name: string) => `[falinks] ${name} 的窗口已关，自动下线`,
  instanceAlreadyRunning: (port: number) => `该目录已有 falinks 在运行（端口 ${port}）。先在那边 Ctrl-C 收工，再启动。`,
  instanceMaybeRunning: (port: number, path: string) => `疑似有 falinks 在运行（端口 ${port}）但探活超时。确认没在运行后删除：${path}`,
  instanceAlreadyRunningShort: (port: number) => `该目录已有 falinks 在运行（端口 ${port}）。`,
  portFallback: (wanted: number, got: number) => `⚠ 端口 ${wanted} 被占用，已自动改用 ${got}`,
  addFailedDetail: (detail: string) => `添加失败:${detail}`,

  // —— bus/server.ts ——
  bossPicked: (question: string, choice: string) => `对“${question}”，老板选择：${choice}`,
  askToPeer: (question: string, options: string, replyTo: string) =>
    `${question}\n${options}\n(回复请 sendmsg(to="${replyTo}", message="选 N"))`,
  toolDescRegister: '报到：告知 falinks 你已就绪',
  toolDescSendmsg: '给某个同事/角色发消息',
  toolDescIdle: '本回合收尾，释放空闲状态',
  toolDescAsk:
    '出选择题。发给老板(to="boss")老板会看到可点选项并回选;发给同事则对方收到带编号选项的消息,用 sendmsg 回选哪个。',
  askBlockedInTodo:
    '【todo 模式运行中·无人值守】禁止向 boss 提问——没人会即时回答,提问会卡死长任务。请基于现有信息按你的最优推荐方案继续推进,并在任务结果/项目状态档里写明你的假设与取舍。',
  toolDescWho: '查看在线花名册',
  toolDescTaskdone: '【todolist 专用·仅组长】上报当前任务完结:taskdone(seq, status:"done"|"failed", result)。系统记录后才会下发下一条;失败也要报,不会中断清单。',
  toolDescTodoplan: '【todo 模式·仅组长】boss 明确要求用 todo 模式执行时,把拆解定稿的任务批量建成清单:todoplan(tasks:[每条一个任务], replace?)。建完必须用 ask(to:"boss") 征得 boss 同意才可 todostart;修订自己刚建的清单传 replace:true。',
  toolDescTodostart: '【todo 模式·仅组长】启动已建好的任务清单:todostart(nudgeMinutes?)。必须先经 ask 获得 boss 明确同意;paused 状态的恢复属 boss 干预权(/todo resume),本工具不可用。',
  toolDescTaskwait: '(仅组长)声明当前任务在等待外部过程(长脚本/CI/后台测试),minutes(1-120)分钟内暂停空闲巡查;reason 会展示给 boss。任务实际完成时仍须调 taskdone。',
  toolDescLeadstate: '【todo 模式·仅组长】整篇写入/更新你的「项目状态档」:leadstate(content)。这是你跨会话的记忆——周期重置或重启后会重新加载它。请随每次 taskdone 顺手刷新,内容精炼策展(目标/范围、关键决策与理由、约定与坑、已完成、下一步),整篇替换而非追加流水。',
  leadResetSkippedNoDoc: '【lead 重置跳过】已到周期但组长尚无项目状态档(leadstate),为防失忆本次不重置。请提示组长用 leadstate 维护项目记忆。',
  leadMemoryOff: 'lead 记忆已关闭(config.todo.leadReset.enabled=false),leadstate 未生效。',

  // —— templates.ts ——
  roleBootstrap: (role: string) => `你的职责：${role}。风格简练，少废话。`,
  tplSoloName: '单人助手',
  tplSoloRole: '通用助手',
  tplPairName: '结对编程（开发者+审查者）',
  tplPairDev: '开发者，负责写代码实现需求',
  tplPairReviewer: '审查者，负责审查 dev 的代码、挑问题提改进',
  tplFullstackName: '全栈小组（组长+前端+后端+测试+UI/UX）',
  tplFullstackLead: '组长，统筹任务并分配给前端/后端/测试/UIUX',
  tplFullstackFrontend: '前端开发',
  tplFullstackBackend: '后端开发',
  tplFullstackQa: '测试与质量',
  tplFullstackUx: 'UI/UX 设计走查，把控统一风格、杜绝新功能风格跑偏',
  tplResearchName: '调研组（调研员+撰写+审校）',
  tplResearchResearcher: '调研员，负责查证与资料收集',
  tplResearchWriter: '撰写，把调研整理成文',
  tplResearchEditor: '审校，审查并润色 writer 的产出',

  // —— todolist 消息模板(下发/巡查以 boss 名义、自包含;汇总以 falinks 名义入流水)——
  todoDispatchMsg: (seq: number, pos: number, total: number, body: string, isResend: boolean) =>
    `【任务 #${seq}·第 ${pos}/${total} 条】${isResend ? '(重发)' : ''}${body}\n` +
    `你是本团队的组长(协调者):请把本任务拆解成子任务、用 sendmsg 分派给对应员工(前端/后端/测试…)执行,你只负责协调依赖、跟进进度、汇总结果,不要自己动手包办。` +
    (isResend ? '' : '⚠ 本轮员工均为全新会话、无任何历史记忆,分派时务必把背景、目标、验收标准一次交代清楚。') +
    `完成判定:只有当你分派出去的所有员工都已完成并向你回报后,才调 taskdone(seq:${seq}, status:"done"|"failed", result:"…")上报,系统才会下发下一条——否则会中断他们正在进行的工作。如需等待长脚本/外部过程,调 taskwait(seq:${seq}, minutes:预计分钟, reason:"…")声明等待。勿用 sendmsg 回复本条。【无人值守】遇到决策点请自行采用最优推荐方案推进、把假设与取舍写进结果或项目状态档,切勿向 boss 提问(运行中 ask boss 会被拒);过程中可照常用 sendmsg 与团队沟通。`,
  todoNudgeMsg: (seq: number, pos: number, total: number, body: string, nextMinutes: number, escalated: boolean) =>
    `【任务 #${seq}(第 ${pos}/${total} 条)进度巡查】全员空闲已久仍未收到上报。任务内容:${body}\n` +
    (escalated
      ? `若该任务实际已完成,说明 #${seq} 仍未关闭——请立即调 taskdone(seq:${seq}, status:"done"|"failed", result:"…")上报;`
      : `已完成请调 taskdone(seq:${seq}, status:"done"|"failed", result:"…");`) +
    `仍在推进则继续即可;如仍未分派,请把任务拆解后分派给员工执行;如在等待长时间脚本/外部过程,调 taskwait(seq:${seq}, minutes:预计分钟, reason:"…")声明等待。勿因本提醒向队友发起额外沟通。未上报则 ${nextMinutes} 分钟后再次巡查。`,
  todoSummaryTitle: (done: number, failed: number, total: number) => `【todolist 跑完】共 ${total} 条:✅ ${done} 成 · ❌ ${failed} 败`,
  todoSummaryLine: (seq: number, ok: boolean, body: string, result: string) => `${ok ? '✅' : '❌'} #${seq} ${body} — ${result}`,
  todoPlannedMsg: (from: string, n: number) => `【todo 模式】组长 ${from} 已建 ${n} 条任务清单,/todo list 查看;待 boss 确认后由组长启动(或你直接 /todo start)。`,
  todoSuspendedMsg: '【todolist 挂起】当前没有组长,任务暂停下发;/lead 指定组长后自动继续。',
  todoWorkersTimeoutMsg: '【todolist】部分员工尚未清空就绪(已等待超时),仍按计划把当前任务派给组长。',
  todoSendFailingMsg: '【todolist 告警】连续多次消息发送失败(守卫拦截或组长不可达),清单可能停滞,请检查。',
  todoWaitingMsg: (seq: number, minutes: number, reason: string) =>
    `【todolist】组长声明等待外部过程${reason ? `:${reason}` : ''},任务 #${seq} 巡查暂停 ${minutes} 分钟。`,
  todoStalledMsg: (seq: number, n: number, intervalMinutes: number) =>
    `【todolist 告警】任务 #${seq} 连续 ${n} 次巡查无上报——疑似已完成但未关闭,或已停滞;巡查间隔已退避至 ${intervalMinutes} 分钟。请 /todo list 检查,可提醒组长 taskdone 或 /todo stop。`,
  todoProgressLine: (k: number, total: number, body: string, paused: boolean) =>
    `📋 ${k}/${total} 当前:${body}${paused ? ' [⏸ 已暂停]' : ''}`,
  todoWaitSeg: (reason: string, until: string) => ` ⏳等外部${reason ? `:${reason}` : ''}(至 ${until})`,
  todoPendingLine: (n: number) => `📋 ${n} 条待开跑(/todo list 查看)`,
  todoResumeHint: (left: number, total: number) => `检测到未完成的 todolist(剩 ${left}/${total} 条),/todo resume 继续`,
  todoListTitle: '任务清单(Esc 关闭)',
  todoListEmpty: '(空)— /todo add <内容> 添加',
  todoOpOk: (op: string) => `todo ${op} 完成`,
  todoAddOk: (seq: number) => `已加入任务 #${seq}`,
  todoRemovedByBoss: 'boss 移除(跳过)',
};
