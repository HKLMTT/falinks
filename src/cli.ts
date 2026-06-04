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

function init() {
  const path = 'falinks.config.json';
  if (existsSync(path)) {
    console.log(`${path} 已存在，未覆盖。直接 \`falinks up\` 即可。`);
    return;
  }
  const cwd = process.cwd();
  const config = {
    busPort: 7878,
    agents: [
      { name: 'alice', cli: 'claude', cwd, role: 'manager', bootstrap: '你负责统筹与任务分配，风格简练。' },
      { name: 'bob', cli: 'claude', cwd, role: 'dev', bootstrap: '你负责写代码与查证，风格简练。' },
    ],
    routes: { manager: 'alice' },
  };
  writeFileSync(path, JSON.stringify(config, null, 2));
  console.log(
    `✅ 已生成 ${path}（两个 claude 员工 alice/bob，工作目录=当前目录）。\n` +
      `   下一步：falinks up\n` +
      `   想改员工/换 codex/换目录，编辑 ${path} 即可。`,
  );
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
      init();
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
      console.log('用法: falinks <up [config]|console|init|doctor|say <agent> <msg>|broadcast <msg>|roster|log>');
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
