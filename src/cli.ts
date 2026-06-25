#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { up } from './index.js';
import { fetchLatest, isNewer, upgradeCommand } from './update.js';
import { resolveBus } from './discovery.js';
import { initLocale, setLocale, detectLocale, t } from './i18n/index.js';
import { loadSettings, saveSettings } from './settings.js';
import { DEFAULT_OFFICE, assertOfficeName, resolveConfigPath, listOffices } from './core/office.js';

const PKG: { name: string; version: string } = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  } catch {
    return { name: '@hklmtt/falinks', version: '' };
  }
})();

let cachedPort: number | null = null;
async function busPort(office: string = DEFAULT_OFFICE): Promise<number> {
  if (cachedPort) return cachedPort;
  const r = await resolveBus(process.cwd(), { office });
  if (!r.ok) { console.error(r.error); process.exit(1); }
  return (cachedPort = r.port);
}

async function admin(method: string, path: string, body?: unknown, office: string = DEFAULT_OFFICE) {
  const res = await fetch(`http://127.0.0.1:${await busPort(office)}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

const DEFAULT_CONFIG_PATH = 'falinks.config.json';

/** 从参数里抽出 `--office <name>`(校验合法、拒 default/非法),返回去掉它后的剩余参数。 */
function extractOffice(args: string[]): { office: string; rest: string[] } {
  const i = args.indexOf('--office');
  if (i < 0) return { office: DEFAULT_OFFICE, rest: args };
  const name = args[i + 1];
  if (!name) { console.error('--office 需要一个办公室名字'); process.exit(1); }
  try { assertOfficeName(name); } catch (e: any) { console.error(e.message); process.exit(1); }
  return { office: name, rest: args.slice(0, i).concat(args.slice(i + 2)) };
}

/** 有新版时返回更新提示数据(仅 TTY);否则 null。 */
async function maybeUpdate(): Promise<{ latest: string; current: string; pkg: string } | null> {
  if (process.stdin.isTTY && PKG.version) {
    const latest = await fetchLatest(PKG.name);
    if (latest && isNewer(latest, PKG.version)) return { latest, current: PKG.version, pkg: PKG.name };
  }
  return null;
}

/** 指定配置文件已有配置的员工名简述（如 "alice/bob"），无则 null。 */
function currentTeamLabel(configPath: string = DEFAULT_CONFIG_PATH): string | null {
  try {
    const c = JSON.parse(readFileSync(configPath, 'utf8'));
    const names = (c.agents ?? []).map((a: { name: string }) => a.name);
    return names.length ? names.join('/') : null;
  } catch {
    return null;
  }
}

/**
 * 选团队并落到配置文件。
 * update：有新版时先弹一屏（继续 / 退出去更新）。
 * TTY：每次都弹选单（已有配置则默认"继续当前"，回车秒过；选别的会覆盖配置）。
 * 非 TTY：无配置则写默认单员工，有配置则沿用。
 */
async function chooseTeam(update: { latest: string; current: string; pkg: string } | null = null, configPath: string = DEFAULT_CONFIG_PATH): Promise<void> {
  if (process.stdin.isTTY) {
    const { runSetup, QUIT_FOR_UPDATE } = await import('./setup/run.js');
    const cfg = await runSetup(process.cwd(), currentTeamLabel(configPath), update);
    if (cfg === QUIT_FOR_UPDATE) {
      console.log(t().exitUpdateHint(upgradeCommand(PKG.name)));
      process.exit(0);
    }
    if (cfg !== null) { // null=继续当前，不覆盖
      mkdirSync(dirname(configPath) || '.', { recursive: true }); // 具名办公室:首次自动建 .falinks/
      writeFileSync(configPath, JSON.stringify(cfg, null, 2));
    }
  } else if (!existsSync(configPath)) {
    writeDefaultConfig(configPath);
  }
}

/** 在指定路径写一份默认配置（一个 claude 员工，工作目录=当前目录；其余用 /add 自行添加）。 */
function writeDefaultConfig(configPath: string = DEFAULT_CONFIG_PATH): void {
  const cwd = process.cwd();
  const config = {
    agents: [
      { name: 'alice', cli: 'claude', cwd, bootstrap: t().defaultBootstrap },
    ],
    routes: {},
  };
  mkdirSync(dirname(configPath) || '.', { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

async function init() {
  await chooseTeam();
  console.log(t().configReady(DEFAULT_CONFIG_PATH));
}

/**
 * 裸 `falinks`:
 * - 非 TTY:旧行为(默认办公室,无配置则写默认后启动)。
 * - TTY 且本项目一个办公室都没有:旧行为(查更新 → 向导建默认办公室 → 启动)。
 * - TTY 且已有办公室:列出(默认 + .falinks/*)让用户选——运行中→连其控制台;已停→启动;或「＋新建」(问名→向导→启动)。
 */
async function runHere() {
  if (!process.stdin.isTTY) {
    if (!existsSync(DEFAULT_CONFIG_PATH)) writeDefaultConfig(DEFAULT_CONFIG_PATH);
    await up(DEFAULT_CONFIG_PATH);
    return;
  }

  // 查更新照旧:放在 picker 之前每次都跑(别因为进 picker 把它丢了)。
  const update = await maybeUpdate();

  const offices = listOffices(process.cwd());
  if (offices.length === 0) {
    // 一个办公室都没有 → 旧行为:(查更新提示由向导首屏承载)团队向导建默认办公室 → 启动。
    await chooseTeam(update, DEFAULT_CONFIG_PATH);
    await up(DEFAULT_CONFIG_PATH);
    return;
  }

  // 已有办公室:进 picker 之前先把"有新版"提示打出来(picker 本身不退出去更新,提示即可)。
  if (update) console.log(`${t().setupUpdateFound(update.latest, update.current)} — \`${upgradeCommand(update.pkg)}\``);

  const { runOfficePicker, runOfficeNamePrompt } = await import('./console/office-pick.js');
  const choice = await runOfficePicker(offices);
  if (!choice) return; // 取消

  if (choice.kind === 'open') {
    const e = choice.entry;
    if (e.running) {
      console.log(t().officeOpening(e.office));
      const r = await resolveBus(process.cwd(), { office: e.office });
      if (!r.ok) { console.error(r.error); process.exit(1); }
      const { renderConsole } = await import('./console/run.js');
      renderConsole(r.port);
    } else {
      console.log(t().officeStarting(e.office));
      await up(e.configPath, e.office);
    }
    return;
  }

  // ＋ 新建办公室:问名 → 向导写到 .falinks/<name>.config.json → 启动。
  const name = await runOfficeNamePrompt();
  if (!name) return;
  const cfgPath = resolveConfigPath(process.cwd(), name);
  await chooseTeam(update, cfgPath);
  if (!existsSync(cfgPath)) return; // 向导取消、未写配置 → 不启动
  await up(cfgPath, name);
}

