import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { parseConsoleInput } from './parse.js';

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

  const onSubmit = async (line: string) => {
    setInput('');
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
      <Box marginTop={1}><Text color="green">› </Text><TextInput value={input} onChange={setInput} onSubmit={onSubmit} /></Box>
      {status ? <Text dimColor>{status}</Text> : null}
    </Box>
  );
}
