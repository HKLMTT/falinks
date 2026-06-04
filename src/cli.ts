#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { up } from './index.js';
import { runtimePath } from './runtime.js';

function runtimePort(): number {
  try {
    return JSON.parse(readFileSync(runtimePath(), 'utf8')).port;
  } catch {
    console.error('找不到 falinks 运行时状态 —— `falinks up` 在运行吗？');
    process.exit(1);
  }
}

async function admin(method: string, path: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${runtimePort()}${path}`, {
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
 * TTY：每次都弹选单（已有配置则默认"继续当前"，回车秒过；选别的会覆盖配置）。
 * 非 TTY：无配置则写默认单员工，有配置则沿用。
 */
async function chooseTeam(): Promise<void> {
  if (process.stdin.isTTY) {
    const { runSetup } = await import('./setup/run.js');
    const cfg = await runSetup(process.cwd(), currentTeamLabel());
    if (cfg !== null) writeFileSync(DEFAULT_CONFIG_PATH, JSON.stringify(cfg, null, 2)); // null=继续当前，不覆盖
  } else if (!existsSync(DEFAULT_CONFIG_PATH)) {
    writeDefaultConfig();
  }
}

/** 在当前目录写一份默认配置（一个 claude 员工，工作目录=当前目录；其余用 /add 自行添加）。 */
function writeDefaultConfig(): void {
  const cwd = process.cwd();
  const config = {
    busPort: 7878,
    agents: [
      { name: 'alice', cli: 'claude', cwd, bootstrap: '你是办公室里的 AI 员工，风格简练。' },
    ],
    routes: {},
  };
  writeFileSync(DEFAULT_CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function init() {
  await chooseTeam();
  console.log(`✅ 配置已就绪（${DEFAULT_CONFIG_PATH}）。运行：falinks`);
}

/** 裸 `falinks` 的一键运行：每次都先选团队（默认沿用当前），再起。 */
async function runHere() {
  await chooseTeam();
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
    ['claude CLI', has('claude'), '可选（claude 员工需要）'],
    ['codex CLI', has('codex'), '可选（codex 员工需要）'],
  ];
  for (const [name, ok, note] of checks) {
    console.log(`${ok ? '✅' : '❌'} ${name}${note ? `  (${note})` : ''}`);
  }
  console.log('提示：首次运行会弹"自动化"权限请求，需允许 iTerm 被控制。');
}

async function main() {
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
        console.error(`没找到配置 ${cfgPath}。\n先在当前目录运行 \`falinks init\` 生成默认配置，或指定路径：falinks up <config.json>`);
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
      console.log(
        'falinks — 在当前目录把多个 AI CLI 编排成一间办公室。\n' +
          '直接运行：  falinks            （首次自动生成配置并启动）\n' +
          '子命令：    falinks init | doctor | up [config] | say <agent> <msg> | broadcast <msg> | roster | log',
      );
      process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
