import React, { useEffect, useRef, useState } from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { Box, Text, useStdin, useStdout } from 'ink';
import { parseConsoleInput, lastReplyTarget } from './parse.js';
import { mentionState, applyMention } from './mention.js';
import { commandState, applyCommand } from './commands.js';
import { CLIS, dirSuggestions } from './wizard.js';
import { formatBody, nameColor, formatTime, NAME_COLORS, statusGlyph, SPINNER_FRAMES } from './log-format.js';
import { decodeKey, type KeyEvent } from './keys.js';
import { saveClipboardImage, expandImageTokens } from './clipboard.js';
import { t, setLocale } from '../i18n/index.js';

const PKG: { name: string; version: string } = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  } catch {
    return { name: '@hklmtt/falinks', version: '' };
  }
})();
const VERSION = PKG.version;

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

export function App({ port, initialStatus }: { port: number; initialStatus?: string }) {
  const [roster, setRoster] = useState<any[]>([]);
  const [log, setLog] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [sel, setSel] = useState(0);
  const [status, setStatus] = useState(initialStatus ?? '');
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const [langPick, setLangPick] = useState<number | null>(null); // null=未激活,否则=高亮项 index
  const [questions, setQuestions] = useState<any[]>([]);
  const [qSel, setQSel] = useState(0);
  const [skippedQ, setSkippedQ] = useState<string | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [tagline] = useState(() => t().taglines[Math.floor(Math.random() * t().taglines.length)]);
  const defaultCwd = process.cwd();

  const LANG_OPTS = [
    { v: 'auto', label: t().langAuto },
    { v: 'zh', label: t().langZh },
    { v: 'en', label: t().langEn },
  ] as const;

  // 自研键盘输入：开 kitty 协议后，自己读 stdin + decodeKey，规范化成按键事件交给 handleKey。
  // 这样 Shift+Enter（kitty CSI-u）能和回车区分，且不依赖终端配置；中文/方向键/Ctrl 组合也照常。
  const { stdin, setRawMode } = useStdin();
  useEffect(() => { setRawMode?.(true); }, [setRawMode]);

  // 终端行数(只读跟踪,用于视口裁剪):根盒高度钉在 rows-1——必须严格小于终端行数,
  // 等于或超过都会让 Ink 每帧整屏清除(clearTerminal),配合轮询重渲染就是持续闪烁。
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout?.rows ?? 24);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setRows(stdout.rows ?? 24);
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
  }, [stdout]);

  // 轮询去重:数据没变就不 setState——否则每秒一个新数组引用就重渲染一次,
  // 内容一高(超过终端行数)Ink 还会整屏清除,空闲时界面也持续闪。
  const lastSeen = useRef({ roster: '', log: '', questions: '' });
  useEffect(() => {
    const tick = async () => {
      try {
        const r = await admin(port, 'GET', '/admin/roster');
        const rs = JSON.stringify(r.roster ?? []);
        if (rs !== lastSeen.current.roster) { lastSeen.current.roster = rs; setRoster(r.roster ?? []); }
        const l = await admin(port, 'GET', '/admin/log');
        const recent = (l.log ?? []).slice(-10);
        const ls = JSON.stringify(recent);
        if (ls !== lastSeen.current.log) { lastSeen.current.log = ls; setLog(recent); }
        const q = await admin(port, 'GET', '/admin/questions');
        const qs = JSON.stringify(q.questions ?? []);
        if (qs !== lastSeen.current.questions) { lastSeen.current.questions = qs; setQuestions(q.questions ?? []); }
      } catch {
        /* up 还没起或断开，忽略 */
      }
    };
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
  }, [port]);

  // 状态点动画:有人在忙/启动中才起 ~120ms 定时器逐帧推进(没人在忙就不跑,免无谓重渲染)。
  const [frame, setFrame] = useState(0);
  const anyActive = roster.some((a) => !a.virtual && (a.status === 'busy' || a.status === 'launching'));
  useEffect(() => {
    if (!anyActive) return;
    const h = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 120);
    return () => clearInterval(h);
  }, [anyActive]);

  const dispatch = async (line: string) => {
    const a = parseConsoleInput(line);
    try {
      if (a.kind === 'noop') return;
      if (a.kind === 'help') { setStatus(t().helpStatus); return; }
      if (a.kind === 'error') { setStatus('⚠ ' + a.message); return; }
      if (a.kind === 'add-start') { setWizard({ name: a.name, step: 'cli', sel: 0 }); return; }
      if (a.kind === 'lang-start') { setLangPick(0); return; }
      if (a.kind === 'say') { const r = await admin(port, 'POST', '/admin/say', { to: a.to, message: a.message }); setStatus(r.ok ? t().sayOk(a.to) : '⚠ ' + t().sayUndelivered(a.to, r.error ?? t().guardrailBlocked)); return; }
      if (a.kind === 'broadcast') { await admin(port, 'POST', '/admin/broadcast', { message: a.message }); setStatus(t().broadcastOk); return; }
      if (a.kind === 'reply') {
        const target = lastReplyTarget(log);
        if (!target) { setStatus(t().noReplyTarget); return; }
        const r = await admin(port, 'POST', '/admin/say', { to: target, message: a.message });
        setStatus(r.ok ? t().replyOk(target) : '⚠ ' + t().sayUndelivered(target, r.error ?? t().guardrailBlocked));
        return;
      }
      if (a.kind === 'add') { const r = await admin(port, 'POST', '/admin/add', a.spec); setStatus(r.ok ? t().addOk(a.spec.name) : '⚠ ' + (r.error ?? t().addFailed)); return; }
      if (a.kind === 'remove') { const r = await admin(port, 'POST', '/admin/remove', { name: a.name }); setStatus(r.ok ? t().removeOk(a.name) : '⚠ ' + (r.error ?? t().removeFailed)); return; }
      if (a.kind === 'clear') {
        const r = await admin(port, 'POST', '/admin/clear', { name: a.name });
        setStatus(r.ok ? t().cleared(a.name ?? t().clearAll, (r.cleared ?? []).join(t().clearJoiner) || t().clearNone) : '⚠ ' + (r.error ?? t().clearFailed));
        return;
      }
    } catch (e: any) {
      setStatus('⚠ ' + (e?.message ?? t().unknownError));
    }
  };

  // 统一的补全下拉：/ 命令优先，否则 @ 成员（含 all 群发；排除 boss 等虚拟成员——你自己就是 boss）
  const names = ['all', ...roster.filter((a) => !a.virtual).map((a) => a.name)];
  // 给花名册每个人分配一个不重复的颜色（按花名册顺序取调色板）；消息里同名复用，花名册外的名字回退到 hash 色。
  const colorMap = new Map<string, string>();
  roster.forEach((a, i) => colorMap.set(a.name, NAME_COLORS[i % NAME_COLORS.length]));
  const colorFor = (n: string) => colorMap.get(n) ?? nameColor(n);
  const replyTarget = lastReplyTarget(log);
  const cmd = commandState(input);
  const mention = mentionState(input, names);
  let items: { label: string; hint: string }[] = [];
  let complete: ((i: number) => string) | null = null;
  if (cmd.active) {
    items = cmd.matches.map((c) => ({ label: c.usage, hint: c.hint }));
    complete = (i) => applyCommand(cmd.matches[i].name);
  } else if (mention.active) {
    items = mention.matches.map((n) => ({ label: '@' + n, hint: n === 'all' ? t().broadcastAllHint : '' }));
    complete = (i) => applyMention(input, mention.matches[i]);
  }
  const active = complete !== null && items.length > 0;
  const selClamped = Math.min(sel, Math.max(0, items.length - 1));

  // 待答的选择题（跳过的不抢）：输入空 + 非向导时进入"答题"态
  const pendingQ = questions.find((q) => q.id !== skippedQ) ?? null;
  const answering = !!pendingQ && input === '' && !wizard;
  const qSelClamped = pendingQ ? Math.min(qSel, Math.max(0, pendingQ.options.length - 1)) : 0;

  function handleKey(ev: KeyEvent) {
    // Ctrl+C：不直接退，先问是否关闭员工窗口（优先于一切）。
    if (confirmExit) {
      if (ev.type === 'esc') { setConfirmExit(false); return; }
      if (ev.type === 'enter' || (ev.type === 'text' && /^[yYnN]$/.test(ev.text))) {
        const closePanes = !(ev.type === 'text' && (ev.text === 'n' || ev.text === 'N')); // n=保留窗口；y/Enter=关闭
        void (async () => {
          try { await admin(port, 'POST', '/admin/shutdown', { closePanes }); } catch { /* ignore */ }
          process.exit(0);
        })();
        return;
      }
      return; // 确认中，吞掉其它键
    }
    if (ev.type === 'ctrl' && ev.key === 'c') { setConfirmExit(true); return; }

    // 向导模式：优先处理
    if (wizard) {
      if (ev.type === 'esc') { setWizard(null); setStatus(t().wizardCancelled); return; }
      if (wizard.step === 'cli') {
        if (ev.type === 'up') { setWizard({ ...wizard, sel: Math.max(0, wizard.sel - 1) }); return; }
        if (ev.type === 'down') { setWizard({ ...wizard, sel: Math.min(CLIS.length - 1, wizard.sel + 1) }); return; }
        if (ev.type === 'enter' || ev.type === 'tab') { setWizard({ name: wizard.name, step: 'role', cli: CLIS[wizard.sel], roleText: '' }); return; }
        return;
      }
      if (wizard.step === 'role') {
        if (ev.type === 'enter') { setWizard({ name: wizard.name, step: 'cwd', cli: wizard.cli, role: wizard.roleText.trim() || t().wizardDefaultRole, path: defaultCwd, sel: 0 }); return; }
        if (ev.type === 'backspace') { setWizard({ ...wizard, roleText: wizard.roleText.slice(0, -1) }); return; }
        if (ev.type === 'text') { setWizard({ ...wizard, roleText: wizard.roleText + ev.text }); return; }
        return;
      }
      const sugs = dirSuggestions(wizard.path, fsListDirs);
      if (ev.type === 'up') { setWizard({ ...wizard, sel: Math.max(0, wizard.sel - 1) }); return; }
      if (ev.type === 'down') { setWizard({ ...wizard, sel: Math.min(Math.max(0, sugs.length - 1), wizard.sel + 1) }); return; }
      if (ev.type === 'tab') { if (sugs.length) setWizard({ ...wizard, path: sugs[Math.min(wizard.sel, sugs.length - 1)] + '/', sel: 0 }); return; }
      if (ev.type === 'enter') {
        const w = wizard;
        setWizard(null);
        void (async () => {
          const r = await admin(port, 'POST', '/admin/add', { name: w.name, cli: w.cli, cwd: w.path, role: w.role });
          setStatus(r.ok ? t().wizardAddOk(w.name, w.role, w.path) : '⚠ ' + (r.error ?? t().addFailed));
        })();
        return;
      }
      if (ev.type === 'backspace') { setWizard({ ...wizard, path: wizard.path.slice(0, -1), sel: 0 }); return; }
      if (ev.type === 'text') { setWizard({ ...wizard, path: wizard.path + ev.text, sel: 0 }); return; }
      return;
    }

    // 语言选择态:↑↓ 选 · Enter 确认 · Esc 取消(与 wizard/answering 同级)
    if (langPick !== null) {
      if (ev.type === 'esc') { setLangPick(null); return; }
      if (ev.type === 'up') { setLangPick((s) => Math.max(0, (s ?? 0) - 1)); return; }
      if (ev.type === 'down') { setLangPick((s) => Math.min(LANG_OPTS.length - 1, (s ?? 0) + 1)); return; }
      if (ev.type === 'enter') {
        const chosen = LANG_OPTS[langPick].v;
        setLangPick(null);
        void (async () => {
          const r = await admin(port, 'POST', '/admin/lang', { locale: chosen });
          if (r.ok) { setLocale(r.locale); setStatus(t().langSwitched(r.locale)); }
          else setStatus('⚠ ' + (r.error ?? t().langFailed));
        })();
        return;
      }
      return;
    }

    // Ctrl+V：读系统剪贴板里的截图，存临时文件，输入框只插入短占位 [图片N]（发送时展开成真实路径）
    if (ev.type === 'ctrl' && ev.key === 'v') {
      void saveClipboardImage().then((p) => {
        if (!p) { setStatus(t().clipboardNoImage); return; }
        const token = t().imageToken(attachments.length + 1);
        setAttachments((a) => [...a, p]);
        setInput((v) => v.slice(0, cursor) + token + ' ' + v.slice(cursor));
        setCursor((c) => c + token.length + 1);
        setStatus(t().attached(token));
      });
      return;
    }

    // 答题态：有待答选择题且输入框为空 → ↑↓ 选项、Enter 回复、Esc 跳过；一打字就让位给普通输入。
    if (answering && pendingQ) {
      if (ev.type === 'up') { setQSel((s) => Math.max(0, s - 1)); return; }
      if (ev.type === 'down') { setQSel((s) => Math.min(pendingQ.options.length - 1, s + 1)); return; }
      if (ev.type === 'enter') {
        const id = pendingQ.id; const from = pendingQ.from; const choice = qSelClamped; const picked = pendingQ.options[choice];
        setQSel(0);
        void (async () => {
          await admin(port, 'POST', '/admin/answer', { id, choice });
          setStatus(t().answeredOk(from, picked));
        })();
        return;
      }
      if (ev.type === 'esc') { setSkippedQ(pendingQ.id); return; }
      // 其它按键（打字）落到下面普通输入处理
    }

    // 行首/行尾：Home/End 或 Ctrl+A / Ctrl+E
    if (ev.type === 'home' || (ev.type === 'ctrl' && ev.key === 'a')) { setCursor(0); return; }
    if (ev.type === 'end' || (ev.type === 'ctrl' && ev.key === 'e')) { setCursor(input.length); return; }

    if (active) {
      if (ev.type === 'up') { setSel((s) => Math.max(0, s - 1)); return; }
      if (ev.type === 'down') { setSel((s) => Math.min(items.length - 1, s + 1)); return; }
      if (ev.type === 'tab' || ev.type === 'enter') { const c = complete!(selClamped); setInput(c); setCursor(c.length); setSel(0); return; }
    }

    if (ev.type === 'left') { setCursor((c) => Math.max(0, c - 1)); return; }
    if (ev.type === 'right') { setCursor((c) => Math.min(input.length, c + 1)); return; }

    if (ev.type === 'up') {
      if (history.length) {
        const ni = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
        setHistIdx(ni); setInput(history[ni]); setCursor(history[ni].length);
      }
      return;
    }
    if (ev.type === 'down') {
      if (histIdx !== null) {
        const ni = histIdx + 1;
        if (ni >= history.length) { setHistIdx(null); setInput(''); setCursor(0); }
        else { setHistIdx(ni); setInput(history[ni]); setCursor(history[ni].length); }
      }
      return;
    }

    // Shift+Enter = 换行（多行输入）；普通回车 = 发送（行尾 `\` + 回车 也换行，作为兜底）。
    if (ev.type === 'shift-enter') {
      setInput((v) => v.slice(0, cursor) + '\n' + v.slice(cursor));
      setCursor((c) => c + 1);
      return;
    }
    if (ev.type === 'enter') {
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
    if (ev.type === 'backspace') {
      if (cursor > 0) {
        // 若光标紧跟在 [图片N] 之后，整体删掉这个占位（像 Claude Code 把附件当一个整体删），而不是逐字符。
        const m = input.slice(0, cursor).match(/\[(?:图片|Image\s?)\d+\]$/);
        const del = m ? m[0].length : 1;
        setInput((v) => v.slice(0, cursor - del) + v.slice(cursor));
        setCursor((c) => c - del);
        setSel(0);
      }
      return;
    }
    if (ev.type === 'text') {
      setInput((v) => v.slice(0, cursor) + ev.text + v.slice(cursor));
      setCursor((c) => c + ev.text.length);
      setSel(0);
      return;
    }
  }

  useEffect(() => {
    if (!stdin) return;
    const onData = (d: Buffer | string) => handleKey(decodeKey(d.toString()));
    stdin.on('data', onData);
    return () => { stdin.off('data', onData); };
    // 每次渲染重挂，保证闭包里拿到最新 state；依赖列出 handleKey 读到的所有状态。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdin, input, cursor, wizard, langPick, confirmExit, questions, skippedQ, qSel, history, histIdx, attachments, sel, log, roster]);

  const color = (s: string) => (s === 'idle' ? 'green' : s === 'busy' ? 'yellow' : s === 'dead' ? 'red' : 'gray');

  return (
    // 根盒钉在 rows-1(严格 < 终端行数)并裁剪溢出:输出永不触发 Ink 的整屏清除分支,
    // 一直走增量重绘 → 不闪。固定区(logo/花名册/输入)flexShrink=0 保证可见,
    // 消息区弹性吸收剩余空间、贴底裁顶(最新消息永远可见,旧的被裁掉)。
    <Box flexDirection="column" height={Math.max(4, rows - 1)} overflow="hidden">
      <Box flexDirection="column" flexShrink={0}>
        <Text color="cyan" bold>╔═╗╔═╗╦  ╦╔╗╔╦╔═╔═╗</Text>
        <Text color="cyan" bold>╠╣ ╠═╣║  ║║║║╠╩╗╚═╗</Text>
        <Text color="cyan" bold>╚  ╩ ╩╩═╝╩╝╚╝╩ ╩╚═╝</Text>
        <Text dimColor>v{VERSION} · {tagline}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1} flexShrink={0}>
        <Text underline>{t().roster}</Text>
        {roster.map((a) => (
          <Text key={a.name}>
            <Text color={color(a.status)}>{statusGlyph(a.status, !!a.virtual, frame)} </Text>
            <Text color={colorFor(a.name)} bold>{a.name}</Text>
            <Text dimColor> {a.role ?? ''} [{a.status}]</Text>
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1} flexGrow={1} overflow="hidden">
        <Box flexShrink={0}><Text underline>{t().messages}</Text></Box>
        <Box flexDirection="column" flexGrow={1} overflow="hidden" justifyContent="flex-end">
          {log.slice(-6).map((m, i, arr) => {
            const isLatest = i === arr.length - 1;
            const { lines, truncated } = formatBody(String(m.body), isLatest ? 40 : 3);
            return (
              <Box key={i} flexDirection="column" flexShrink={0} marginTop={i === 0 ? 0 : 1}>
                <Text>
                  {m.ts ? <Text dimColor>{formatTime(m.ts)} </Text> : null}
                  <Text color={colorFor(m.from)}>{m.from}</Text>
                  <Text> → </Text>
                  <Text color={colorFor(m.to)}>{m.to}</Text>
                </Text>
                {lines.map((ln, j) => (<Text key={j} wrap="wrap">  {ln}</Text>))}
                {truncated > 0 ? <Text dimColor>  {t().moreLines(truncated, m.from)}</Text> : null}
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box flexDirection="column" flexShrink={0}>
      {confirmExit ? (
        <Box marginTop={1}>
          <Text color="yellow">{t().exitConfirmTitle}</Text>
          <Text bold>{t().exitConfirmKeys}</Text>
        </Box>
      ) : null}

      {langPick !== null ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">{t().langPickTitle}</Text>
          {LANG_OPTS.map((o, i) => (
            <Text key={o.v} inverse={i === langPick}>  {o.label}</Text>
          ))}
        </Box>
      ) : wizard ? (
        <Box flexDirection="column" marginTop={1}>
          {wizard.step === 'cli' ? (
            <>
              <Text>{t().wizardAddPrefix}<Text bold>{wizard.name}</Text>{t().wizardCliSuffix}</Text>
              {CLIS.map((c, i) => (
                <Text key={c} inverse={i === wizard.sel}>  {c}{c === 'codex' ? t().wizardExperimental : ''}</Text>
              ))}
            </>
          ) : wizard.step === 'role' ? (
            <>
              <Text>{t().wizardAddPrefix}<Text bold>{wizard.name}</Text> [{wizard.cli}]{t().wizardRoleSuffix}</Text>
              <Box><Text color="green">› </Text><Text>{wizard.roleText}</Text><Text inverse> </Text></Box>
              <Text dimColor>{t().wizardRoleExample}</Text>
            </>
          ) : (
            <>
              <Text>{t().wizardAddPrefix}<Text bold>{wizard.name}</Text> [{wizard.cli}·{wizard.role}]{t().wizardCwdSuffix}</Text>
              <Box><Text color="green">› </Text><Text>{wizard.path}</Text><Text inverse> </Text></Box>
              {dirSuggestions(wizard.path, fsListDirs).map((d, i) => (
                <Text key={d} inverse={i === wizard.sel}>  {d}</Text>
              ))}
              <Text dimColor>{t().wizardCwdDefault}</Text>
            </>
          )}
        </Box>
      ) : (
        <>
          {answering && pendingQ ? (
            <Box flexDirection="column" marginTop={1}>
              <Text color="yellow">{t().questionAsk(pendingQ.from, pendingQ.question)}</Text>
              {pendingQ.options.map((o: string, i: number) => (
                <Text key={i} inverse={i === qSelClamped}>  {i + 1}. {o}</Text>
              ))}
              <Text dimColor>{t().answerKeys}{questions.length > 1 ? t().answerMore(questions.length - 1) : ''}{t().answerOrType}</Text>
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
            <Text dimColor>{t().inputHint(replyTarget ?? t().noReplyTargetShort)}</Text>
          )}
        </>
      )}
      {status ? <Text dimColor>{status}</Text> : null}
      </Box>
    </Box>
  );
}
