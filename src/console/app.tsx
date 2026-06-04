import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { parseConsoleInput } from './parse.js';
import { mentionState, applyMention } from './mention.js';
import { commandState, applyCommand } from './commands.js';

async function admin(port: number, method: string, path: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export function App({ port }: { port: number }) {
  const [roster, setRoster] = useState<any[]>([]);
  const [log, setLog] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [sel, setSel] = useState(0);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const tick = async () => {
      try {
        const r = await admin(port, 'GET', '/admin/roster');
        setRoster(r.roster ?? []);
        const l = await admin(port, 'GET', '/admin/log');
        setLog((l.log ?? []).slice(-15));
      } catch {
        /* up 还没起或断开，忽略 */
      }
    };
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, [port]);

  const dispatch = async (line: string) => {
    const a = parseConsoleInput(line);
    try {
      if (a.kind === 'noop') return;
      if (a.kind === 'help') { setStatus('@name 私聊 · 纯文本群发 · /add <name> <cli> <cwd> · /remove <name>'); return; }
      if (a.kind === 'error') { setStatus('⚠ ' + a.message); return; }
      if (a.kind === 'say') { await admin(port, 'POST', '/admin/say', { to: a.to, message: a.message }); setStatus(`→ ${a.to}`); return; }
      if (a.kind === 'broadcast') { await admin(port, 'POST', '/admin/broadcast', { message: a.message }); setStatus('→ 全员'); return; }
      if (a.kind === 'add') { const r = await admin(port, 'POST', '/admin/add', a.spec); setStatus(r.ok ? `＋ ${a.spec.name}` : '⚠ ' + (r.error ?? 'add 失败')); return; }
      if (a.kind === 'remove') { const r = await admin(port, 'POST', '/admin/remove', { name: a.name }); setStatus(r.ok ? `－ ${a.name}` : '⚠ ' + (r.error ?? 'remove 失败')); return; }
    } catch (e: any) {
      setStatus('⚠ ' + (e?.message ?? 'error'));
    }
  };

  // 统一的补全下拉：/ 命令优先，否则 @ 成员
  const names = roster.map((a) => a.name);
  const cmd = commandState(input);
  const mention = mentionState(input, names);
  let items: { label: string; hint: string }[] = [];
  let complete: ((i: number) => string) | null = null;
  if (cmd.active) {
    items = cmd.matches.map((c) => ({ label: c.usage, hint: c.hint }));
    complete = (i) => applyCommand(cmd.matches[i].name);
  } else if (mention.active) {
    items = mention.matches.map((n) => ({ label: '@' + n, hint: '' }));
    complete = (i) => applyMention(input, mention.matches[i]);
  }
  const active = complete !== null && items.length > 0;
  const selClamped = Math.min(sel, Math.max(0, items.length - 1));

  useInput((char, key) => {
    if (active) {
      if (key.upArrow) { setSel((s) => Math.max(0, s - 1)); return; }
      if (key.downArrow) { setSel((s) => Math.min(items.length - 1, s + 1)); return; }
      if (key.tab || key.return) { setInput(complete!(selClamped)); setSel(0); return; }
    }
    if (key.return) { const line = input; setInput(''); setSel(0); void dispatch(line); return; }
    if (key.backspace || key.delete) { setInput((v) => v.slice(0, -1)); setSel(0); return; }
    if (char && !key.ctrl && !key.meta && !key.escape && !key.tab) { setInput((v) => v + char); setSel(0); return; }
  });

  const color = (s: string) => (s === 'idle' ? 'green' : s === 'busy' ? 'yellow' : s === 'dead' ? 'red' : 'gray');

  return (
    <Box flexDirection="column" height="100%">
      <Text bold>dagent 控制台</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text underline>花名册</Text>
        {roster.map((a) => (
          <Text key={a.name} color={color(a.status)}>{a.virtual ? '·' : '●'} {a.name} <Text dimColor>{a.role ?? ''} [{a.status}]</Text></Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        <Text underline>消息</Text>
        {log.map((m, i) => (
          <Text key={i}><Text color="cyan">{m.from}</Text>→<Text color="magenta">{m.to}</Text>: {String(m.body).split('\n')[0].slice(0, 60)}</Text>
        ))}
      </Box>
      <Box marginTop={1}><Text color="green">› </Text><Text>{input}</Text><Text inverse> </Text></Box>
      {active ? (
        <Box flexDirection="column">
          {items.map((it, i) => (
            <Text key={it.label} inverse={i === selClamped}>  {it.label}{it.hint ? '   ' + it.hint : ''}</Text>
          ))}
        </Box>
      ) : (
        <Text dimColor>输入 @ 提及成员 · / 查看命令 · 直接打字=群发 · Tab/Enter 补全</Text>
      )}
      {status ? <Text dimColor>{status}</Text> : null}
    </Box>
  );
}
