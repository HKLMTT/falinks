import React, { useEffect, useMemo, useRef, useState } from 'react';
import { readFileSync } from 'node:fs';
import { Box, Text, measureElement, useStdin, useStdout } from 'ink';
import { parseConsoleInput, lastReplyTarget } from './parse.js';
import { mentionState, applyMention } from './mention.js';
import { commandState, applyCommand, todoSubState } from './commands.js';
import { CLIS, dirSuggestions, fsListDirs, MODEL_PRESETS } from './wizard.js';
import { nameColor, formatTime, NAME_COLORS, statusGlyph, SPINNER_FRAMES } from './log-format.js';
import { renderMarkdown } from './markdown.js';
import { decodeKey, wheelBurst, type KeyEvent } from './keys.js';
import { appendCommitted, pendingCounts, wrapSegs, sliceView, clampOffset, clipDisp, dispWidth, type StyledSeg } from './scrollback.js';
import { saveClipboardImage, expandImageTokens } from './clipboard.js';
import { t, setLocale, getLocale } from '../i18n/index.js';
import { openBrowser } from '../util/open-browser.js';

const PKG: { name: string; version: string } = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  } catch {
    return { name: '@hklmtt/falinks', version: '' };
  }
})();
const VERSION = PKG.version;

// 协作诊断横幅的计数时间窗:只统计最近这段时间内的诊断事件,平息后自动消退(避免陈旧事件长期粘住告警)。
const DIAG_WINDOW_MS = 5 * 60_000;

// 1007 滚轮消歧:孤立单个方向键缓冲的极短窗口。窗口内又来同向方向键即判为滚轮连发。
// 取 40ms——远大于滚轮把一格拆成跨 chunk 单发的间隔(亚毫秒~数十毫秒),又小于 macOS
// 默认键重复间隔(~80ms+),故键盘单按/常速按住仍单发结算,不误判为滚轮。见下方 onData。
const WHEEL_COALESCE_MS = 40;

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
  | { name: string; step: 'model'; cli: string; sel: number }
  | { name: string; step: 'model-custom'; cli: string; modelText: string }
  | { name: string; step: 'role'; cli: string; model?: string; roleText: string }
  | { name: string; step: 'cwd'; cli: string; model?: string; role: string; path: string; sel: number };

