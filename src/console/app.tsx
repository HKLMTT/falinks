import React, { useEffect, useState } from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { Box, Text, useInput } from 'ink';
import { parseConsoleInput } from './parse.js';
import { mentionState, applyMention } from './mention.js';
import { commandState, applyCommand } from './commands.js';
import { CLIS, dirSuggestions } from './wizard.js';

const VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '';
  }
})();

const TAGLINES = [
  '一屋 AI 牛马，您只管动嘴 🐴',
  '活归它们，功归你 🐴',
  '不喊累不要钱的 AI 牛马天团',
  '您发句话，牛马跑断腿',
  'AI 牛马已就位，老板请下令',
  '招了一窝电子牛马',
  '您动嘴，它们秃头',
  '7×24 AI 牛马，永不摸鱼（大概）',
  '老板一句话，牛马忙到趴',
];

async function admin(port: number, method: string, path: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function fsListDirs(base: string): string[] {
  try {
    return readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

type WizardState =
  | { name: string; step: 'cli'; sel: number }
  | { name: string; step: 'role'; cli: string; roleText: string }
  | { name: string; step: 'cwd'; cli: string; role: string; path: string; sel: number };

export function App({ port }: { port: number }) {
  const [roster, setRoster] = useState<any[]>([]);
  const [log, setLog] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [sel, setSel] = useState(0);
  const [status, setStatus] = useState('');
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const [tagline] = useState(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)]);
  const defaultCwd = process.cwd();

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
      if (a.kind === 'help') { setStatus('@名字 私聊 · 纯文本群发 · /add 加员工(向导) · /remove 删员工'); return; }
      if (a.kind === 'error') { setStatus('⚠ ' + a.message); return; }
      if (a.kind === 'add-start') { setWizard({ name: a.name, step: 'cli', sel: 0 }); return; }
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
    // 向导模式：优先处理
    if (wizard) {
      if (key.escape) { setWizard(null); setStatus('已取消添加'); return; }
      if (wizard.step === 'cli') {
        if (key.upArrow) { setWizard({ ...wizard, sel: Math.max(0, wizard.sel - 1) }); return; }
        if (key.downArrow) { setWizard({ ...wizard, sel: Math.min(CLIS.length - 1, wizard.sel + 1) }); return; }
        if (key.return || key.tab) { setWizard({ name: wizard.name, step: 'role', cli: CLIS[wizard.sel], roleText: '' }); return; }
        return;
      }
      if (wizard.step === 'role') {
        if (key.return) { setWizard({ name: wizard.name, step: 'cwd', cli: wizard.cli, role: wizard.roleText.trim() || '员工', path: defaultCwd, sel: 0 }); return; }
        if (key.backspace || key.delete) { setWizard({ ...wizard, roleText: wizard.roleText.slice(0, -1) }); return; }
        if (char && !key.ctrl && !key.meta && !key.escape && !key.tab) { setWizard({ ...wizard, roleText: wizard.roleText + char }); return; }
        return;
      }
      const sugs = dirSuggestions(wizard.path, fsListDirs);
      if (key.upArrow) { setWizard({ ...wizard, sel: Math.max(0, wizard.sel - 1) }); return; }
      if (key.downArrow) { setWizard({ ...wizard, sel: Math.min(Math.max(0, sugs.length - 1), wizard.sel + 1) }); return; }
      if (key.tab) { if (sugs.length) setWizard({ ...wizard, path: sugs[Math.min(wizard.sel, sugs.length - 1)] + '/', sel: 0 }); return; }
      if (key.return) {
        const w = wizard;
        setWizard(null);
        void (async () => {
          const r = await admin(port, 'POST', '/admin/add', { name: w.name, cli: w.cli, cwd: w.path, role: w.role });
          setStatus(r.ok ? `＋ ${w.name}(${w.role}) @ ${w.path}` : '⚠ ' + (r.error ?? 'add 失败'));
        })();
        return;
      }
      if (key.backspace || key.delete) { setWizard({ ...wizard, path: wizard.path.slice(0, -1), sel: 0 }); return; }
      if (char && !key.ctrl && !key.meta) { setWizard({ ...wizard, path: wizard.path + char, sel: 0 }); return; }
      return;
    }

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
      <Box flexDirection="column">
        <Text color="cyan" bold>╔═╗╔═╗╦  ╦╔╗╔╦╔═╔═╗</Text>
        <Text color="cyan" bold>╠╣ ╠═╣║  ║║║║╠╩╗╚═╗</Text>
        <Text color="cyan" bold>╚  ╩ ╩╩═╝╩╝╚╝╩ ╩╚═╝</Text>
        <Text dimColor>v{VERSION} · {tagline}</Text>
      </Box>
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

      {wizard ? (
        <Box flexDirection="column" marginTop={1}>
          {wizard.step === 'cli' ? (
            <>
              <Text>添加员工 <Text bold>{wizard.name}</Text> — 选择 CLI（↑↓ 选 · Enter 下一步 · Esc 取消）</Text>
              {CLIS.map((c, i) => (
                <Text key={c} inverse={i === wizard.sel}>  {c}{c === 'codex' ? '  (实验)' : ''}</Text>
              ))}
            </>
          ) : wizard.step === 'role' ? (
            <>
              <Text>添加员工 <Text bold>{wizard.name}</Text> [{wizard.cli}] — 角色/职责（Enter 下一步 · Esc 取消）</Text>
              <Box><Text color="green">› </Text><Text>{wizard.roleText}</Text><Text inverse> </Text></Box>
              <Text dimColor>例：负责后端开发 / 审查代码 / 调研查证。留空=通用员工。</Text>
            </>
          ) : (
            <>
              <Text>添加员工 <Text bold>{wizard.name}</Text> [{wizard.cli}·{wizard.role}] — 工作目录（Enter 确认 · Tab 补全 · Esc 取消）</Text>
              <Box><Text color="green">› </Text><Text>{wizard.path}</Text><Text inverse> </Text></Box>
              {dirSuggestions(wizard.path, fsListDirs).map((d, i) => (
                <Text key={d} inverse={i === wizard.sel}>  {d}</Text>
              ))}
              <Text dimColor>默认=当前目录，直接 Enter 即用它（多数情况员工同目录）</Text>
            </>
          )}
        </Box>
      ) : (
        <>
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
        </>
      )}
      {status ? <Text dimColor>{status}</Text> : null}
    </Box>
  );
}
