import { readFileSync } from 'node:fs';
import { up } from './index.js';

function runtimePort(): number {
  try {
    return JSON.parse(readFileSync('.dagent-runtime.json', 'utf8')).port;
  } catch {
    console.error('找不到 .dagent-runtime.json —— dagent up 在运行吗？');
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

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'up':
      await up(rest[0] ?? 'dagent.config.json');
      break;
    case 'console': {
      await import('./console/main.js');
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
      console.log('用法: dagent <up|console|say <agent> <msg>|broadcast <msg>|roster|log>');
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
