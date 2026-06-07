#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { up } from './index.js';
import { fetchLatest, isNewer, upgradeCommand } from './update.js';
import { resolveBus } from './discovery.js';
import { initLocale, setLocale, detectLocale, t } from './i18n/index.js';
import { loadSettings, saveSettings } from './settings.js';

const PKG: { name: string; version: string } = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  } catch {
    return { name: '@hklmtt/falinks', version: '' };
  }
})();

let cachedPort: number | null = null;
async function busPort(): Promise<number> {
  if (cachedPort) return cachedPort;
  const r = await resolveBus(process.cwd());
  if (!r.ok) { console.error(r.error); process.exit(1); }
  return (cachedPort = r.port);
}

async function admin(method: string, path: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${await busPort()}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

const DEFAULT_CONFIG_PATH = 'falinks.config.json';

/** 当前目录已有配置的员工名简述（如 "alice/bob"），无则 null。 */
function currentTeamLabel(): string | null {
  try {
    const c = JSON.parse(readFileSync(DEFAULT_CONFIG_PATH, 'utf8'));
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
async function chooseTeam(update: { latest: string; current: string; pkg: string } | null = null): Promise<void> {
  if (process.stdin.isTTY) {
    const { runSetup, QUIT_FOR_UPDATE } = await import('./setup/run.js');
    const cfg = await runSetup(process.cwd(), currentTeamLabel(), update);
    if (cfg === QUIT_FOR_UPDATE) {
      console.log(t().exitUpdateHint(upgradeCommand(PKG.name)));
      process.exit(0);
    }
    if (cfg !== null) writeFileSync(DEFAULT_CONFIG_PATH, JSON.stringify(cfg, null, 2)); // null=继续当前，不覆盖
  } else if (!existsSync(DEFAULT_CONFIG_PATH)) {
    writeDefaultConfig();
  }
}

/** 在当前目录写一份默认配置（一个 claude 员工，工作目录=当前目录；其余用 /add 自行添加）。 */
function writeDefaultConfig(): void {
  const cwd = process.cwd();
  const config = {
    agents: [
      { name: 'alice', cli: 'claude', cwd, bootstrap: t().defaultBootstrap },
    ],
    routes: {},
  };
  writeFileSync(DEFAULT_CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function init() {
  await chooseTeam();
  console.log(t().configReady(DEFAULT_CONFIG_PATH));
}

/** 裸 `falinks` 的一键运行：先查更新（有则问继续/退出去更新），再选团队（默认沿用当前），再起。 */
async function runHere() {
  let update: { latest: string; current: string; pkg: string } | null = null;
  if (process.stdin.isTTY && PKG.version) {
    const latest = await fetchLatest(PKG.name);
    if (latest && isNewer(latest, PKG.version)) update = { latest, current: PKG.version, pkg: PKG.name };
  }
  await chooseTeam(update);
  await up(DEFAULT_CONFIG_PATH);
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
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) {
    // 裸 falinks = 在当前目录一键运行
    await runHere();
    return;
  }
  switch (cmd) {
    case 'up': {
      const cfgPath = rest[0] ?? 'falinks.config.json';
      if (!existsSync(cfgPath)) {
        console.error(t().upConfigNotFound(cfgPath));
        process.exit(1);
      }
      await up(cfgPath);
      break;
    }
    case 'console':
      await import('./console/main.js');
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
        const r = await resolveBus(process.cwd());
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
      console.log(await admin('POST', '/admin/say', { to, message: msg.join(' ') }));
      break;
    }
    case 'broadcast':
      console.log(await admin('POST', '/admin/broadcast', { message: rest.join(' ') }));
      break;
    case 'roster':
      console.log(JSON.stringify(await admin('GET', '/admin/roster'), null, 2));
      break;
    case 'log':
      console.log(JSON.stringify(await admin('GET', '/admin/log'), null, 2));
      break;
    default:
      console.log(t().defaultHelp);
      process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