function has(cmd: string): boolean {
  try { execSync(`command -v ${cmd}`, { stdio: 'ignore' }); return true; } catch { return false; }
}

function doctor() {
  const checks: [string, boolean, string][] = [
    ['Node ≥ 20', Number(process.versions.node.split('.')[0]) >= 20, process.versions.node],
    ['macOS', process.platform === 'darwin', process.platform],
    ['iTerm2', existsSync('/Applications/iTerm.app'), '/Applications/iTerm.app'],
    ['osascript', has('osascript'), ''],
    ['claude CLI', has('claude'), t().doctorClaudeNote],
    ['codex CLI', has('codex'), t().doctorCodexNote],
  ];
  for (const [name, ok, note] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${name}${note ? `  (${note})` : ''}`);
  }
  console.log(t().doctorPermHint);
}

async function main() {
  initLocale();
  const { office, rest: argv } = extractOffice(process.argv.slice(2));
  const [cmd, ...rest] = argv;
  if (!cmd) {
    // 裸 falinks = 在当前目录交互(选/建办公室)或一键运行
    await runHere();
    return;
  }
  switch (cmd) {
    case 'up': {
      if (office !== DEFAULT_OFFICE) {
        // 具名办公室:config = .falinks/<office>.config.json;不存在则走向导(TTY)/写默认(非 TTY)再启动。
        const cfgPath = resolveConfigPath(process.cwd(), office);
        if (!existsSync(cfgPath)) {
          if (process.stdin.isTTY) { await chooseTeam(null, cfgPath); if (!existsSync(cfgPath)) return; }
          else writeDefaultConfig(cfgPath);
        }
        await up(cfgPath, office);
      } else {
        const cfgPath = rest[0] ?? 'falinks.config.json';
        if (!existsSync(cfgPath)) {
          console.error(t().upConfigNotFound(cfgPath));
          process.exit(1);
        }
        await up(cfgPath);
      }
      break;
    }
    case 'console':
      await import('./console/main.js'); // console/main 自行解析 --office / --port
      break;
    case 'init':
      await init();
      break;
    case 'doctor':
      doctor();
      break;
    case 'lang': {
      if (process.stdin.isTTY) {
        const { runLangPicker } = await import('./lang/run.js');
        const cur = loadSettings().locale;
        const picked = await runLangPicker(cur);
        if (picked === null) return; // 取消
        const eff = picked === 'auto' ? detectLocale(process.env) : picked;
        saveSettings({ locale: picked });
        setLocale(eff);
        console.log(t().langSwitched(eff));
        // 若有运行中的实例,顺带切它(失败静默)
        const r = await resolveBus(process.cwd(), { office });
        if (r.ok) {
          try {
            await fetch(`http://127.0.0.1:${r.port}/admin/lang`, {
              method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: picked }),
            });
          } catch { /* 实例没在跑或切换失败,本地已落盘,忽略 */ }
        }
      } else {
        console.log(t().langCurrent(loadSettings().locale));
      }
      break;
    }
    case 'say': {
      const [to, ...msg] = rest;
      console.log(await admin('POST', '/admin/say', { to, message: msg.join(' ') }, office));
      break;
    }
    case 'broadcast':
      console.log(await admin('POST', '/admin/broadcast', { message: rest.join(' ') }, office));
      break;
    case 'roster':
      console.log(JSON.stringify(await admin('GET', '/admin/roster', undefined, office), null, 2));
      break;
    case 'log':
      console.log(JSON.stringify(await admin('GET', '/admin/log', undefined, office), null, 2));
      break;
    default:
      console.log(t().defaultHelp + '\n' + t().optOffice);
      process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
