import React, { useEffect, useState } from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { Box, Text, useInput } from 'ink';
import { parseConsoleInput } from './parse.js';
import { mentionState, applyMention } from './mention.js';
import { commandState, applyCommand } from './commands.js';
import { CLIS, dirSuggestions } from './wizard.js';
import { fetchLatest, isNewer } from '../update.js';
import { saveClipboardImage, expandImageTokens } from './clipboard.js';

const PKG: { name: string; version: string } = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  } catch {
    return { name: '@liujia307/falinks', version: '' };
  }
})();
const VERSION = PKG.version;

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
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [sel, setSel] = useState(0);
  const [status, setStatus] = useState('');
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const [tagline] = useState(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)]);
  const [update, setUpdate] = useState<string | null>(null);
  const defaultCwd = process.cwd();

  useEffect(() => {
    void fetchLatest(PKG.name).then((latest) => {
      if (latest && VERSION && isNewer(latest, VERSION)) setUpdate(latest);
    });
  }, []);

  useEffect(() => {
    const tick = async () => {
      try {
        const r = await admin(port, 'GET', '/admin/roster');
        setRoster(r.roster ?? []);
        const l = await admin(port, 'GET', '/admin/log');
        setLog((l.log ?? []).slice(-10));
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

  // 统一的补全下拉：/ 命令优先，否则 @ 成员（排除 boss 等虚拟成员——你自己就是 boss）
  const names = roster.filter((a) => !a.virtual).map((a) => a.name);
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

    // Ctrl+V：读系统剪贴板里的截图，存临时文件，输入框只插入短占位 [图片N]（发送时展开成真实路径）
    if (key.ctrl && (char === 'v' || char === 'V')) {
      void saveClipboardImage().then((p) => {
        if (!p) { setStatus('剪贴板里没有图片'); return; }
        const token = `[图片${attachments.length + 1}]`;
        setAttachments((a) => [...a, p]);
        setInput((v) => v.slice(0, cursor) + token + ' ' + v.slice(cursor));
        setCursor((c) => c + token.length + 1);
        setStatus(`📎 已附加 ${token}，加 @员工 后回车，员工会去读这张图`);
      });
      return;
    }

    if (active) {
      if (key.upArrow) { setSel((s) => Math.max(0, s - 1)); return; }
      if (key.downArrow) { setSel((s) => Math.min(items.length - 1, s + 1)); return; }
      if (key.tab || key.return) { const c = complete!(selClamped); setInput(c); setCursor(c.length); setSel(0); return; }
    }

    if (key.leftArrow) { setCursor((c) => Math.max(0, c - 1)); return; }
    if (key.rightArrow) { setCursor((c) => Math.min(input.length, c + 1)); return; }

    if (key.upArrow) {
      // 历史：上一条
      if (history.length) {
        const ni = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
        setHistIdx(ni); setInput(history[ni]); setCursor(history[ni].length);
      }
      return;
    }
    if (key.downArrow) {
      // 历史：下一条（到底则清空）
      if (histIdx !== null) {
        const ni = histIdx + 1;
        if (ni >= history.length) { setHistIdx(null); setInput(''); setCursor(0); }
        else { setHistIdx(ni); setInput(history[ni]); setCursor(history[ni].length); }
      }
      return;
    }

    if (key.return) {
      const line = expandImageTokens(input, attachments); // [图片N] → 真实路径
      const shown = input;
      setInput(''); setCursor(0); setSel(0); setHistIdx(null); setAttachments([]);
      if (shown.trim()) setHistory((h) => [...h, shown]);
      void dispatch(line);
      return;
    }
    if (key.backspace || key.delete) {
      if (cursor > 0) { setInput((v) => v.slice(0, cursor - 1) + v.slice(cursor)); setCursor((c) => c - 1); setSel(0); }
      return;
    }
    if (char && !key.ctrl && !key.meta && !key.escape && !key.tab) {
      setInput((v) => v.slice(0, cursor) + char + v.slice(cursor));
      setCursor((c) => c + char.length);
      setSel(0);
      return;
    }
  });

  const color = (s: string) => (s === 'idle' ? 'green' : s === 'busy' ? 'yellow' : s === 'dead' ? 'red' : 'gray');

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column">
        <Text color="cyan" bold>╔═╗╔═╗╦  ╦╔╗╔╦╔═╔═╗</Text>
        <Text color="cyan" bold>╠╣ ╠═╣║  ║║║║╠╩╗╚═╗</Text>
        <Text color="cyan" bold>╚  ╩ ╩╩═╝╩╝╚╝╩ ╩╚═╝</Text>
        <Text dimColor>v{VERSION} · {tagline}</Text>
        {update ? (
          <Text color="yellow">🆕 有新版 {update}（当前 v{VERSION}）· 更新：sudo npm i -g {PKG.name}</Text>
        ) : null}
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
          <Text key={i}><Text color="cyan">{m.from}</Text>→<Text color="magenta">{m.to}</Text>: {String(m.body).replace(/\s+/g, ' ').trim().slice(0, 300)}</Text>
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
          <Box marginTop={1}>
            <Text color="green">› </Text>
            <Text>{input.slice(0, cursor)}</Text>
            <Text inverse>{input[cursor] ?? ' '}</Text>
            <Text>{input.slice(cursor + 1)}</Text>
          </Box>
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
