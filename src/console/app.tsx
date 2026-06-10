import React, { useEffect, useRef, useState } from 'react';
import { readFileSync } from 'node:fs';
import { Box, Static, Text, useStdin, useStdout } from 'ink';
import { parseConsoleInput, lastReplyTarget } from './parse.js';
import { mentionState, applyMention } from './mention.js';
import { commandState, applyCommand } from './commands.js';
import { CLIS, dirSuggestions, fsListDirs } from './wizard.js';
import { nameColor, formatTime, NAME_COLORS, statusGlyph, SPINNER_FRAMES } from './log-format.js';
import { renderMarkdown } from './markdown.js';
import { decodeKey, type KeyEvent } from './keys.js';
import { appendCommitted, pendingTargets } from './scrollback.js';
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

type WizardState =
  | { name: string; step: 'cli'; sel: number }
  | { name: string; step: 'role'; cli: string; roleText: string }
  | { name: string; step: 'cwd'; cli: string; role: string; path: string; sel: number };

export function App({ port, initialStatus }: { port: number; initialStatus?: string }) {
  const [roster, setRoster] = useState<any[]>([]);
  const [log, setLog] = useState<any[]>([]);
  // 已提交进终端原生 scrollback 的消息(只增不改、引用稳定),交给 <Static> 一次性印出、永不重绘。
  const committedRef = useRef<any[]>([]);
  const [committed, setCommitted] = useState<any[]>([]);
  const [pending, setPending] = useState<string[]>([]); // 仍在对方 inbox 排队、尚未投出的目标
  const [diag, setDiag] = useState<any[]>([]); // 协作诊断事件(守卫丢消息/注入失败/可疑过早 idle)
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [sel, setSel] = useState(0);
  const [status, setStatus] = useState(initialStatus ?? '');
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const [langPick, setLangPick] = useState<number | null>(null); // null=未激活,否则=高亮项 index
  const [leadPick, setLeadPick] = useState<number | null>(null); // /lead 选组长选择器:null=未激活
  const [questions, setQuestions] = useState<any[]>([]);
  const [qSel, setQSel] = useState(0);
  const [customAns, setCustomAns] = useState<string | null>(null); // 答题"自定义回答"输入态:null=未在输入
  const [skippedQ, setSkippedQ] = useState<string | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [tagline] = useState(() => t().taglines[Math.floor(Math.random() * t().taglines.length)]);
  const defaultCwd = process.cwd();

  const LANG_OPTS = [
    { v: 'auto', label: t().langAuto },
    { v: 'zh', label: t().langZh },
    { v: 'en', label: t().langEn },
  ] as const;
  const leadOpts: string[] = roster.filter((a) => !a.virtual).map((a) => a.name); // /lead 候选=非虚拟员工

  // 自研键盘输入：开 kitty 协议后，自己读 stdin + decodeKey，规范化成按键事件交给 handleKey。
  // 这样 Shift+Enter（kitty CSI-u）能和回车区分，且不依赖终端配置；中文/方向键/Ctrl 组合也照常。
  const { stdin, setRawMode } = useStdin();
  useEffect(() => { setRawMode?.(true); }, [setRawMode]);
  const { stdout } = useStdout();

  // 启动 banner:FALINKS logo + 版本 + tagline 启动时往 scrollback 打印一次(像 shell banner,
  // 随后续消息自然滚走),不再常驻顶部。Static 模型下顶部不再钉任何东西。
  useEffect(() => {
    const banner =
      '\x1b[1;36m╔═╗╔═╗╦  ╦╔╗╔╦╔═╔═╗\x1b[0m\n' +
      '\x1b[1;36m╠╣ ╠═╣║  ║║║║╠╩╗╚═╗\x1b[0m\n' +
      '\x1b[1;36m╚  ╩ ╩╩═╝╩╝╚╝╩ ╩╚═╝\x1b[0m\n' +
      `\x1b[2mv${VERSION} · ${tagline}\x1b[0m\n\n`;
    (stdout ?? process.stdout).write(banner);
    // 仅启动一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 轮询去重:数据没变就不 setState——否则每秒一个新数组引用就重渲染一次(活区无谓重绘)。
  const lastSeen = useRef({ roster: '', log: '', questions: '', diag: '' });
  useEffect(() => {
    const tick = async () => {
      try {
        const r = await admin(port, 'GET', '/admin/roster');
        const rs = JSON.stringify(r.roster ?? []);
        if (rs !== lastSeen.current.roster) { lastSeen.current.roster = rs; setRoster(r.roster ?? []); }
        // 拉近 100 条全量:committed 增量提交进 scrollback,pendingTargets 算出"等送达"。
        const l = await admin(port, 'GET', '/admin/log?limit=100');
        const fullLog = l.log ?? [];
        const ls = JSON.stringify(fullLog);
        if (ls !== lastSeen.current.log) {
          lastSeen.current.log = ls;
          setLog(fullLog);
          const next = appendCommitted(committedRef.current, fullLog);
          if (next !== committedRef.current) { committedRef.current = next; setCommitted(next); }
          setPending(pendingTargets(fullLog));
        }
        const q = await admin(port, 'GET', '/admin/questions');
        const qs = JSON.stringify(q.questions ?? []);
        if (qs !== lastSeen.current.questions) { lastSeen.current.questions = qs; setQuestions(q.questions ?? []); }
        const d = await admin(port, 'GET', '/admin/diag?limit=200');
        const ds = JSON.stringify(d.diag ?? []);
        if (ds !== lastSeen.current.diag) { lastSeen.current.diag = ds; setDiag(d.diag ?? []); }
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

  const dispatch = async (line: string, atts: string[] = []) => {
    const a = parseConsoleInput(line); // 用原始输入(含 [图片N])判命令——避免展开后的 /路径 被误判成命令
    const expand = (msg: string) => expandImageTokens(msg, atts); // 仅消息体展开成真实路径
    try {
      if (a.kind === 'noop') return;
      if (a.kind === 'help') { setStatus(t().helpStatus); return; }
      if (a.kind === 'error') { setStatus('⚠ ' + a.message); return; }
      if (a.kind === 'add-start') { setWizard({ name: a.name, step: 'cli', sel: 0 }); return; }
      if (a.kind === 'lang-start') { setLangPick(0); return; }
      if (a.kind === 'lead-start') { setLeadPick(0); return; }
      if (a.kind === 'say') { const r = await admin(port, 'POST', '/admin/say', { to: a.to, message: expand(a.message) }); setStatus(r.ok ? t().sayOk(a.to) : '⚠ ' + t().sayUndelivered(a.to, r.error ?? t().guardrailBlocked)); return; }
      if (a.kind === 'broadcast') { await admin(port, 'POST', '/admin/broadcast', { message: expand(a.message) }); setStatus(t().broadcastOk); return; }
      if (a.kind === 'reply') {
        const target = lastReplyTarget(log);
        if (!target) { setStatus(t().noReplyTarget); return; }
        const r = await admin(port, 'POST', '/admin/say', { to: target, message: expand(a.message) });
        setStatus(r.ok ? t().replyOk(target) : '⚠ ' + t().sayUndelivered(target, r.error ?? t().guardrailBlocked));
        return;
      }
      if (a.kind === 'add') { const r = await admin(port, 'POST', '/admin/add', a.spec); setStatus(r.ok ? t().addOk(a.spec.name) : '⚠ ' + (r.error ?? t().addFailed)); return; }
      if (a.kind === 'remove') { const r = await admin(port, 'POST', '/admin/remove', { name: a.name }); setStatus(r.ok ? t().removeOk(a.name) : '⚠ ' + (r.error ?? t().removeFailed)); return; }
      if (a.kind === 'clear') {
        const r = await admin(port, 'POST', '/admin/clear', { name: a.name });
        // /clear 全员(无名)成功:清终端原生 scrollback(否则已"印"进去的旧消息清不掉)+ 重置 committed。
        // /clear <名字> 只清那个 pane 上下文,不动屏幕/scrollback。
        if (r.ok && !a.name) {
          (stdout ?? process.stdout).write('\x1b[3J\x1b[2J\x1b[H');
          committedRef.current = [];
          setCommitted([]);
          lastSeen.current.log = '';
          setPending([]);
        }
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
  // 输入目标(随输入实时变,做成提示符前的彩色 chip,让"这条会发给谁"一眼可见):
  // / 命令 → 无目标;@all → 全员群发;@名字 → 私聊该人;否则纯文本=回复上次目标(没有则提示先 @ 某人)。
  const inputDest: { mode: 'cmd' | 'broadcast' | 'to' | 'none'; to?: string } = (() => {
    const s = input.replace(/^\s+/, '');
    if (s.startsWith('/')) return { mode: 'cmd' };
    if (s.startsWith('@')) {
      const name = s.slice(1).split(/\s/)[0];
      if (name === 'all') return { mode: 'broadcast' };
      if (name) return { mode: 'to', to: name };
    }
    return replyTarget ? { mode: 'to', to: replyTarget } : { mode: 'none' };
  })();
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
  // 选项末尾恒加一个"自定义回答"虚拟项;qSel 取值 0..options.length(最后一个=自定义)。
  const qSelClamped = pendingQ ? Math.min(qSel, pendingQ.options.length) : 0;
  const onCustomSlot = !!pendingQ && qSelClamped === pendingQ.options.length;

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

    // 选组长态:↑↓ 选 · Enter 确认 · Esc 取消(选项=实时花名册非虚拟员工)
    if (leadPick !== null) {
      if (ev.type === 'esc') { setLeadPick(null); return; }
      if (ev.type === 'up') { setLeadPick((s) => Math.max(0, (s ?? 0) - 1)); return; }
      if (ev.type === 'down') { setLeadPick((s) => Math.min(Math.max(0, leadOpts.length - 1), (s ?? 0) + 1)); return; }
      if (ev.type === 'enter') {
        const chosen = leadOpts[leadPick];
        setLeadPick(null);
        if (chosen) void (async () => {
          const r = await admin(port, 'POST', '/admin/lead', { name: chosen });
          setStatus(r.ok ? t().leadSwitched(chosen) : '⚠ ' + (r.error ?? t().leadFailed));
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

    // 答题态：有待答选择题且输入框为空 → ↑↓ 选项(末尾恒有"自定义回答")、Enter 回复、Esc 跳过；一打字让位普通输入。
    if (answering && pendingQ) {
      // "自定义回答"输入子态:打字编辑、Enter 发送自由文本给提问者、Esc 返回选项列表。
      if (customAns !== null) {
        if (ev.type === 'esc') { setCustomAns(null); return; }
        if (ev.type === 'enter') {
          const text = customAns.trim();
          if (!text) { setCustomAns(null); return; }
          const id = pendingQ.id; const from = pendingQ.from;
          setCustomAns(null); setQSel(0);
          void (async () => {
            const r = await admin(port, 'POST', '/admin/answer', { id, text });
            setStatus(r.ok ? t().answeredOk(from, text) : '⚠ ' + (r.error ?? t().unknownError));
          })();
          return;
        }
        if (ev.type === 'backspace') { setCustomAns((c) => (c ?? '').slice(0, -1)); return; }
        if (ev.type === 'text') { setCustomAns((c) => (c ?? '') + ev.text); return; }
        return; // 其它键在自定义输入态吞掉
      }
      if (ev.type === 'up') { setQSel((s) => Math.max(0, s - 1)); return; }
      if (ev.type === 'down') { setQSel((s) => Math.min(pendingQ.options.length, s + 1)); return; }
      if (ev.type === 'enter') {
        if (onCustomSlot) { setCustomAns(''); return; } // 选中"自定义回答" → 进输入子态
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
      if (ev.type === 'tab' || ev.type === 'enter') {
        // 无参命令(/lang、/help):回车/Tab 直接执行,不补成 "/cmd " 让人以为还要输参数。
        if (cmd.active && cmd.matches[selClamped]?.noArgs) {
          const name = cmd.matches[selClamped].name;
          setInput(''); setCursor(0); setSel(0);
          void dispatch('/' + name);
          return;
        }
        const c = complete!(selClamped); setInput(c); setCursor(c.length); setSel(0); return;
      }
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
      const raw = input;            // 原始输入(含 [图片N]):判命令用它,/ 开头才是命令
      const atts = attachments;     // 附件快照(下面即清空,dispatch 异步展开消息体要用)
      setInput(''); setCursor(0); setSel(0); setHistIdx(null); setAttachments([]);
      if (raw.trim()) setHistory((h) => [...h, raw]);
      void dispatch(raw, atts);
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
  }, [stdin, input, cursor, wizard, langPick, leadPick, confirmExit, questions, skippedQ, qSel, customAns, history, histIdx, attachments, sel, log, roster]);

  const color = (s: string) => (s === 'idle' ? 'green' : s === 'busy' ? 'yellow' : s === 'dead' ? 'red' : 'gray');

  // 协作诊断警告:有守卫丢消息/注入失败/可疑过早 idle 时顶一行,提醒可能卡死。
  const drops = diag.filter((e) => e?.kind === 'guard-drop').length;
  const injFails = diag.filter((e) => e?.kind === 'inject-fail').length;
  const fastIdle = diag.filter((e) => e?.kind === 'auto-idle').length;
  const hasDiag = drops || injFails || fastIdle;

  return (
    // 顶层不再钉高度/overflow:消息历史进 <Static> 一次性印进终端原生 scrollback、永不重绘
    // (滚轮滚动/拖选复制都交回终端);底部活区(flexShrink=0)随内容自然占底部、原地小块重绘。
    <Box flexDirection="column">
      <Static items={committed}>
        {(m: any) => (
          <Box key={m.id} flexDirection="column" marginBottom={1}>
            <Text>
              {m.ts ? <Text dimColor>{formatTime(m.ts)} </Text> : null}
              <Text color={colorFor(m.from)} bold>{m.from}</Text>
              <Text> → </Text>
              <Text color={colorFor(m.to)} bold>{m.to}</Text>
            </Text>
            {renderMarkdown(String(m.body)).map((segs: any[], j: number) => (
              <Text key={j} wrap="wrap">{'  '}{segs.map((s: any, k: number) => (
                <Text key={k} bold={s.bold} italic={s.italic} underline={s.underline} strikethrough={s.strikethrough} dimColor={s.dim}>{s.text}</Text>
              ))}</Text>
            ))}
          </Box>
        )}
      </Static>

      {/* 活区:花名册 statusline + 等送达 + 诊断 + 输入/浮层 + 状态行 */}
      <Box flexDirection="column" flexShrink={0}>
        {roster.length ? (
          <Text>
            {roster.map((a, i) => (
              <Text key={a.name}>
                {i ? <Text dimColor> · </Text> : null}
                <Text color={color(a.status)}>{statusGlyph(a.status, !!a.virtual, frame)}</Text>
                <Text color={colorFor(a.name)} bold>{a.name}</Text>
                {a.lead ? <Text color="cyan" bold>♔</Text> : null}
              </Text>
            ))}
          </Text>
        ) : null}
        {pending.length ? (
          <Text color="yellow">{t().pendingDeliver(pending.map((n) => '→ ' + n).join(' · '))}</Text>
        ) : null}
        {hasDiag ? <Text color="yellow">{t().diagWarn(drops, injFails, fastIdle)}</Text> : null}

        {confirmExit ? (
          <Box marginTop={1}>
            <Text color="yellow">{t().exitConfirmTitle}</Text>
            <Text bold>{t().exitConfirmKeys}</Text>
          </Box>
        ) : langPick !== null ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color="yellow">{t().langPickTitle}</Text>
            {LANG_OPTS.map((o, i) => (
              <Text key={o.v} inverse={i === langPick}>  {o.label}</Text>
            ))}
          </Box>
        ) : leadPick !== null ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color="yellow">{t().leadCmdPickTitle}</Text>
            {leadOpts.length === 0 ? (
              <Text dimColor>  {t().leadPickEmpty}</Text>
            ) : leadOpts.map((nm, i) => (
              <Text key={nm} inverse={i === leadPick}>  <Text color={colorFor(nm)} bold>{nm}</Text></Text>
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
                <Text inverse={onCustomSlot} dimColor={!onCustomSlot}>  {t().answerCustom}</Text>
                {customAns !== null ? (
                  <Text>{t().answerCustomPrompt}<Text color="green">{customAns}</Text><Text inverse> </Text></Text>
                ) : (
                  <Text dimColor>{t().answerKeys}{questions.length > 1 ? t().answerMore(questions.length - 1) : ''}{t().answerOrType}</Text>
                )}
              </Box>
            ) : null}
            <Box marginTop={1}>
              <Text>
                {inputDest.mode === 'cmd' ? <Text color="magenta" bold>⌘ </Text>
                 : inputDest.mode === 'broadcast' ? <Text color="yellow" bold>📢 {t().clearAll} </Text>
                 : inputDest.mode === 'to' ? <Text><Text dimColor>→ </Text><Text color={colorFor(inputDest.to!)} bold>{inputDest.to}</Text><Text> </Text></Text>
                 : <Text color="yellow" bold>{t().noReplyTargetShort} </Text>}
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
