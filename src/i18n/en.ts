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
  moreLines: (n: number, from: string) => `… +${n} lines (see ${from} window for the full text)`,
  inputHint: (target: string) => `Type = reply to @${target} · @all broadcast · @name DM · \\\\+Enter newline · / command`,
  noReplyTargetShort: '(none · @someone first)',
  broadcastAllHint: 'broadcast to everyone',

  // —— console/commands.ts ——
  cmdHint: {
    add: 'add a worker',
    remove: 'remove a worker',
    clear: "clear a worker's context, no name = everyone",
    help: 'show usage',
  } as Record<string, string>,

  // —— console/parse.ts ——
  usageRemove: 'usage: /remove <name>',
  usageAdd: 'usage: /add <name> (pick cli and dir via wizard), or /add <name> <cli> <dir>',
  unknownCommand: (cmd: string) => `unknown command: /${cmd}`,
  usageMention: 'usage: @<name> <message> or @all <message>',
  unknownError: 'unknown error',

  // —— cli.ts ——
  exitUpdateHint: (cmd: string) => `Exited. Update command: ${cmd}`,
  defaultBootstrap: 'You are an AI worker in the office, concise in style.',
  configReady: (path: string) => `✅ Config ready (${path}). Run: falinks`,
  doctorClaudeNote: 'optional (needed for claude workers)',
  doctorCodexNote: 'optional (needed for codex workers)',
  doctorPermHint: 'Tip: the first run pops an "Automation" permission request — allow iTerm to be controlled.',
  upConfigNotFound: (path: string) =>
    `Config ${path} not found.\nRun \`falinks init\` in the current directory to generate a default config, or pass a path: falinks up <config.json>`,
  defaultHelp:
    'falinks — orchestrate several AI CLIs into one office in the current directory.\n' +
    'Run directly:  falinks            (generates config and starts on first run)\n' +
    'Subcommands:   falinks init | doctor | up [config] | say <agent> <msg> | broadcast <msg> | roster | log',

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
  setupSaveTeamName: 'Save as a team template, give it a name: ',
  setupDefaultRole: 'worker',
};