export function App({ port, initialStatus }: { port: number; initialStatus?: string }) {
  const [roster, setRoster] = useState<any[]>([]);
  const [log, setLog] = useState<any[]>([]);
  // 全量消息历史(只增不改、引用稳定),扁平成屏幕行后由回看视口切片渲染。
  const committedRef = useRef<any[]>([]);
  const [committed, setCommitted] = useState<any[]>([]);
  // 仍在对方 inbox 排队的目标+条数:从 log 派生(轮询/乐观更新只改 log,计数自动跟随,无双源失步)。
  const pending = useMemo(() => pendingCounts(log), [log]);
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
  const [todoState, setTodoState] = useState<any>(null); // GET /admin/todo 轮询结果(进度行+列表浮层共用)
  const [todoView, setTodoView] = useState(false);        // /todo list 浮层开关
  const [leadPick, setLeadPick] = useState<number | null>(null); // /lead 选组长选择器:null=未激活
  const [qCancel, setQCancel] = useState<number | null>(null); // 取消排队浮层:null=未激活,否则=高亮项 index
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
  // 仍在排队的消息清单(取消浮层的数据源,随 1s 轮询实时刷新);清空时浮层自动关。
  const queuedMsgs = log.filter((m: any) => m.queued);
  useEffect(() => {
    if (qCancel !== null && queuedMsgs.length === 0) setQCancel(null);
  }, [qCancel, queuedMsgs.length]);

  // 自研键盘输入：开 kitty 协议后，自己读 stdin + decodeKey，规范化成按键事件交给 handleKey。
  // 这样 Shift+Enter（kitty CSI-u）能和回车区分，且不依赖终端配置；中文/方向键/Ctrl 组合也照常。
  const { stdin, setRawMode } = useStdin();
  useEffect(() => { setRawMode?.(true); }, [setRawMode]);
  const { stdout } = useStdout();

  // 终端尺寸跟踪:alt screen 全屏自绘,根盒钉 rows-1 × cols-1(严格小于终端行/列数:
  // 行少 1 防末行换行顶滚;列少 1 防恰满宽行触发终端行尾 pending-wrap/物理折行)。
  // 用 || 不用 ??:无 tty/pty 异常时 rows/columns 可能是 0,0 也要落到默认值;再加下限防极端小窗。
  const readDims = () => ({ rows: Math.max(6, stdout?.rows || 24), cols: Math.max(20, stdout?.columns || 80) });
  const [dims, setDims] = useState(readDims);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setDims(readDims());
    stdout.on('resize', onResize);
    return () => { stdout.off('resize', onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdout]);
  const { rows, cols } = dims;
  // 回看偏移:0=实时贴底,>0=视口底边距最新多少行。
  const [scrollOff, setScrollOff] = useState(0);
  // 视口真实行数 = (rows-1) - 底部活区实测高度。每帧渲染后用 measureElement 量活区(高度随浮层/输入行数变),
  // 只存 ref 不进 state——夹紧发生在按键时刻,无需重渲染;首帧前用保守估计兜底。
  const viewApprox = Math.max(3, rows - 8);
  const bottomBoxRef = useRef<any>(null);
  const viewHRef = useRef(viewApprox);
  useEffect(() => {
    try {
      const m = bottomBoxRef.current ? measureElement(bottomBoxRef.current) : null;
      if (m?.height) viewHRef.current = Math.max(3, rows - 1 - m.height);
    } catch { /* 测量失败保持上次值 */ }
  });

  // 轮询去重:数据没变就不 setState——否则每秒一个新数组引用就重渲染一次(活区无谓重绘)。
  const lastSeen = useRef({ roster: '', log: '', questions: '', diag: '', todo: '' });
  const todoHinted = useRef(false); // 恢复提示只弹一次(首次轮询发现 paused 残档时)
  useEffect(() => {
    const tick = async () => {
      try {
        const r = await admin(port, 'GET', '/admin/roster');
        const rs = JSON.stringify(r.roster ?? []);
        if (rs !== lastSeen.current.roster) { lastSeen.current.roster = rs; setRoster(r.roster ?? []); }
        // 拉近 100 条全量:committed 增量提交进 scrollback,pendingCounts 按目标聚合"等送达"条数。
        const l = await admin(port, 'GET', '/admin/log?limit=100');
        const fullLog = l.log ?? [];
        const ls = JSON.stringify(fullLog);
        if (ls !== lastSeen.current.log) {
          lastSeen.current.log = ls;
          setLog(fullLog);
          const next = appendCommitted(committedRef.current, fullLog);
          if (next !== committedRef.current) { committedRef.current = next; setCommitted(next); }
        }
        const q = await admin(port, 'GET', '/admin/questions');
        const qs = JSON.stringify(q.questions ?? []);
        if (qs !== lastSeen.current.questions) { lastSeen.current.questions = qs; setQuestions(q.questions ?? []); }
        const d = await admin(port, 'GET', '/admin/diag?limit=200');
        const ds = JSON.stringify(d.diag ?? []);
        if (ds !== lastSeen.current.diag) { lastSeen.current.diag = ds; setDiag(d.diag ?? []); }
        const td = await admin(port, 'GET', '/admin/todo');
        const tds = JSON.stringify(td.todo ?? null);
        if (tds !== lastSeen.current.todo) { lastSeen.current.todo = tds; setTodoState(td.todo ?? null); }
        // 恢复提示:首次拿到 paused 且还有未完任务的清单(如重启办公室后)提示 /todo resume,只弹一次。
        if (!todoHinted.current && td.todo && td.todo.state === 'paused') {
          const left = td.todo.tasks.filter((x: any) => x.status === 'pending' || x.status === 'current').length;
          if (left > 0) { todoHinted.current = true; setStatus(t().todoResumeHint(left, td.todo.tasks.length)); }
        }
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
      if (a.kind === 'office') { openBrowser(`http://127.0.0.1:${port}/office?lang=${getLocale()}`); setStatus(t().officeOpened); return; }
      if (a.kind === 'say') { const r = await admin(port, 'POST', '/admin/say', { to: a.to, message: expand(a.message), urgent: a.urgent }); setStatus(r.ok ? (a.urgent ? t().urgentOk(a.to) : t().sayOk(a.to)) : '⚠ ' + t().sayUndelivered(a.to, r.error ?? t().guardrailBlocked)); return; }
      if (a.kind === 'broadcast') { await admin(port, 'POST', '/admin/broadcast', { message: expand(a.message), urgent: a.urgent }); setStatus(a.urgent ? t().urgentBroadcastOk : t().broadcastOk); return; }
      if (a.kind === 'reply') {
        const target = lastReplyTarget(log);
        if (!target) { setStatus(t().noReplyTarget); return; }
        const r = await admin(port, 'POST', '/admin/say', { to: target, message: expand(a.message), urgent: a.urgent });
        setStatus(r.ok ? (a.urgent ? t().urgentOk(target) : t().replyOk(target)) : '⚠ ' + t().sayUndelivered(target, r.error ?? t().guardrailBlocked));
        return;
      }
      if (a.kind === 'add') { const r = await admin(port, 'POST', '/admin/add', a.spec); setStatus(r.ok ? t().addOk(a.spec.name) : '⚠ ' + (r.error ?? t().addFailed)); return; }
      if (a.kind === 'remove') { const r = await admin(port, 'POST', '/admin/remove', { name: a.name }); setStatus(r.ok ? t().removeOk(a.name) : '⚠ ' + (r.error ?? t().removeFailed)); return; }
      if (a.kind === 'restart') { const r = await admin(port, 'POST', '/admin/restart', { name: a.name, fresh: a.fresh }); setStatus(r.ok ? t().restartOk(a.name) : '⚠ ' + (r.error ?? t().restartFailed)); return; }
      if (a.kind === 'todo') {
        if (a.op === 'list') { setTodoView(true); return; }
        const r = await admin(port, 'POST', '/admin/todo', { op: a.op, body: a.body, seq: a.seq, n: a.n });
        setStatus(r.ok ? (a.op === 'add' && typeof r.seq === 'number' ? t().todoAddOk(r.seq) : t().todoOpOk(a.op)) : '⚠ ' + (r.error ?? t().unknownError));
        return;
      }
      if (a.kind === 'leadreset') {
        const r = await admin(port, 'POST', '/admin/leadreset', { enabled: a.enabled, every: a.every });
        setStatus(r.ok ? t().leadResetSet(r.enabled as boolean, r.every as number) : '⚠ ' + (r.error ?? t().unknownError));
        return;
      }
      if (a.kind === 'clear') {
        const r = await admin(port, 'POST', '/admin/clear', { name: a.name });
        // /clear 全员(无名)成功:重置 committed——视口自绘,数据清了屏就清了(alt screen 无 scrollback 残留)。
        // /clear <名字> 只清那个 pane 上下文,不动消息历史。
        if (r.ok && !a.name) {
          committedRef.current = [];
          setCommitted([]);
          lastSeen.current.log = '';
          setLog([]); // pending 由 log 派生,清空 log 即清空"等送达"计数
          setScrollOff(0);
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
  const inputDest: { mode: 'cmd' | 'broadcast' | 'to' | 'none'; to?: string; urgent?: boolean } = (() => {
    let s = input.replace(/^\s+/, '');
    // 句首 !/！ = 插队:剥掉后按原逻辑判目标,chip 加 ⚡ 让"这条会插队"一眼可见(与 parse 的剥前缀规则一致)。
    // 剥后余文以 / 开头时 parse 实际会报错,chip 仍按 cmd 显示即可,发送时自有报错,不在此过度设计。
    const urgent = s.startsWith('!') || s.startsWith('！');
    if (urgent) s = s.slice(1).replace(/^\s+/, '');
    if (s.startsWith('/')) return { mode: 'cmd', urgent };
    if (s.startsWith('@')) {
      const name = s.slice(1).split(/\s/)[0];
      if (name === 'all') return { mode: 'broadcast', urgent };
      if (name) return { mode: 'to', to: name, urgent };
    }
    return replyTarget ? { mode: 'to', to: replyTarget, urgent } : { mode: 'none', urgent };
  })();
  const cmd = commandState(input);
  const todoSub = todoSubState(input); // "/todo <部分子命令>":commandState 出现空格即失活,子命令补全单独接
  const mention = mentionState(input, names);
  let items: { label: string; hint: string }[] = [];
  let complete: ((i: number) => string) | null = null;
  if (cmd.active) {
    items = cmd.matches.map((c) => ({ label: c.usage, hint: c.hint }));
    complete = (i) => applyCommand(cmd.matches[i].name);
  } else if (todoSub.active) {
    items = todoSub.matches.map((s) => ({ label: '/todo ' + s, hint: '' }));
    complete = (i) => '/todo ' + todoSub.matches[i] + ' ';
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

  // 历史区内容按"屏幕行"扁平化:banner + 每条消息(头部行 + 自折行的正文 + 空行)。
  // 自己折行(而非交给 Ink wrap)使 1 项=1 屏幕行,回看偏移才能按行精确滚动;
  // 宽度/花名册配色变了整体重算(≤100 条消息,开销可忽略)。
  const flatLines = useMemo<StyledSeg[][]>(() => {
    const width = Math.max(8, cols - 1);
    // committed 是首见快照,取消状态(canceled)发生在之后——从实时 log 按 id 查最新态。
    const liveById = new Map<string, any>(log.map((m: any) => [m.id, m]));
    const out: StyledSeg[][] = [
      [{ text: '╔═╗╔═╗╦  ╦╔╗╔╦╔═╔═╗', color: 'cyan', bold: true }],
      [{ text: '╠╣ ╠═╣║  ║║║║╠╩╗╚═╗', color: 'cyan', bold: true }],
      [{ text: '╚  ╩ ╩╩═╝╩╝╚╝╩ ╩╚═╝', color: 'cyan', bold: true }],
      [{ text: `v${VERSION} · ${tagline}`, dim: true }],
      [],
    ];
    for (const m of committed) {
      const header: StyledSeg[] = [];
      if (m.ts) header.push({ text: formatTime(m.ts) + ' ', dim: true });
      header.push(
        { text: String(m.from), color: colorFor(m.from), bold: true },
        { text: ' → ' },
        { text: String(m.to), color: colorFor(m.to), bold: true },
      );
      // 实时态优先,被 100 条窗口挤出 log 的回退到 committed 首见快照(发送时即带的标记不丢)。
      if ((liveById.get(m.id) ?? m).canceled) header.push({ text: t().canceledMark, color: 'red', dim: true });
      if ((liveById.get(m.id) ?? m).urgent) header.push({ text: t().urgentMark, color: 'yellow' });
      for (const row of wrapSegs(header, width)) out.push(row);
      for (const line of renderMarkdown(String(m.body)))
        for (const row of wrapSegs(line, width - 2)) out.push([{ text: '  ' }, ...row]);
      out.push([]);
    }
    return out;
    // colorFor 由 roster 派生(每帧新引用),依赖列 roster 本体。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed, cols, roster, tagline, log]);

  // 新行追加时锚定回看位置:offset 按"距底行数"计,不补偿增量会被新消息顶着跑;实时态(0)保持贴底。
  const totalLinesRef = useRef(0);
  useEffect(() => {
    const grew = Math.max(0, flatLines.length - totalLinesRef.current);
    totalLinesRef.current = flatLines.length;
    setScrollOff((o) => (o > 0 ? clampOffset(o + grew, flatLines.length, viewHRef.current) : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatLines.length]);

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
    if (ev.type === 'ctrl' && ev.key === 'c') {
      if (input.length > 0) { setInput(''); setCursor(0); setHistIdx(null); return; } // 有内容:先清空输入,不退出(标准 REPL 手感)
      setConfirmExit(true); return;                                                   // 输入为空:走退出确认
    }

    // 滚轮(1007 burst)/PageUp/PageDown:滚回看视口。浮层菜单开着时滚轮代行 ↑/↓ 选项(CC 同款手感)。
    const totalLines = flatLines.length;
    const page = Math.max(1, viewHRef.current - 1);
    if (ev.type === 'scroll') {
      const menuActive = wizard || langPick !== null || leadPick !== null || qCancel !== null || todoView || active || (answering && !!pendingQ && scrollOff === 0);
      if (menuActive) { handleKey({ type: ev.dir }); return; }
      setScrollOff((o) => clampOffset(o + (ev.dir === 'up' ? ev.n : -ev.n), totalLines, viewHRef.current));
      return;
    }
    if (ev.type === 'pageup') { setScrollOff((o) => clampOffset(o + page, totalLines, viewHRef.current)); return; }
    if (ev.type === 'pagedown') { setScrollOff((o) => clampOffset(o - page, totalLines, viewHRef.current)); return; }

    // 任务清单浮层:Esc/Enter 关闭,其它键吞掉(只读列表,无选中态)。
    if (todoView) {
      if (ev.type === 'esc' || ev.type === 'enter') { setTodoView(false); return; }
      return;
    }

    // 向导模式：优先处理
    if (wizard) {
      if (ev.type === 'esc') { setWizard(null); setStatus(t().wizardCancelled); return; }
      if (wizard.step === 'cli') {
        if (ev.type === 'up') { setWizard({ ...wizard, sel: Math.max(0, wizard.sel - 1) }); return; }
        if (ev.type === 'down') { setWizard({ ...wizard, sel: Math.min(CLIS.length - 1, wizard.sel + 1) }); return; }
        if (ev.type === 'enter' || ev.type === 'tab') { setWizard({ name: wizard.name, step: 'model', cli: CLIS[wizard.sel], sel: 0 }); return; }
        return;
      }
      if (wizard.step === 'model') {
        // 模型预设选择:↑↓ 在预设里移动,enter/tab 确认;选中"自定义…"哨兵转文本子步
        const presets = MODEL_PRESETS(wizard.cli);
        if (ev.type === 'up') { setWizard({ ...wizard, sel: Math.max(0, wizard.sel - 1) }); return; }
        if (ev.type === 'down') { setWizard({ ...wizard, sel: Math.min(presets.length - 1, wizard.sel + 1) }); return; }
        if (ev.type === 'enter' || ev.type === 'tab') {
          const picked = presets[wizard.sel];
          if (picked.value === 'custom') { setWizard({ name: wizard.name, step: 'model-custom', cli: wizard.cli, modelText: '' }); return; }
          setWizard({ name: wizard.name, step: 'role', cli: wizard.cli, model: picked.value, roleText: '' });
          return;
        }
        return;
      }
      if (wizard.step === 'model-custom') {
        if (ev.type === 'enter') { setWizard({ name: wizard.name, step: 'role', cli: wizard.cli, model: wizard.modelText.trim() || undefined, roleText: '' }); return; }
        if (ev.type === 'backspace') { setWizard({ ...wizard, modelText: wizard.modelText.slice(0, -1) }); return; }
        if (ev.type === 'text') { setWizard({ ...wizard, modelText: wizard.modelText + ev.text }); return; }
        return;
      }
      if (wizard.step === 'role') {
        if (ev.type === 'enter') { setWizard({ name: wizard.name, step: 'cwd', cli: wizard.cli, model: wizard.model, role: wizard.roleText.trim() || t().wizardDefaultRole, path: defaultCwd, sel: 0 }); return; }
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
          const r = await admin(port, 'POST', '/admin/add', { name: w.name, cli: w.cli, cwd: w.path, role: w.role, model: w.model });
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

    // 取消排队浮层:↑↓ 选 · Enter 取消选中那条 · Esc 关闭。列表随轮询刷新,可连续取消多条。
    if (qCancel !== null) {
      const selIdx = Math.min(qCancel, Math.max(0, queuedMsgs.length - 1));
      if (ev.type === 'esc') { setQCancel(null); return; }
      if (ev.type === 'up') { setQCancel(Math.max(0, selIdx - 1)); return; }
      if (ev.type === 'down') { setQCancel(Math.min(Math.max(0, queuedMsgs.length - 1), selIdx + 1)); return; }
      if (ev.type === 'enter') {
        const target = queuedMsgs[selIdx];
        if (!target) { setQCancel(null); return; }
        void (async () => {
          const r = await admin(port, 'POST', '/admin/cancel', { id: target.id });
          setStatus(r.ok ? t().qcancelOk(target.to) : '⚠ ' + t().qcancelFailed);
          if (r.ok) {
            // 本地即时把该条标记非排队(不等下轮轮询),列表/等送达计数立刻缩。
            // 函数式更新:按键时刻闭包里的 log 可能已被在途轮询响应刷新,整组覆盖会把新数据滚回旧快照。
            setLog((prev) => prev.map((m: any) => (m.id === target.id ? { ...m, queued: false, canceled: true } : m)));
            // 清空去重串强制下轮轮询全量重同步:乐观结果与服务端串不同,否则去重会跳过、陈旧态滞留不自愈。
            lastSeen.current.log = '';
          }
        })();
        return;
      }
      if (ev.type === 'text' && ev.text === '!') {
        const target = queuedMsgs[selIdx];
        if (!target) { setQCancel(null); return; }
        void (async () => {
          const r = await admin(port, 'POST', '/admin/promote', { id: target.id });
          setStatus(r.ok ? t().qpromoteOk(target.to) : '⚠ ' + t().qpromoteFailed);
          if (r.ok) {
            // 本地即时翻状态(不等下轮轮询):排队列表立刻缩、历史行立刻标 ⚡。
            // 函数式更新+强制重同步,理由同上方 Enter 取消分支。
            setLog((prev) => prev.map((m: any) => (m.id === target.id ? { ...m, queued: false, urgent: true } : m)));
            lastSeen.current.log = '';
          }
        })();
        return;
      }
      return; // 浮层吞掉其它键
    }

    // 回看态(scrollOff>0,且无向导/选择器浮层):↑/↓ 逐行滚、Esc 回底;
    // 打字/回车/退格自动回底后继续正常处理(CC 同款:一输入即跳回最新)。
    if (scrollOff > 0) {
      if (ev.type === 'up') { setScrollOff((o) => clampOffset(o + 1, flatLines.length, viewHRef.current)); return; }
      if (ev.type === 'down') { setScrollOff((o) => clampOffset(o - 1, flatLines.length, viewHRef.current)); return; }
      if (ev.type === 'esc') { setScrollOff(0); return; }
      if (ev.type === 'text' || ev.type === 'enter' || ev.type === 'shift-enter' || ev.type === 'backspace') setScrollOff(0); // 不 return,落到正常处理
    }

    // Esc(输入空、无浮层、非答题):有排队消息 → 打开取消排队浮层。答题态的 Esc(跳过问题)优先级更高,在下方处理。
    if (ev.type === 'esc' && input === '' && !answering && queuedMsgs.length > 0) { setQCancel(0); return; }

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

  // 监听器只挂一次,经 ref 调用**最新一次渲染**的 handleKey 闭包。
  // 老模式(每帧重挂、依赖数组列全状态)有竞态:按键若在 setState 后、effect 重订阅前到达,
  // 会打进过期闭包(实测 Esc 开浮层后紧跟 Enter 会丢)。ref 在渲染期更新,无此窗口。
  const handleKeyRef = useRef(handleKey);
  handleKeyRef.current = handleKey;
  useEffect(() => {
    if (!stdin) return;
    // 1007 滚轮 ≈ 方向键(为保终端原生拖选复制,我们故意不开鼠标上报),字节层无法区分滚轮与键盘 ↑↓。
    // 同 chunk 连发 ≥2 个方向键铁定是滚轮(wheelBurst),立即作 scroll、无延迟。
    // 但部分终端把一格滚轮拆成**跨 chunk 的多个单发**、或每格只发 1 个 ↑/↓——这些单发会被 decodeKey
    // 当普通方向键,在贴底(scrollOff===0)时落进"输入历史"分支 → 滚轮改了输入框内容(boss 报的 bug)。
    // 对策:孤立单个 ↑/↓ 先进缓冲、延 WHEEL_COALESCE_MS 结算;窗口内又来同向方向键就累加 → 判为滚轮连发
    // (n≥2 → scroll 回看);窗口内无后续才结算为真实键盘方向键(贴底翻输入历史 / 回看态逐行滚)。
    // 这样滚轮永不触发输入历史,而键盘 ↑↓ 行为不变;原生复制不受影响(未改成鼠标上报)。
    let pend: { dir: 'up' | 'down'; n: number } | null = null;
    let pendTimer: ReturnType<typeof setTimeout> | null = null;
    const flushPend = () => {
      if (pendTimer) { clearTimeout(pendTimer); pendTimer = null; }
      if (!pend) return;
      const { dir, n } = pend; pend = null;
      handleKeyRef.current(n >= 2 ? { type: 'scroll', dir, n } : { type: dir });
    };
    const onData = (d: Buffer | string) => {
      const s = d.toString();
      const w = wheelBurst(s);
      if (w) { // 同 chunk 连发:铁定滚轮——并入任何同向待定单发后立即派发为 scroll
        if (pend && pend.dir === w.dir) { w.n += pend.n; pend = null; if (pendTimer) { clearTimeout(pendTimer); pendTimer = null; } }
        else flushPend();
        handleKeyRef.current({ type: 'scroll', dir: w.dir, n: w.n });
        return;
      }
      const ev = decodeKey(s);
      if (ev.type === 'up' || ev.type === 'down') { // 单发方向键:进缓冲,等窗口判滚轮/键盘
        if (pend && pend.dir !== ev.type) flushPend(); // 反向先结算旧的
        pend = { dir: ev.type, n: (pend?.n ?? 0) + 1 };
        if (pendTimer) clearTimeout(pendTimer);
        pendTimer = setTimeout(flushPend, WHEEL_COALESCE_MS);
        return;
      }
      flushPend(); // 其它键:先结算待定方向键(保序),再处理本键
      handleKeyRef.current(ev);
    };
    stdin.on('data', onData);
    return () => { stdin.off('data', onData); if (pendTimer) clearTimeout(pendTimer); };
  }, [stdin]);

  const color = (s: string) => (s === 'idle' ? 'green' : s === 'busy' ? 'yellow' : s === 'dead' ? 'red' : 'gray');

  // 协作诊断警告:有守卫丢消息/注入失败/可疑过早 idle 时顶一行,提醒可能卡死。
  // 只算最近 DIAG_WINDOW_MS 内的事件——按时间窗(而非全部历史)计数,事情平息后横幅自动消退,
  // 再出现即代表"此刻在发生",避免一两条陈旧事件把告警长期粘住(alarm fatigue)。
  const diagSince = Date.now() - DIAG_WINDOW_MS;
  const recentDiag = diag.filter((e) => typeof e?.ts === 'number' && e.ts >= diagSince);
  const drops = recentDiag.filter((e) => e?.kind === 'guard-drop').length;
  const injFails = recentDiag.filter((e) => e?.kind === 'inject-fail').length;
  const fastIdle = recentDiag.filter((e) => e?.kind === 'auto-idle').length;
  const hasDiag = drops || injFails || fastIdle;

  // 失联员工警告(roster 驱动:员工一恢复 MCP 调用标志即清,警告行自动消失)。
  const unresp = roster.filter((a) => a.unresponsive).map((a) => ({ name: a.name, mcpSeen: !!a.mcpSeen, rule: a.rule }));

  return (
    // alt screen 全屏自绘(CC 同款):根盒钉 rows-1 × cols-1(严格小于终端行/列数,
    // 防末行换行顶滚;宽度留 1 列余量,Ink 的截断边界变成 cols-1,决不产出恰满宽行——
    // =cols 的行会让 iTerm 进入行尾 pending-wrap,>cols 直接物理折行,都会顶滚出残影)。
    // 历史区贴底渲染+overflow 裁顶:渲染行数恒给足 rows-1 行(≥视口容量),实际可见高度由 flex 决定,
    // 溢出的从顶部裁掉——无需精确计算活区高度。底部活区 flexShrink=0 钉死,滚动只动历史区切片。
    <Box flexDirection="column" height={rows - 1} width={cols - 1}>
      <Box flexDirection="column" flexGrow={1} overflow="hidden" justifyContent="flex-end">
        {sliceView(flatLines, scrollOff, rows - 1).map((segs, i) => (
          // 每行套 flexShrink=0 盒钉 1 行高:不钉的话 yoga 会把超高内容**压缩**(隔行丢失)而不是裁顶。
          <Box key={i} flexShrink={0}>
            <Text wrap="truncate-end">
              {segs.length === 0 ? ' ' : segs.map((sg, k) => (
                <Text key={k} color={sg.color} bold={sg.bold} italic={sg.italic} underline={sg.underline} strikethrough={sg.strikethrough} dimColor={sg.dim}>{sg.text}</Text>
              ))}
            </Text>
          </Box>
        ))}
      </Box>

      {/* 活区:回看提示 + 花名册 statusline + 等送达 + 诊断 + 输入/浮层 + 状态行。
          所有单行 UI <Text> 一律 wrap="truncate-end":1 UI 行=1 屏幕行是活区高度
          (viewHRef 测量)与"帧高 ≤ rows-1"不变式的前提,长行截断绝不折行。 */}
      <Box ref={bottomBoxRef} flexDirection="column" flexShrink={0}>
        {scrollOff > 0 ? <Text color="yellow" wrap="truncate-end">{t().browseHint(scrollOff)}</Text> : null}
        {roster.length ? (
          <Text wrap="truncate-end">
            {roster.map((a, i) => (
              <Text key={a.name}>
                {i ? <Text dimColor> · </Text> : null}
                <Text color={color(a.status)}>{statusGlyph(a.status, !!a.virtual, frame)} </Text>
                <Text color={colorFor(a.name)} bold>{a.name}</Text>
                {a.lead ? <Text color="cyan" bold> ♔</Text> : null}
                {a.unresponsive ? <Text color="red" bold> ⚠</Text> : null}
              </Text>
            ))}
          </Text>
        ) : null}
        {pending.length ? (() => {
          // 目标名单按显示宽预截(clipDisp),保住行尾 "Esc 取消排队" 操作提示——
          // 交给 truncate-end 截行尾的话,超长名单会把提示顶没。truncate-end 仍留作兜底。
          const budget = Math.max(8, cols - 1 - dispWidth(t().pendingDeliver('')));
          const targets = pending.map((p) => '→ ' + p.to + (p.n > 1 ? ' ×' + p.n : '')).join(' · ');
          return <Text color="yellow" wrap="truncate-end">{t().pendingDeliver(clipDisp(targets, budget))}</Text>;
        })() : null}
        {unresp.length ? <Text color="red" wrap="truncate-end">{t().unresponsiveWarn(unresp)}</Text> : null}
        {hasDiag ? <Text color="yellow" wrap="truncate-end">{t().diagWarn(drops, injFails, fastIdle)}</Text> : null}
        {/* todolist 进度常驻行:running/paused 时显示 已完成+当前/总数 与当前任务首行 */}
        {todoState && (todoState.state === 'running' || todoState.state === 'paused') ? (() => {
          const cur = todoState.tasks.find((x: any) => x.status === 'current');
          const k = todoState.tasks.filter((x: any) => x.status === 'done' || x.status === 'failed').length + (cur ? 1 : 0);
          const waiting = typeof todoState.waitUntil === 'number' && todoState.waitUntil > Date.now()
            ? t().todoWaitSeg(todoState.waitReason ?? '', formatTime(todoState.waitUntil)) : '';
          return <Text color="cyan" wrap="truncate-end">{t().todoProgressLine(k, todoState.tasks.length, cur ? String(cur.body).split('\n')[0].slice(0, 60) : '-', todoState.state === 'paused')}{waiting}</Text>;
        })() : todoState && todoState.state === 'idle' && todoState.tasks.length > 0 ? (
          <Text color="cyan" wrap="truncate-end">{t().todoPendingLine(todoState.tasks.length)}</Text>
        ) : null}

        {confirmExit ? (
          <Box marginTop={1}>
            <Text color="yellow" wrap="truncate-end">{t().exitConfirmTitle}</Text>
            <Text bold wrap="truncate-end">{t().exitConfirmKeys}</Text>
          </Box>
        ) : langPick !== null ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color="yellow" wrap="truncate-end">{t().langPickTitle}</Text>
            {LANG_OPTS.map((o, i) => (
              <Text key={o.v} inverse={i === langPick} wrap="truncate-end">  {o.label}</Text>
            ))}
          </Box>
        ) : leadPick !== null ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color="yellow" wrap="truncate-end">{t().leadCmdPickTitle}</Text>
            {leadOpts.length === 0 ? (
              <Text dimColor wrap="truncate-end">  {t().leadPickEmpty}</Text>
            ) : leadOpts.map((nm, i) => (
              <Text key={nm} inverse={i === leadPick} wrap="truncate-end">  <Text color={colorFor(nm)} bold>{nm}</Text></Text>
            ))}
          </Box>
        ) : qCancel !== null ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color="yellow" wrap="truncate-end">{t().qcancelTitle(queuedMsgs.length)}</Text>
            {queuedMsgs.map((m: any, i: number) => (
              <Text key={m.id} inverse={i === Math.min(qCancel, Math.max(0, queuedMsgs.length - 1))} wrap="truncate-end">
                {'  → '}<Text color={colorFor(m.to)} bold>{m.to}</Text>{'  '}{String(m.body).replace(/\s+/g, ' ').slice(0, 60)}
              </Text>
            ))}
          </Box>
        ) : todoView ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color="yellow" wrap="truncate-end">{t().todoListTitle}</Text>
            {!todoState || todoState.tasks.length === 0 ? (
              <Text dimColor wrap="truncate-end">  {t().todoListEmpty}</Text>
            ) : todoState.tasks.map((x: any) => (
              <Text key={x.seq} wrap="truncate-end">  {x.status === 'done' ? '✅' : x.status === 'failed' ? '❌' : x.status === 'current' ? '▶' : '·'} #{x.seq} {String(x.body).split('\n')[0].slice(0, 70)}{x.result ? ` — ${String(x.result).slice(0, 40)}` : ''}</Text>
            ))}
          </Box>
        ) : wizard ? (
          <Box flexDirection="column" marginTop={1}>
            {wizard.step === 'cli' ? (
              <>
                <Text wrap="truncate-end">{t().wizardAddPrefix}<Text bold>{wizard.name}</Text>{t().wizardCliSuffix}</Text>
                {CLIS.map((c, i) => (
                  <Text key={c} inverse={i === wizard.sel} wrap="truncate-end">  {c}{c === 'codex' ? t().wizardExperimental : ''}</Text>
                ))}
              </>
            ) : wizard.step === 'model' ? (
              <>
                <Text wrap="truncate-end">{t().wizardAddPrefix}<Text bold>{wizard.name}</Text> [{wizard.cli}]{t().wizardModelPickSuffix}</Text>
                {MODEL_PRESETS(wizard.cli).map((p, i) => (
                  // custom 是哨兵不是模型名,value 列不显示它(否则 UI 裸露 "custom" 中英混排)
                  <Text key={p.key} inverse={i === wizard.sel} wrap="truncate-end">  {p.key === 'custom' ? '' : `${p.value ?? t().wizardModelDefaultLabel}  `}{t().wizardModelPresets[p.key] ?? ''}</Text>
                ))}
              </>
            ) : wizard.step === 'model-custom' ? (
              <>
                <Text wrap="truncate-end">{t().wizardAddPrefix}<Text bold>{wizard.name}</Text> [{wizard.cli}]{t().wizardModelSuffix}</Text>
                <Box><Text color="green">› </Text><Text wrap="truncate-end">{wizard.modelText}</Text><Text inverse> </Text></Box>
                <Text dimColor wrap="truncate-end">{t().wizardModelHint}</Text>
              </>
            ) : wizard.step === 'role' ? (
              <>
                <Text wrap="truncate-end">{t().wizardAddPrefix}<Text bold>{wizard.name}</Text> [{wizard.cli}{wizard.model ? '·' + wizard.model : ''}]{t().wizardRoleSuffix}</Text>
                <Box><Text color="green">› </Text><Text wrap="truncate-end">{wizard.roleText}</Text><Text inverse> </Text></Box>
                <Text dimColor wrap="truncate-end">{t().wizardRoleExample}</Text>
              </>
            ) : (
              <>
                <Text wrap="truncate-end">{t().wizardAddPrefix}<Text bold>{wizard.name}</Text> [{wizard.cli}·{wizard.role}]{t().wizardCwdSuffix}</Text>
                <Box><Text color="green">› </Text><Text wrap="truncate-end">{wizard.path}</Text><Text inverse> </Text></Box>
                {dirSuggestions(wizard.path, fsListDirs).map((d, i) => (
                  <Text key={d} inverse={i === wizard.sel} wrap="truncate-end">  {d}</Text>
                ))}
                <Text dimColor wrap="truncate-end">{t().wizardCwdDefault}</Text>
              </>
            )}
          </Box>
        ) : (
          <>
            {answering && pendingQ ? (
              <Box flexDirection="column" marginTop={1}>
                <Text color="yellow" wrap="wrap">{t().questionAsk(pendingQ.from, pendingQ.question)}</Text>
                {pendingQ.options.map((o: string, i: number) => (
                  <Text key={i} inverse={i === qSelClamped} wrap="wrap">  {i + 1}. {o}</Text>
                ))}
                <Text inverse={onCustomSlot} dimColor={!onCustomSlot} wrap="truncate-end">  {t().answerCustom}</Text>
                {customAns !== null ? (
                  <Text wrap="truncate-end">{t().answerCustomPrompt}<Text color="green">{customAns}</Text><Text inverse> </Text></Text>
                ) : (
                  <Text dimColor wrap="truncate-end">{t().answerKeys}{questions.length > 1 ? t().answerMore(questions.length - 1) : ''}{t().answerOrType}</Text>
                )}
              </Box>
            ) : null}
            {/* 输入行例外:多行输入(Shift+Enter)+长输入折行是功能,故保默认 wrap;
                折出的物理行数由 measureElement 计入活区高度,几何不变式仍成立。 */}
            <Box marginTop={1}>
              <Text>
                {inputDest.mode === 'cmd' ? <Text color="magenta" bold>⌘ </Text>
                 : inputDest.mode === 'broadcast' ? <Text>{inputDest.urgent ? <Text color="yellow" bold>⚡ </Text> : null}<Text color="yellow" bold>📢 {t().clearAll} </Text></Text>
                 : inputDest.mode === 'to' ? <Text>{inputDest.urgent ? <Text color="yellow" bold>⚡ </Text> : null}<Text dimColor>→ </Text><Text color={colorFor(inputDest.to!)} bold>{inputDest.to}</Text><Text> </Text></Text>
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
                  <Text key={it.label} inverse={i === selClamped} wrap="truncate-end">  {it.label}{it.hint ? '   ' + it.hint : ''}</Text>
                ))}
              </Box>
            ) : (
              <Text dimColor wrap="truncate-end">{t().inputHint(replyTarget ?? t().noReplyTargetShort)}</Text>
            )}
          </>
        )}
        {status ? <Text dimColor wrap="truncate-end">{status}</Text> : null}
      </Box>
    </Box>
  );
}
