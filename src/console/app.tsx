import React, { useEffect, useRef, useState } from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { Box, Text, useInput, useStdin } from 'ink';
import { parseConsoleInput, lastReplyTarget } from './parse.js';
import { mentionState, applyMention } from './mention.js';
import { commandState, applyCommand } from './commands.js';
import { CLIS, dirSuggestions } from './wizard.js';
import { formatBody, nameColor, formatTime } from './log-format.js';
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
  const [questions, setQuestions] = useState<any[]>([]);
  const [qSel, setQSel] = useState(0);
  const [skippedQ, setSkippedQ] = useState<string | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [tagline] = useState(() => TAGLINES[Math.floor(Math.random() * TAGLINES.length)]);
  const defaultCwd = process.cwd();

  // 物理 Home/End + Shift+Enter：Ink 不把它们传给 useInput，只能直接听 stdin 的转义序列。用 ref 取事件发生时的输入/光标。
  const io = useRef({ input: '', cursor: 0 });
  io.current = { input, cursor };
  const { stdin } = useStdin();
  useEffect(() => {
    if (!stdin) return;
    const onData = (d: Buffer | string) => {
      const s = d.toString();
      if (s === '\x1b[H' || s === '\x1bOH' || s === '\x1b[1~' || s === '\x1b[7~') setCursor(0);
      else if (s === '\x1b[F' || s === '\x1bOF' || s === '\x1b[4~' || s === '\x1b[8~') setCursor(io.current.input.length);
    };
    stdin.on('data', onData);
    return () => { stdin.off('data', onData); };
  }, [stdin]);

  useEffect(() => {
    const tick = async () => {
      try {
        const r = await admin(port, 'GET', '/admin/roster');
        setRoster(r.roster ?? []);
        const l = await admin(port, 'GET', '/admin/log');
        setLog((l.log ?? []).slice(-10));
        const q = await admin(port, 'GET', '/admin/questions');
        setQuestions(q.questions ?? []);
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
      if (a.kind === 'help') { setStatus('@名字 私聊 · @all 群发 · 纯文本=回复上次对话目标 · /add 加员工 · /remove 删员工 · /clear [名字] 清空上下文'); return; }
      if (a.kind === 'error') { setStatus('⚠ ' + a.message); return; }
      if (a.kind === 'add-start') { setWizard({ name: a.name, step: 'cli', sel: 0 }); return; }
      if (a.kind === 'say') { const r = await admin(port, 'POST', '/admin/say', { to: a.to, message: a.message }); setStatus(r.ok ? `→ ${a.to}` : '⚠ 未送达 ' + a.to + '：' + (r.error ?? '被护栏拦截')); return; }
      if (a.kind === 'broadcast') { await admin(port, 'POST', '/admin/broadcast', { message: a.message }); setStatus('→ 全员'); return; }
      if (a.kind === 'reply') {
        const target = lastReplyTarget(log);
        if (!target) { setStatus('没有上次对话目标，请 @某人 私聊 或 @all 群发'); return; }
        const r = await admin(port, 'POST', '/admin/say', { to: target, message: a.message });
        setStatus(r.ok ? `→ ${target}（回复）` : `⚠ 未送达 ${target}：${r.error ?? '被护栏拦截'}`);
        return;
      }
      if (a.kind === 'add') { const r = await admin(port, 'POST', '/admin/add', a.spec); setStatus(r.ok ? `＋ ${a.spec.name}` : '⚠ ' + (r.error ?? 'add 失败')); return; }
      if (a.kind === 'remove') { const r = await admin(port, 'POST', '/admin/remove', { name: a.name }); setStatus(r.ok ? `－ ${a.name}` : '⚠ ' + (r.error ?? 'remove 失败')); return; }
      if (a.kind === 'clear') {
        const r = await admin(port, 'POST', '/admin/clear', { name: a.name });
        setStatus(r.ok ? `🧹 已清空 ${a.name ?? '全员'}（${(r.cleared ?? []).join('、') || '无'}）` : '⚠ ' + (r.error ?? 'clear 失败'));
        return;
      }
    } catch (e: any) {
      setStatus('⚠ ' + (e?.message ?? 'error'));
    }
  };

  // 统一的补全下拉：/ 命令优先，否则 @ 成员（含 all 群发；排除 boss 等虚拟成员——你自己就是 boss）
  const names = ['all', ...roster.filter((a) => !a.virtual).map((a) => a.name)];
  const replyTarget = lastReplyTarget(log);
  const cmd = commandState(input);
  const mention = mentionState(input, names);
  let items: { label: string; hint: string }[] = [];
  let complete: ((i: number) => string) | null = null;
  if (cmd.active) {
    items = cmd.matches.map((c) => ({ label: c.usage, hint: c.hint }));
    complete = (i) => applyCommand(cmd.matches[i].name);
  } else if (mention.active) {
    items = mention.matches.map((n) => ({ label: '@' + n, hint: n === 'all' ? '群发全员' : '' }));
    complete = (i) => applyMention(input, mention.matches[i]);
  }
  const active = complete !== null && items.length > 0;
  const selClamped = Math.min(sel, Math.max(0, items.length - 1));

  // 待答的选择题（跳过的不抢）：输入空 + 非向导时进入"答题"态
  const pendingQ = questions.find((q) => q.id !== skippedQ) ?? null;
  const answering = !!pendingQ && input === '' && !wizard;
  const qSelClamped = pendingQ ? Math.min(qSel, Math.max(0, pendingQ.options.length - 1)) : 0;

  useInput((char, key) => {
    // Ctrl+C：不直接退，先问是否关闭员工窗口（优先于一切）。
    if (confirmExit) {
      if (key.escape) { setConfirmExit(false); return; }
      if (key.return || char === 'y' || char === 'Y' || char === 'n' || char === 'N') {
        const closePanes = !(char === 'n' || char === 'N'); // n=保留窗口；y/Enter=关闭
        void (async () => {
          try { await admin(port, 'POST', '/admin/shutdown', { closePanes }); } catch { /* ignore */ }
          process.exit(0);
        })();
        return;
      }
      return; // 确认中，吞掉其它键
    }
    if (key.ctrl && (char === 'c' || char === 'C')) { setConfirmExit(true); return; }

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

    // 答题态：有待答选择题且输入框为空 → ↑↓ 选项、Enter 回复、Esc 跳过；一打字就让位给普通输入。
    if (answering && pendingQ) {
      if (key.upArrow) { setQSel((s) => Math.max(0, s - 1)); return; }
      if (key.downArrow) { setQSel((s) => Math.min(pendingQ.options.length - 1, s + 1)); return; }
      if (key.return) {
        const id = pendingQ.id; const from = pendingQ.from; const choice = qSelClamped; const picked = pendingQ.options[choice];
        setQSel(0);
        void (async () => {
          await admin(port, 'POST', '/admin/answer', { id, choice });
          setStatus(`✓ 已回复 ${from}：${picked}`);
        })();
        return;
      }
      if (key.escape) { setSkippedQ(pendingQ.id); return; }
      // 其它按键（打字）落到下面普通输入处理
    }

    // 行首/行尾：Ctrl+A / Ctrl+E（物理 Home/End 由下方 stdin 监听处理——Ink 会把 Home/End 吞掉不传给 useInput）
    if (key.ctrl && (char === 'a' || char === 'A')) { setCursor(0); return; }
    if (key.ctrl && (char === 'e' || char === 'E')) { setCursor(input.length); return; }

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
      // 换行（多行输入）：① Shift/Option/Meta+Enter（终端以 meta/shift+return 上报，如 iTerm 把 Shift+Return 绑成发 ESC+CR）；
      //                  ② 行尾 `\` + 回车（零配置）。其余回车=发送。
      if (key.meta || key.shift) {
        setInput((v) => v.slice(0, cursor) + '\n' + v.slice(cursor));
        setCursor((c) => c + 1);
        return;
      }
      if (input[cursor - 1] === '\\') {
        setInput((v) => v.slice(0, cursor - 1) + '\n' + v.slice(cursor)); // 删 \ 插 \n，光标不变
        return;
      }
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
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text underline>花名册</Text>
        {roster.map((a) => (
          <Text key={a.name} color={color(a.status)}>{a.virtual ? '·' : '●'} {a.name} <Text dimColor>{a.role ?? ''} [{a.status}]</Text></Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1} flexGrow={1}>
        <Text underline>消息</Text>
        {log.slice(-6).map((m, i, arr) => {
          const isLatest = i === arr.length - 1;
          const { lines, truncated } = formatBody(String(m.body), isLatest ? 40 : 3);
          return (
            <Box key={i} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
              <Text>
                {m.ts ? <Text dimColor>{formatTime(m.ts)} </Text> : null}
                <Text color={nameColor(m.from)}>{m.from}</Text>
                <Text> → </Text>
                <Text color={nameColor(m.to)}>{m.to}</Text>
              </Text>
              {lines.map((ln, j) => (<Text key={j} wrap="wrap">  {ln}</Text>))}
              {truncated > 0 ? <Text dimColor>  … +{truncated} 行（完整见 {m.from} 窗口）</Text> : null}
            </Box>
          );
        })}
      </Box>

      {confirmExit ? (
        <Box marginTop={1}>
          <Text color="yellow">⚠ 退出 falinks —— 关闭所有员工窗口吗？ </Text>
          <Text bold>y/Enter=关闭并退出 · n=保留窗口退出 · Esc=取消</Text>
        </Box>
      ) : null}

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
          {answering && pendingQ ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="yellow">❓ {pendingQ.from} 问你：{pendingQ.question}</Text>
              {pendingQ.options.map((o: string, i: number) => (
                <Text key={i} inverse={i === qSelClamped}>  {i + 1}. {o}</Text>
              ))}
              <Text dimColor>↑↓ 选 · Enter 回复 · Esc 跳过{questions.length > 1 ? ` · 还有 ${questions.length - 1} 个待答` : ''} · 或打字改普通输入</Text>
            </Box>
          ) : null}
          <Box marginTop={1}>
            <Text>
              <Text color="green">› </Text>
              {input.slice(0, cursor)}
              <Text inverse>{input[cursor] && input[cursor] !== '\n' ? input[cursor] : ' '}</Text>
              {input.slice(cursor + 1)}
            </Text>
          </Box>
          {active ? (
            <Box flexDirection="column">
              {items.map((it, i) => (
                <Text key={it.label} inverse={i === selClamped}>  {it.label}{it.hint ? '   ' + it.hint : ''}</Text>
              ))}
            </Box>
          ) : (
            <Text dimColor>直接打字=回复 @{replyTarget ?? '(无·先 @某人)'} · @all 群发 · @名字 私聊 · / 命令 · Tab/Enter 补全</Text>
          )}
        </>
      )}
      {status ? <Text dimColor>{status}</Text> : null}
    </Box>
  );
}
