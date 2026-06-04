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

/** 交互选择团队（TTY）则走 Ink 向导，否则回退默认单员工配置；把结果写入配置文件。 */
async function chooseAndWriteConfig(): Promise<void> {
  if (process.stdin.isTTY) {
    const { runSetup } = await import('./setup/run.js');
    const cfg = await runSetup(process.cwd());
    writeFileSync(DEFAULT_CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } else {
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
  if (existsSync(DEFAULT_CONFIG_PATH)) {
    console.log(`${DEFAULT_CONFIG_PATH} 已存在，未覆盖。直接 \`falinks\` 即可运行。`);
    return;
  }
  await chooseAndWriteConfig();
  console.log(`✅ 已生成 ${DEFAULT_CONFIG_PATH}。运行：falinks（起来后控制台可 /add 加员工、编辑配置改团队）。`);
}

/** 裸 `falinks` 的一键运行：有配置就起；没配置就先选团队（向导）再起。 */
async function runHere() {
  if (!existsSync(DEFAULT_CONFIG_PATH)) {
    await chooseAndWriteConfig();
  }
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
