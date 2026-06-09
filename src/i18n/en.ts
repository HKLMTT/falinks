import type { zh } from './zh.js';

/** 英文词典:typeof zh 钉死 key 与签名——漏译/签名不符直接编译失败。 */
export const en: typeof zh = {
  clipboardNoImage: 'No image in clipboard',
  officeReady: (n: number) => `✅ Office ready: ${n} workers + console. Ctrl-C to wrap up.`,

  // —— console/clipboard.ts ——
  imageToken: (n: number) => `[Image ${n}]`,

  // —— console/app.tsx ——
  taglines: [
    'A room full of AI workhorses — you just run your mouth 🐴',
    'They do the work, you take the credit 🐴',
    'AI workhorses: no whining, no paycheck',
    'You say the word, the horses run their legs off',
    'AI workhorses standing by, boss — give the order',
    'Hired a whole stable of digital workhorses',
    'You talk, they go bald 🐴',
    '24/7 AI workhorses, never slacking (probably)',
    'One word from the boss, the horses run themselves ragged',
  ] as string[],
  helpStatus: '@name = DM · @all = broadcast · plain text = reply to last target · /add a worker · /remove a worker · /clear [name] wipe context',
  guardrailBlocked: 'blocked by guardrail',
  sayUndelivered: (to: string, err: string) => `not delivered to ${to}: ${err}`,
  sayOk: (to: string) => `→ ${to}`,
  broadcastOk: '→ everyone',
  replyOk: (to: string) => `→ ${to} (reply)`,
  noReplyTarget: 'No previous target — @someone for a DM or @all to broadcast',
  addOk: (name: string) => `＋ ${name}`,
  removeOk: (name: string) => `－ ${name}`,
  addFailed: 'add failed',
  removeFailed: 'remove failed',
  clearFailed: 'clear failed',
  clearAll: 'everyone',
  clearNone: 'none',
  clearJoiner: ', ',
  cleared: (name: string, list: string) => `🧹 Cleared ${name} (${list})`,
  wizardAddOk: (name: string, role: string, path: string) => `＋ ${name} (${role}) @ ${path}`,
  wizardCancelled: 'Add cancelled',
  attached: (token: string) => `📎 Attached ${token} — add @worker then Enter, the worker will read this image`,
  answeredOk: (from: string, picked: string) => `✓ Replied to ${from}: ${picked}`,
  exitConfirmTitle: '⚠ Quit falinks — close all worker windows? ',
  exitConfirmKeys: 'y/Enter = close and quit · n = quit but keep windows · Esc = cancel',
  wizardAddPrefix: 'Add worker ',
  wizardCliSuffix: ' — pick a CLI (↑↓ select · Enter next · Esc cancel)',
  wizardExperimental: '  (experimental)',
  wizardRoleSuffix: ' — role/duties (Enter next · Esc cancel)',
  wizardRoleExample: 'e.g. backend dev / code review / research. Leave empty = generic worker.',
  wizardDefaultRole: 'worker',
  wizardCwdSuffix: ' — working directory (Enter confirm · Tab complete · Esc cancel)',
  wizardCwdDefault: 'Default = current directory, just press Enter to use it (usually workers share it)',
  questionAsk: (from: string, question: string) => `❓ ${from} asks you: ${question}`,
  answerKeys: '↑↓ select · Enter reply · Esc skip',
  answerMore: (n: number) => ` · ${n} more pending`,
  answerOrType: ' · or type to switch to normal input',
  roster: 'Roster',
  messages: 'Messages',
  agentStatus: (s: string): string =>
    ({ launching: 'launching', idle: 'idle', busy: 'busy', stuck: 'stuck', dead: 'dead' } as Record<string, string>)[s] ?? s,
  msgQueued: '⏳ queued',
  msgDelivered: '✓ delivered',
  diagWarn: (drops: number, injFails: number, fastIdle: number) => {
    const parts: string[] = [];
    if (drops) parts.push(`${drops} dropped by guardrail`);
    if (injFails) parts.push(`${injFails} inject failures`);
    if (fastIdle) parts.push(`${fastIdle} suspect early-idle`);
    return `⚠ collab diag: ${parts.join(' · ')} (may stall the team; /clear all to reset)`;
  },
  pendingDeliver: (targets: string) => `⏳ pending: ${targets}`,
  langAuto: 'Follow system',
  langZh: '中文',
  langEn: 'English',
  langPickTitle: 'Select language (↑↓ · Enter · Esc)',
  langSwitched: (l: string) => `Language switched: ${l}`,
  leadCmdPickTitle: 'Pick the lead (coordinator; one per team, switching cancels the old) (↑↓ · Enter · Esc)',
  leadPickEmpty: '(no workers to pick)',
  leadSwitched: (name: string) => `♔ ${name} is now the lead`,
  leadFailed: 'lead failed',
  leadAssignedMsg: 'You are now this team\'s lead (coordinator). From now on, coordinate the team per this playbook:',
  leadRevokedMsg: 'You are no longer the lead (coordinator). Stop coordinating the team and just focus on your own tasks.',
  inputHint: (target: string) => `Type = reply to @${target} · @all broadcast · @name DM · \\\\+Enter newline · scroll to view history · / command`,
  noReplyTargetShort: '(none · @someone first)',
  broadcastAllHint: 'broadcast to everyone',

  // —— console/commands.ts ——
  cmdHint: {
    add: 'add a worker',
    remove: 'remove a worker',
    clear: "clear a worker's context, no name = everyone (incl. boss history)",
    lang: 'Switch language (zh/en)',
    lead: 'Designate the lead (coordinator): opens a picker',
    help: 'show usage',
  } as Record<string, string>,

  // —— console/parse.ts ——
  usageRemove: 'usage: /remove <name>',
  usageAdd: 'usage: /add <name> (pick cli and dir via wizard), or /add <name> <cli> <dir>',
  usageLang: 'Usage: /lang (pick from the menu)',
  usageLead: 'Usage: /lead (pick from the menu)',
  unknownCommand: (cmd: string) => `unknown command: /${cmd}`,
  usageMention: 'usage: @<name> <message> or @all <message>',
  unknownError: 'unknown error',
  langFailed: 'lang switch failed',

  // —— discovery.ts ——
  busNotFound: 'No running falinks found — is `falinks` running?',
  busMultiple: (n: number, list: string) => `${n} falinks instances are running; run this in the matching directory:\n${list}`,
  busInstanceLine: (cwd: string, port: number) => `  ${cwd} (port ${port})`,

  // —— cli.ts ——
  exitUpdateHint: (cmd: string) => `Exited. Update command: ${cmd}`,
  defaultBootstrap: 'You are an AI worker in the office, concise in style.',
  configReady: (path: string) => `✅ Config ready (${path}). Run: falinks`,
  langCurrent: (l: string) => `Current language: ${l} (run falinks lang in an interactive terminal to switch)`,
  doctorClaudeNote: 'optional (needed for claude workers)',
  doctorCodexNote: 'optional (needed for codex workers)',
  doctorPermHint: 'Tip: the first run pops an "Automation" permission request — allow iTerm to be controlled.',
  upConfigNotFound: (path: string) =>
    `Config ${path} not found.\nRun \`falinks init\` in the current directory to generate a default config, or pass a path: falinks up <config.json>`,
  defaultHelp:
    'falinks — orchestrate several AI CLIs into one office in the current directory.\n' +
    'Run directly:  falinks            (generates config and starts on first run)\n' +
    'Subcommands:   falinks init | doctor | lang | up [config] | say <agent> <msg> | broadcast <msg> | roster | log',

  // —— setup/app.tsx ——
  setupUpdateFound: (latest: string, current: string) => `🆕 New version ${latest} available (current v${current})`,
  setupChooseKeys: '↑↓ select · Enter confirm',
  setupKeepCurrentVersion: '  ▶ Keep using the current version',
  setupQuitForUpdate: (cmd: string) => `  ⤓ Quit to update (${cmd})`,
  setupChooseTeam: 'falinks — choose a team (↑↓ select · Enter confirm)',
  setupReuseTeam: (current: string) => `  ▶ Keep current team (${current})`,
  setupTplMine: ' ·mine',
  setupTplLabel: (name: string, mine: string, n: number) => `  ${name}${mine} (${n} members)`,
  setupCustomTeam: '  ＋ Custom team…',
  setupCustomTitle: 'Custom team (add name + role one by one, empty name + Enter = done)',
  setupMemberLine: (i: number, name: string, cli: string, role: string) => `  ${i}. ${name} (${cli}) — ${role}`,
  setupNewMemberName: 'New member name: ',
  setupWhichCli: (name: string) => `Which CLI for ${name}? (↑↓ select · Enter confirm)`,
  setupRolePrompt: (name: string, cli: string) => `Role/duties for ${name} (${cli}): `,
  setupCwdPrompt: (name: string) => `Working dir for ${name} (↑↓ suggestions · Tab complete · Enter confirm): `,
  setupSaveTeamName: 'Save as a team template, give it a name: ',
  setupDefaultRole: 'worker',

  // —— orchestrator.ts: message format injected into the target window ——
  incomingMsg: (from: string, body: string) =>
    `[From ${from}] ${body}\n(Reply via sendmsg(to="${from}", message="..."))`,

  // —— index.ts: collaboration rules injected into workers + startup logs ——
  houseRules:
    '[falinks collaboration rules] You are an AI worker in this office, collaborating through falinks MCP tools. ' +
    '① On startup, immediately call register to check in. ' +
    '② After receiving a message of the form "[From X] …", reply with sendmsg(to="X", message="…") only when you have substantive content (an answer / data / a clear question). ' +
    '③ Never send any pleasantries, acknowledgements, small talk, or emoji — e.g. "got it", "ok", "thanks", "you\'re welcome", "no problem", "👍" must never be sent, they are pure waste. ' +
    '④ When a task is done, or you have nothing substantive to say, just call idle to end this turn — do not send any closing remark. ' +
    '⑤ Relay/report everything in one go, do not go back and forth confirming. ' +
    '⑥ Whenever someone asks you to "give options / make it multiple-choice / pick one of two / list the choices / give me N… and let me choose", you must call ask(to, question, options=[...]) — put the candidates into the options array, and never write the options into the sendmsg text. For the boss use ask(to="boss", …), and the boss side will render clickable options. Use ask the same way whenever someone needs to decide among a limited set of options.',
  identityLine: (name: string, role?: string) => `Your identity: ${name}${role ? ` (${role})` : ''}. `,
  /** Coordinator/lead-only protocol, injected only for lead:true workers — align → design fully → finalize → then decompose & dispatch. */
  coordinatorRules:
    '[Lead (coordinator) playbook] You are the team lead, like a real engineering tech lead. Follow this order; do NOT start handing out work, and never let anyone write code, before the plan is finalized: ' +
    '① First align requirements & details with the boss — use ask(to="boss", …) for key decisions and sendmsg(to="boss", …) to clarify anything unclear: confirm goals, scope, constraints, acceptance criteria. ' +
    '② Design using superpowers skills: first the brainstorming skill to explore approaches & trade-offs, then the writing-plans skill to write a concrete design/implementation plan. During design you MAY dispatch other workers to assist you (have them investigate code, gather info, critique the approach), but no one writes code in this phase. ' +
    '③ Once the plan is finalized, decompose it into concrete tasks and dispatch them one by one via sendmsg to the right workers (frontend/backend/qa…), then keep managing: track progress, coordinate dependencies, aggregate results. ' +
    'In short: align requirements → design fully (may dispatch helpers) → finalize the plan → only then decompose, dispatch, and manage.',
  preparingWorkers: (n: number, names: string) => `⏳ falinks is preparing ${n} workers (${names})…`,
  preparingHint: 'On first launch each worker waits for its CLI to be ready, which may take a dozen seconds — please hold on.',
  launchingWorker: (name: string, cli: string) => `[falinks] launching worker ${name} (${cli})…`,
  workerWindowClosed: (name: string) => `[falinks] ${name}'s window was closed, taken offline automatically`,
  instanceAlreadyRunning: (port: number) => `falinks is already running in this directory (port ${port}). Ctrl-C to wrap up over there first, then start.`,
  instanceMaybeRunning: (port: number, path: string) => `falinks may be running (port ${port}) but the health check timed out. Once you confirm it is not running, delete: ${path}`,
  instanceAlreadyRunningShort: (port: number) => `falinks is already running in this directory (port ${port}).`,
  portFallback: (wanted: number, got: number) => `⚠ Port ${wanted} is in use, automatically switched to ${got}`,
  addFailedDetail: (detail: string) => `Add failed: ${detail}`,

  // —— bus/server.ts ——
  bossPicked: (question: string, choice: string) => `For "${question}", the boss chose: ${choice}`,
  askToPeer: (question: string, options: string, replyTo: string) =>
    `${question}\n${options}\n(Reply via sendmsg(to="${replyTo}", message="pick N"))`,
  toolDescRegister: 'Check in: tell falinks you are ready',
  toolDescSendmsg: 'Send a message to a coworker/role',
  toolDescIdle: 'Wrap up this turn, release to idle state',
  toolDescAsk:
    'Pose a multiple-choice question. Send to the boss (to="boss") and the boss sees clickable options and picks one; send to a coworker and they receive a message with numbered options and reply via sendmsg with their pick.',
  toolDescWho: 'View the online roster',

  // —— templates.ts ——
  roleBootstrap: (role: string) => `Your duties: ${role}. Keep it concise, no fluff.`,
  tplSoloName: 'Solo assistant',
  tplSoloRole: 'General assistant',
  tplPairName: 'Pair programming (developer + reviewer)',
  tplPairDev: 'Developer, responsible for writing code to implement requirements',
  tplPairReviewer: "Reviewer, responsible for reviewing dev's code, spotting issues and suggesting improvements",
  tplFullstackName: 'Full-stack squad (lead + frontend + backend + QA + UI/UX)',
  tplFullstackLead: 'Lead, coordinates tasks and assigns them to frontend/backend/QA/UX',
  tplFullstackFrontend: 'Frontend development',
  tplFullstackBackend: 'Backend development',
  tplFullstackQa: 'Testing and quality',
  tplFullstackUx: 'UI/UX design review, keeps the style consistent and prevents drift in new features',
  tplResearchName: 'Research group (researcher + writer + editor)',
  tplResearchResearcher: 'Researcher, responsible for fact-checking and gathering material',
  tplResearchWriter: 'Writer, turns the research into prose',
  tplResearchEditor: "Editor, reviews and polishes the writer's output",
};
