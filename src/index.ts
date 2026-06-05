import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from './core/config.js';
import { Router } from './core/router.js';
import type { AgentRuntime, Message } from './core/types.js';
import { Guards } from './core/guards.js';
import { makeDeliverer, detectScreenState, isPaneBusy } from './orchestrator.js';
import { ITerm2Driver } from './terminal/iterm.js';
import { startBus, type Bus } from './bus/server.js';
import { mcpConfigFor, buildAgentLaunch } from './agent/mcp-config.js';
import { runtimeDir, runtimePath, consoleLaunchCommand, writeInstance, readInstance, removeInstanceIfOwner, removeInstanceFile, instancePath } from './runtime.js';
import { probeBus } from './discovery.js';
import { renderConsole } from './console/run.js';
import { chooseAnchor } from './terminal/anchor.js';
import { loadStore, saveStore, pruneToAgents, type SessionStore } from './session/store.js';
import { decideClaudeSession, decideCodexSession } from './session/decide.js';
import { parseStatusSessionId } from './session/capture.js';
import { addAgentToConfigFile, removeAgentFromConfigFile } from './team-persist.js';
import { loadMessageLog, appendMessageLog, MESSAGE_LOG_CAP } from './message-log.js';
import { t, setLocale, detectLocale } from './i18n/index.js';
import { saveSettings } from './settings.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function up(configPath: string) {
  const cfg = parseConfig(JSON.parse(readFileSync(configPath, 'utf8')));
  const driver = new ITerm2Driver();
  let n = 0;
  const guards = new Guards(cfg.guards, () => Date.now());
  // 包一层 deliverer：记录每个员工"最近一次被投递"的时刻，给自动空闲检测做投递后宽限（防投递空窗误判）。
  const lastDeliverAt = new Map<string, number>();
  const baseDeliverer = makeDeliverer(driver);
  const deliverer = {
    deliver(agent: AgentRuntime, msg: Message) {
      lastDeliverAt.set(agent.name, Date.now());
      baseDeliverer.deliver(agent, msg);
    },
  };
  const sessions = new Map<string, string>();
  const bootstraps = new Map<string, string>(); // name -> 完整 bootstrap（/clear 后重注入,恢复员工身份）
  const clearing = new Set<string>(); // 正在 /clear 的员工：健康轮询期间别自动 onIdle（否则会把排队消息投进正在清空的 pane）
  const launchCwd = (() => { try { return realpathSync(process.cwd()); } catch { return process.cwd(); } })();
  const router = new Router(deliverer, {
    now: () => Date.now(), genId: () => `m${++n}`, routes: cfg.routes, guards,
    logCap: MESSAGE_LOG_CAP,
    onLog: (msg) => { try { appendMessageLog(launchCwd, msg); } catch { /* 持久化失败不致命 */ } },
  });
  router.addVirtual('boss');
  router.seedLog(loadMessageLog(launchCwd) as Message[]); // 恢复历史消息流水

  const store: SessionStore = loadStore(launchCwd);
  pruneToAgents(store, cfg.agents.map((a) => a.name));
  const tmp = mkdtempSync(join(tmpdir(), 'falinks-'));
  let bus: Bus;
  let lastRight = '';      // 上次新建的右侧 pane,作为下次分屏的首选锚点
  let consoleSid = '';     // 控制台 pane(左侧):整个会话期间一定活着,作为锚点的永久兜底

  async function launchInto(
    anchor: string,
    dir: 'vertical' | 'horizontal',
    a: { name: string; cli: string; cwd: string; role?: string; bootstrap?: string },
  ): Promise<string> {
    const cfgPath = join(tmp, `${a.name}-mcp.json`);
    writeFileSync(cfgPath, JSON.stringify(mcpConfigFor(a.name, bus.port)));

    const fullBootstrap =
      `${t().houseRules}\n${t().identityLine(a.name, a.role)}${a.bootstrap ?? ''}`;
    bootstraps.set(a.name, fullBootstrap); // 供 /clear 后重注入

    // 决定 fresh / resume，并据此选注入文本与命令参数。
    let resuming = false;
    let sessionId: string | undefined;
    let resumeId: string | undefined;
    let claudeSessionId: string | undefined; // claude 首启用 --session-id 的确定性 id

    if (a.cli === 'claude') {
      const d = decideClaudeSession(store, a.name, a.cwd, randomUUID);
      resuming = d.mode === 'resume';
      if (resuming) resumeId = d.sessionId;
      else claudeSessionId = d.sessionId;
      sessionId = d.sessionId; // 两种情况都把这个 id 落盘
    } else if (a.cli === 'codex') {
      const d = decideCodexSession(store, a.name);
      if (d.mode === 'resume') { resuming = true; resumeId = d.sessionId; sessionId = d.sessionId; }
    }

    const { command, needsBootstrapInject } = buildAgentLaunch(a.cli, {
      name: a.name, busPort: bus.port, mcpConfigPath: cfgPath,
      bootstrap: fullBootstrap, sessionId: claudeSessionId, resumeId,
    });

    const sid = await driver.splitFrom(anchor, dir, { cwd: a.cwd, command });
    sessions.set(a.name, sid);
    router.addAgent(a.name, a.role);
    await driver.setName(sid, a.name).catch(() => {}); // pane 标题=员工名

    // 慢活（就绪检测/注入 bootstrap/抓 codex id/落盘）放后台，不阻塞控制台渲染——
    // 员工就绪后自己 register，花名册会从 [launching] 自动变 [idle]。pane 已建好，sid 立即可返回。
    void (async () => {
      try {
        let sid2 = sessionId;
        if (needsBootstrapInject) {
          // claude：信任对话→就绪。首启注入 bootstrap；恢复则什么都不注入（避免 CLI 重放旧任务再做一遍），仅服务端登记。
          for (let i = 0; i < 30; i++) {
            await sleep(700);
            const state = detectScreenState(await driver.readScreen(sid));
            if (state === 'trust-dialog') { await driver.inject(sid, '', true); continue; }
            if (state === 'ready') { if (!resuming) await driver.inject(sid, fullBootstrap, true); break; }
          }
        } else {
          // codex：首启 bootstrap 作为命令位置参数；恢复则命令不带 prompt。盲发 Enter 接受信任目录对话。
          await sleep(2500);
          await driver.inject(sid, '', true);
          await sleep(1500);
          await driver.inject(sid, '', true);
          await sleep(3000);
          await driver.inject(sid, '', true); // 第三次兜底（codex 启动慢时前两次可能太早）

          // codex 首启：注入 /status 读屏抓 session id（轮询重试，员工忙时也能抓到）。
          if (!resuming) {
            for (let i = 0; i < 8; i++) {
              await driver.inject(sid, '/status', true);
              await sleep(1800);
              const captured = parseStatusSessionId(await driver.readScreen(sid).catch(() => ''), 'codex');
              if (captured) { sid2 = captured; break; }
            }
          }
        }

        // 恢复：falinks 知道 sessionId，直接服务端登记（不提示员工 register、不注入），CLI 静默恢复、不重做旧任务。
        if (resuming) router.register(a.name, sid);

        // 落盘：拿到 id 才记；codex 没抓到则删掉旧条目，确保下次 fresh 而非误 resume。
        if (sid2) store.agents[a.name] = { cli: a.cli, sessionId: sid2 };
        else delete store.agents[a.name];
        saveStore(launchCwd, store);
      } catch { /* 后台准备失败忽略，员工仍可手动用 */ }
    })();

    return sid;
  }

  // 防双开:同目录的 sessions/messages 是共享的,双开必然互相污染。
  const existing = readInstance(launchCwd);
  if (existing) {
    const p = await probeBus(existing.port);
    if (p.state === 'alive' && p.info.cwd === launchCwd) {
      console.error(t().instanceAlreadyRunning(existing.port));
      process.exit(1);
    }
    if (p.state === 'unknown') {
      console.error(t().instanceMaybeRunning(existing.port, instancePath(launchCwd)));
      process.exit(1);
    }
    removeInstanceFile(instancePath(launchCwd)); // 确认死了/张冠李戴:清掉尸体
  }

  let portWarning = ''; // 显式端口被占回退时的提示;控制台模式 stderr 会被清屏吞掉,改走首条 status
  bus = await startBus({
    router,
    getSessionId: (name) => sessions.get(name),
    onAddAgent: async (spec) => {
      if (!lastRight && !consoleSid) return { ok: false, error: 'layout not ready' };
      if (router.get(spec.name)) return { ok: false, error: 'name exists' };
      // 锚点自愈:lastRight 指向的 pane 可能已被关/被删(野指针),回退到永远活着的控制台 pane。
      // 否则 splitFrom 抛 anchor not found,此后 /add 全部失败、只能重开。
      const anchor = await chooseAnchor(lastRight, consoleSid, (s) => driver.paneExists(s));
      try {
        lastRight = await launchInto(anchor, 'horizontal', spec);
      } catch (e: any) {
        return { ok: false, error: t().addFailedDetail(e?.message ?? e) };
      }
      try { addAgentToConfigFile(configPath, spec); } catch { /* 配置写回失败不致命 */ }
      return { ok: true };
    },
    onRemoveAgent: async (name) => {
      const sid = sessions.get(name);
      if (!sid) return { ok: false, error: 'unknown agent' };
      await driver.closePane(sid);
      sessions.delete(name);
      if (sid === lastRight) lastRight = consoleSid; // 删的正是当前锚点 → 复位到控制台 pane,别留野指针
      router.removeAgent(name);
      try { removeAgentFromConfigFile(configPath, name); } catch { /* 配置写回失败不致命 */ }
      return { ok: true };
    },
    onClear: async (name) => {
      if (name && !sessions.has(name)) return { ok: false, error: `unknown agent: ${name}` };
      const targets = name ? [name] : router.roster().filter((a) => !a.virtual).map((a) => a.name);
      const cleared: string[] = [];
      // 并发清空：每个员工各自 /clear → 等一下 → 重注入 bootstrap，互不阻塞（总耗时≈单个，不再 N 倍）。
      await Promise.all(targets.map(async (nm) => {
        const sid = sessions.get(nm);
        if (!sid) return;
        clearing.add(nm);                             // 清空期间健康轮询别自动 onIdle
        router.hold(nm);                              // 标忙→发来的消息排队，不投进正在清空的 pane
        try {
          await driver.inject(sid, '/clear', true);   // claude/codex 同名：清空上下文、开新会话
          await sleep(1500);
          const bs = bootstraps.get(nm);
          if (bs) await driver.inject(sid, bs, true); // 重注入 bootstrap：恢复身份+重新 register（→idle→投出排队消息）
          cleared.push(nm);
        } finally {
          clearing.delete(nm);
        }
      }));
      return { ok: true, cleared };
    },
    onShutdown: async (closePanes) => {
      if (closePanes) {
        const sids = [...sessions.values()];
        await Promise.all(sids.map((sid) => driver.closePane(sid).catch(() => {})));
        await sleep(150);
        // 兜底：偶有 pane 第一次没关掉（iTerm 忙/竞态），查一遍把漏网的重关。
        await Promise.all(sids.map(async (sid) => {
          try { if (await driver.paneExists(sid)) await driver.closePane(sid); } catch { /* ignore */ }
        }));
      }
      setTimeout(() => process.exit(0), 200); // 关完再退（分离进程模式下也要退 up）
      return { ok: true };
    },
    onLang: async (l) => {
      const eff = l === 'auto' ? detectLocale(process.env) : l;
      setLocale(eff);
      saveSettings({ locale: l }); // 存用户选择(含 auto)，下次启动 initLocale 再解析
      return eff;
    },
  }, cfg.busPort ?? 0, {
    identity: { cwd: launchCwd, startedAt: Date.now() },
    onPortFallback: (wanted, got) => { portWarning = t().portFallback(wanted, got); },
  });
  mkdirSync(runtimeDir(), { recursive: true });
  rmSync(runtimePath(), { force: true }); // 旧版全局 runtime.json:一次性迁移清理
  const inst = { port: bus.port, pid: process.pid, cwd: launchCwd, startedAt: Date.now() };
  // 安全前提：writeInstance 必须在 pane 创建循环之前执行。
  // 若败者在 exit(1) 时尚未建任何 pane，可安全退出而不留残局。
  // 请勿将 pane 创建逻辑移到此块之前。
  if (!writeInstance(inst)) {
    // wx 失败=毫秒级竞态里别人先写了:再探一次,确认死亡才覆盖,unknown 保守拒绝。
    const race = readInstance(launchCwd);
    const p = race ? await probeBus(race.port) : null;
    if (p?.state === 'alive' && p.info.cwd === launchCwd) {
      console.error(t().instanceAlreadyRunningShort(race!.port));
      process.exit(1);
    }
    if (p?.state === 'unknown') {
      console.error(t().instanceMaybeRunning(race!.port, instancePath(launchCwd)));
      process.exit(1);
    }
    // p === null（档案读不到）、p.state === 'dead'、或 alive 但 cwd 不符（张冠李戴）:确认死亡,安全覆盖。
    writeInstance(inst, undefined, { force: true });
  }
  process.on('exit', () => removeInstanceIfOwner(launchCwd, process.pid));
  process.on('SIGTERM', () => process.exit(0)); // 默认 SIGTERM 不走 exit 钩子,显式转一下
  process.on('SIGINT', () => process.exit(0));  // 非控制台模式 Ctrl-C(控制台模式 raw mode 自行处理)

  // 单窗口：若在 iTerm 交互终端里运行，当前 pane 直接当控制台，员工向右 split——只有一个窗口。
  // 否则（非 iTerm / 非 TTY）回退：另开窗口放一个独立的控制台进程。
  const here = process.env.ITERM_SESSION_ID?.split(':').pop();
  const inProcessConsole = Boolean(here) && Boolean(process.stdin.isTTY);

  if (inProcessConsole) {
    lastRight = here!;
    // 清掉选单残留，给一个干净的"准备中"画面（裸日志会很丑），就绪后再 renderConsole。
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
    process.stdout.write(
      `\n  ${t().preparingWorkers(cfg.agents.length, cfg.agents.map((a) => a.name).join(' / '))}\n` +
      `     ${t().preparingHint}\n`,
    );
  } else {
    console.log(`[falinks] bus on :${bus.port}`);
    if (portWarning) console.error(`[falinks] ${portWarning}`);
    const consoleCmd = consoleLaunchCommand(process.argv[1], process.execPath, bus.port);
    lastRight = await driver.launch({ cwd: process.cwd(), command: consoleCmd });
    await sleep(800);
  }

  let first = true;
  consoleSid = lastRight; // 此刻 lastRight=控制台 pane(两种模式皆然),记为永久兜底锚点
  for (const a of cfg.agents) {
    if (!inProcessConsole) console.log(t().launchingWorker(a.name, a.cli));
    lastRight = await launchInto(lastRight, first ? 'vertical' : 'horizontal', a);
    first = false;
  }
  if (!inProcessConsole) console.log(`[falinks] ${t().officeReady(cfg.agents.length)}`);

  // 健康轮询(1.5s)：员工 pane 被关 → 自动下线；以及自动检测空闲 → 投出排队消息。
  const IDLE_GRACE_MS = 3000; // 刚投递后这段时间内不判空闲（避开"已提交但还没开始生成"的空窗）
  const missStreak = new Map<string, number>(); // 连续探测不到 pane 的次数（去抖：osascript 高并发会瞬时误报，连续多次才下线）
  setInterval(() => {
    void (async () => {
      for (const [name, sid] of [...sessions]) {
        try {
          if (!(await driver.paneExists(sid))) {
            const n = (missStreak.get(name) ?? 0) + 1;
            missStreak.set(name, n);
            if (n < 3) continue; // 还没连续 3 次，可能是瞬时误报，先不下线
            sessions.delete(name);
            if (sid === lastRight) lastRight = consoleSid; // 下线的正是当前锚点 → 复位,别留野指针
            router.removeAgent(name);
            lastDeliverAt.delete(name);
            missStreak.delete(name);
            if (!inProcessConsole) console.log(t().workerWindowClosed(name));
            continue;
          }
          missStreak.delete(name); // 探到了，清零
          await driver.setName(sid, name); // 持续把 pane 标题钉成员工名（覆盖 CLI 自改的标题）

          // 清空中（/clear）跳过自动空闲：否则会把排队消息投进正在清空的 pane。
          if (clearing.has(name)) continue;

          // 自动检测空闲：路由认为 busy 但 pane 已回到空闲（生成结束 / 被 Ctrl+C 打断 / 没调 idle 工具）
          // → onIdle，把排队消息 pump 出去。读屏失败按"忙"处理；投递后宽限内不判，避免投递空窗误判。
          const a = router.get(name);
          if (a && a.status === 'busy' && Date.now() - (lastDeliverAt.get(name) ?? 0) > IDLE_GRACE_MS) {
            const busy = isPaneBusy(await driver.readScreen(sid).catch(() => 'esc to interrupt'));
            if (!busy) router.onIdle(name);
          }
        } catch {
          /* 探测失败忽略，下一轮再试 */
        }
      }
    })();
  }, 1500);

  // 单窗口：在当前 pane（左）进程内渲染控制台，接管本终端。
  if (inProcessConsole) renderConsole(bus.port, portWarning || undefined);
}
