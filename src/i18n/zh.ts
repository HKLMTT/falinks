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
  helpStatus: '@名字 私聊 · @all 群发 · 纯文本=回复上次对话目标 · /add 加员工 · /remove 删员工 · /clear [名字] 清空上下文',
  guardrailBlocked: '被护栏拦截',
  sayUndelivered: (to: string, err: string) => `未送达 ${to}：${err}`,
  sayOk: (to: string) => `→ ${to}`,
  broadcastOk: '→ 全员',
  replyOk: (to: string) => `→ ${to}（回复）`,
  noReplyTarget: '没有上次对话目标，请 @某人 私聊 或 @all 群发',
  addOk: (name: string) => `＋ ${name}`,
  removeOk: (name: string) => `－ ${name}`,
  addFailed: 'add 失败',
  removeFailed: 'remove 失败',
  clearFailed: 'clear 失败',
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
  wizardRoleSuffix: ' — 角色/职责（Enter 下一步 · Esc 取消）',
  wizardRoleExample: '例：负责后端开发 / 审查代码 / 调研查证。留空=通用员工。',
  wizardDefaultRole: '员工',
  wizardCwdSuffix: ' — 工作目录（Enter 确认 · Tab 补全 · Esc 取消）',
  wizardCwdDefault: '默认=当前目录，直接 Enter 即用它（多数情况员工同目录）',
  questionAsk: (from: string, question: string) => `❓ ${from} 问你：${question}`,
  answerKeys: '↑↓ 选 · Enter 回复 · Esc 跳过',
  answerMore: (n: number) => ` · 还有 ${n} 个待答`,
  answerOrType: ' · 或打字改普通输入',
  roster: '花名册',
  messages: '消息',
  langAuto: '跟随系统',
  langZh: '中文',
  langEn: 'English',
  langPickTitle: '选择语言（↑↓ 选 · Enter 确认 · Esc 取消）',
  langSwitched: (l: string) => `已切换语言：${l}`,
  moreLines: (n: number, from: string) => `… +${n} 行（完整见 ${from} 窗口）`,
  inputHint: (target: string) => `直接打字=回复 @${target} · @all 群发 · @名字 私聊 · \\\\+回车 换行 · / 命令`,
  noReplyTargetShort: '(无·先 @某人)',
  broadcastAllHint: '群发全员',

  // —— console/commands.ts ——
  cmdHint: {
    add: '加一个员工',
    remove: '删一个员工',
    clear: '清空某员工上下文,不带名=全员',
    lang: '切换语言(中/英)',
    help: '显示用法',
  } as Record<string, string>,

  // —— console/parse.ts ——
  usageRemove: '用法: /remove <name>',
  usageAdd: '用法: /add <名字>（按向导选 cli 和目录），或 /add <名字> <cli> <目录>',
  usageLang: '用法: /lang（按提示选语言）',
  unknownCommand: (cmd: string) => `未知命令: /${cmd}`,
  usageMention: '用法: @<name> <message> 或 @all <message>',
  unknownError: '未知错误',
  langFailed: 'lang 失败',

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
  toolDescWho: '查看在线花名册',

  // —— templates.ts ——
  roleBootstrap: (role: string) => `你的职责：${role}。风格简练，少废话。`,
  tplSoloName: '单人助手',
  tplSoloRole: '通用助手',
  tplPairName: '结对编程（开发者+审查者）',
  tplPairDev: '开发者，负责写代码实现需求',
  tplPairReviewer: '审查者，负责审查 dev 的代码、挑问题提改进',
  tplFullstackName: '全栈小组（组长+前端+后端+测试）',
  tplFullstackLead: '组长，统筹任务并分配给前端/后端/测试',
  tplFullstackFrontend: '前端开发',
  tplFullstackBackend: '后端开发',
  tplFullstackQa: '测试与质量',
  tplResearchName: '调研组（调研员+撰写+审校）',
  tplResearchResearcher: '调研员，负责查证与资料收集',
  tplResearchWriter: '撰写，把调研整理成文',
  tplResearchEditor: '审校，审查并润色 writer 的产出',
};
