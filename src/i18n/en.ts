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
  helpStatus: '@name = DM · @all = broadcast · plain text = reply to last target · /add a worker · /remove a worker · /clear [name] wipe context · /restart relaunch agent · /todo task list · /lead pick lead · !msg urgent send',
  guardrailBlocked: 'blocked by guardrail',
  sayUndelivered: (to: string, err: string) => `not delivered to ${to}: ${err}`,
  sayOk: (to: string) => `→ ${to}`,
  broadcastOk: '→ everyone',
  replyOk: (to: string) => `→ ${to} (reply)`,
  urgentOk: (to: string) => `⚡ → ${to} (urgent)`,
  urgentBroadcastOk: '⚡ broadcast (urgent)',
  noReplyTarget: 'No previous target — @someone for a DM or @all to broadcast',
  addOk: (name: string) => `＋ ${name}`,
  removeOk: (name: string) => `－ ${name}`,
  addFailed: 'add failed',
  removeFailed: 'remove failed',
  clearFailed: 'clear failed',
  restartOk: (n: string) => `restarted ${n} (waiting for it to re-register)`,
  restartFailed: 'restart failed',
  restartBusy: (n: string) => `${n} is restarting/clearing, try again later`,
  unresponsiveWarn: (items: { name: string; mcpSeen: boolean; rule?: string }[]) =>
    '⚠ ' +
    items.map((i) => `${i.name}${i.rule === 'mute' ? ' (got messages but made zero tool calls — session may be wedged, e.g. context exhausted)' : i.mcpSeen ? ' (MCP connected but never registered; session may be wedged)' : ' (CLI likely missing falinks MCP config; manually restarted?)'}`).join(', ') +
    (items.some((i) => i.rule === 'mute') ? ' — try /restart <name> fresh' : ' — try /restart <name> [fresh]'),
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
  wizardModelSuffix: ' — model (Enter next · blank = CLI default · Esc cancel)',
  wizardModelHint: 'e.g. claude-opus-4-8 / claude-opus-4-8[1m] (1M context). Blank = CLI global default; a wrong name fails to launch and trips the ⚠ no-register alarm.',
  wizardModelPickSuffix: ' — pick a model (↑↓ select · Enter confirm · Esc cancel)',
  wizardModelDefaultLabel: '(default)',
  wizardModelPresets: {
    default: 'Default (follow CLI global setting)',
    opus1m: 'Opus 4.8 · 1M context',
    opus: 'Opus 4.8',
    sonnet1m: 'Sonnet 4.6 · 1M context',
    sonnet: 'Sonnet 4.6',
    haiku: 'Haiku 4.5 · fast/cheap',
    custom: 'Custom… (type a model name)',
  } as Record<string, string>,
  wizardRoleSuffix: ' — role/duties (Enter next · Esc cancel)',
  wizardRoleExample: 'e.g. backend dev / code review / research. Leave empty = generic worker.',
  wizardDefaultRole: 'worker',
  wizardCwdSuffix: ' — working directory (Enter confirm · Tab complete · Esc cancel)',
  wizardCwdDefault: 'Default = current directory, just press Enter to use it (usually workers share it)',
  questionAsk: (from: string, question: string) => `❓ ${from} asks you: ${question}`,
  answerKeys: '↑↓ select · Enter reply · Esc skip',
  answerMore: (n: number) => ` · ${n} more pending`,
  answerOrType: ' · or type to switch to normal input',
  answerCustom: '✏️ Custom answer…',
  answerCustomPrompt: 'Custom answer (Enter send · Esc back to options): ',
  bossAnswered: (question: string, text: string) => `On "${question}", boss replied: ${text}`,
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
  pendingDeliver: (targets: string) => `⏳ pending: ${targets} · Esc to cancel`,
  qcancelTitle: (n: number) => `queued messages (${n}) (↑↓ select · Enter cancel · ! send now · Esc close)`,
  qcancelOk: (to: string) => `✗ canceled 1 queued message (→ ${to})`,
  qcancelFailed: 'cancel failed (may have just been delivered)',
  qpromoteOk: (to: string) => `⚡ promoted 1 queued message (→ ${to})`,
  qpromoteFailed: 'promote failed (just delivered, worker not ready, or offline)',
  canceledMark: ' ✗canceled',
  urgentMark: ' ⚡urgent',
  browseHint: (offset: number) => `↑ browsing (${offset} lines from latest) · wheel/↑↓ move · PgUp/PgDn page · Esc or type to jump back`,
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
    restart: "restart an agent's CLI (with falinks config; add fresh = brand-new session)",
    todo: 'task list: add/list/rm/clear/start/stop/resume — runs tasks in order, unattended',
  } as Record<string, string>,

  // —— console/parse.ts ——
  usageRemove: 'usage: /remove <name>',
  usageRestart: 'usage: /restart <name> [fresh]',
  usageAdd: 'usage: /add <name> (pick cli and dir via wizard), or /add <name> <cli> <dir>',
  usageLang: 'Usage: /lang (pick from the menu)',
  usageLead: 'Usage: /lead (pick from the menu)',
  unknownCommand: (cmd: string) => `unknown command: /${cmd}`,
  usageMention: 'usage: @<name> <message> or @all <message>',
  usageUrgent: 'Urgent send: !@name msg · !msg (urgent reply) · !@all msg — skips the queue, delivered immediately; commands cannot be urgent',
  unknownError: 'unknown error',
  langFailed: 'lang switch failed',
  usageTodo: 'usage: /todo add <content> | list | rm <seq> | clear | start [nudge-minutes] | stop | resume',
  usageTodoAdd: 'usage: /todo add <task content> (may be multiline)',
  usageTodoRm: 'usage: /todo rm <seq>',
  usageTodoStart: 'usage: /todo start [progress check interval in minutes, positive integer, default 10]',
  usageLeadReset: 'Usage: /todo leadreset on|off|<positive int> (toggle lead periodic reset / set period K)',
  leadResetSet: (enabled: boolean, k: number) => `lead periodic reset: ${enabled ? 'on' : 'off'}, every ${k} tasks`,

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
    '④ When boss explicitly asks for todo-mode execution: call todoplan(tasks:[one per task]) to build the list after the plan is finalized → use ask(to:"boss") to confirm whether to start (include nudge intervals in the options, e.g. "start (nudge every 10 min) / start (nudge every 30 min) / not yet") → once boss agrees, call todostart(nudgeMinutes) to launch; after that report each completed task with taskdone(seq, status, result) and the system will dispatch the next one automatically. Never call todostart without boss approval; to revise a list you just built, pass todoplan(…, replace:true). In todo mode, each task dispatch resets the other workers to brand-new sessions — brief them fully, and only call taskdone after every dispatched worker has reported back. ' +
    '⑤ In todo mode you have a "project state doc" as cross-session memory: when advancing tasks the system may reset you to a fresh session and reload this doc, so always refresh it via leadstate(content) alongside each taskdone — goal/key decisions/done/next, kept concise — so a reset or restart resumes seamlessly. ' +
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
  askBlockedInTodo:
    '[todolist running · unattended] Asking the boss is disabled — nobody is watching to answer, and a question would stall the long-running task. Proceed with your best recommended option based on available info, and record your assumptions and trade-offs in the task result / project state doc.',
  toolDescWho: 'View the online roster',
  toolDescTaskdone: '[todolist only · lead only] report the current task finished: taskdone(seq, status:"done"|"failed", result). The system records it and dispatches the next task; report failures too — the list never stops.',
  toolDescTodoplan: '[todo mode · lead only] when boss explicitly asks for todo-mode execution, batch-create the finalized task breakdown: todoplan(tasks:[one per task], replace?). You MUST get boss approval via ask(to:"boss") before todostart; pass replace:true to revise a list you just created.',
  toolDescTodostart: '[todo mode · lead only] start the prepared task list: todostart(nudgeMinutes?). Requires explicit boss approval via ask first; resuming a paused list is the boss\'s call (/todo resume), not this tool.',
  toolDescTaskwait: '(lead only) Declare the current task is waiting on an external process (long script/CI/background tests); idle nudges pause for `minutes` (1-120). `reason` is shown to the boss. Still call taskdone when actually finished.',
  toolDescLeadstate: '[todo mode · lead only] Write/replace your "project state doc": leadstate(content). This is your cross-session memory — it is reloaded after a periodic reset or restart. Refresh it alongside each taskdone; keep it concise and curated (goal/scope, key decisions & rationale, conventions & gotchas, done, next), replacing the whole doc rather than appending a log.',
  leadResetSkippedNoDoc: '[lead reset skipped] Due for a periodic reset but the lead has no project state doc (leadstate) yet — skipping to avoid amnesia. Prompt the lead to maintain its memory via leadstate.',
  leadMemoryOff: 'Lead memory is off (config.todo.leadReset.enabled=false); leadstate had no effect.',

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

  // —— todolist message templates (dispatch/nudge sent as boss; summary sent as falinks) ——
  todoDispatchMsg: (seq: number, pos: number, total: number, body: string, isResend: boolean) =>
    `[Task #${seq} · ${pos}/${total}]${isResend ? ' (resend)' : ''} ${body}\n` +
    `You are the team lead (coordinator): decompose this task into subtasks and dispatch them via sendmsg to the right workers (frontend/backend/qa…); you only coordinate dependencies, track progress, and aggregate results — do not do the work yourself. ` +
    (isResend ? '' : '⚠ This round all workers are brand-new sessions with no memory — when dispatching, fully brief them on background, goals, and acceptance criteria. ') +
    `Done means: only after every worker you dispatched has finished and reported back do you call taskdone(seq:${seq}, status:"done"|"failed", result:"…"); the next task is dispatched only after that — reporting early would cut off their in-progress work. If waiting on a long script/external process, call taskwait(seq:${seq}, minutes:est, reason:"…"). Do not reply to this via sendmsg. [Unattended] At any decision point, proceed with your best recommended option and record assumptions/trade-offs in the result or project state doc — do NOT ask the boss (ask→boss is rejected while running); normal sendmsg communication with the team is fine meanwhile.`,
  todoNudgeMsg: (seq: number, pos: number, total: number, body: string, nextMinutes: number, escalated: boolean) =>
    `[Task #${seq} (${pos}/${total}) progress check] Everyone has been idle for a while with no report. Task: ${body}\n` +
    (escalated
      ? `If this task is actually finished, #${seq} is still open — call taskdone(seq:${seq}, status:"done"|"failed", result:"…") NOW;`
      : `If finished, call taskdone(seq:${seq}, status:"done"|"failed", result:"…");`) +
    ` if still in progress, carry on; if not yet dispatched, decompose and dispatch to workers; if waiting on a long script/external process, call taskwait(seq:${seq}, minutes:est, reason:"…"). Do not message teammates just because of this reminder. Next check in ${nextMinutes} min if unreported.`,
  todoSummaryTitle: (done: number, failed: number, total: number) => `[todolist finished] ${total} tasks: ✅ ${done} succeeded · ❌ ${failed} failed`,
  todoSummaryLine: (seq: number, ok: boolean, body: string, result: string) => `${ok ? '✅' : '❌'} #${seq} ${body} — ${result}`,
  todoPlannedMsg: (from: string, n: number) => `[todo mode] lead ${from} created a ${n}-task list — /todo list to review; the lead will start it after your approval (or run /todo start yourself).`,
  todoSuspendedMsg: '[todolist suspended] No lead assigned — task dispatch paused. Assign a lead with /lead and it will resume automatically.',
  todoWorkersTimeoutMsg: '[todolist] Some workers are not yet cleared/ready (wait timed out) — dispatching the current task to the lead anyway.',
  todoSendFailingMsg: '[todolist warning] Message delivery has failed repeatedly (guardrail or lead unreachable) — the list may be stalled, please investigate.',
  todoWaitingMsg: (seq: number, minutes: number, reason: string) =>
    `[todolist] lead declared an external wait${reason ? `: ${reason}` : ''}; nudges for task #${seq} paused for ${minutes} min.`,
  todoStalledMsg: (seq: number, n: number, intervalMinutes: number) =>
    `[todolist alert] Task #${seq}: ${n} consecutive checks with no report — likely finished-but-unclosed, or stalled; check interval backed off to ${intervalMinutes} min. Review /todo list; remind the lead to taskdone, or /todo stop.`,
  todoProgressLine: (k: number, total: number, body: string, paused: boolean) =>
    `📋 ${k}/${total} current: ${body}${paused ? ' [⏸ paused]' : ''}`,
  todoWaitSeg: (reason: string, until: string) => ` ⏳ waiting${reason ? `: ${reason}` : ''} (until ${until})`,
  todoPendingLine: (n: number) => `📋 ${n} task(s) queued, not started (/todo list to review)`,
  todoResumeHint: (left: number, total: number) => `Unfinished todolist detected (${left}/${total} tasks remaining) — /todo resume to continue`,
  todoListTitle: 'Task list (Esc to close)',
  todoListEmpty: '(empty) — /todo add <content> to add tasks',
  todoOpOk: (op: string) => `todo ${op} done`,
  todoAddOk: (seq: number) => `Task #${seq} added`,
  todoRemovedByBoss: 'removed by boss (skipped)',
};
