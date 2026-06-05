import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
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
import { runtimeDir, runtimePath, consoleLaunchCommand } from './runtime.js';
import { renderConsole } from './console/run.js';
import { loadStore, saveStore, pruneToAgents, type SessionStore } from './session/store.js';
import { decideClaudeSession, decideCodexSession } from './session/decide.js';
import { parseStatusSessionId } from './session/capture.js';
import { addAgentToConfigFile, removeAgentFromConfigFile } from './team-persist.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 全员通用协作规则（前缀到每个员工的 bootstrap）。核心：省 token、禁客套。 */
const HOUSE_RULES =
  '【falinks 协作规则】你是办公室里的 AI 员工，通过 falinks 的 MCP 工具协作。' +
  '① 开机立刻调用 register 报到。' +
  '② 收到形如「【来自 X】…」的消息后，只有当你有实质内容（答案/数据/明确问题）时，才用 sendmsg(to="X", message="…") 回复。' +
  '③ 严禁发送任何寒暄、确认、客套或表情——例如「收到」「好的」「谢谢」「不客气」「没问题」「👍」一律不要发，这些纯属浪费。' +
  '④ 完成任务、或没有实质内容要说时，直接调用 idle 结束本回合，不要发任何结束语。' +
  '⑤ 转达/汇报要一次说完，不要来回确认。';

/** 恢复时不重发 bootstrap，只让员工重新挂到新总线。 */
const RECONNECT_NUDGE =
  '【falinks 已恢复会话】总线已重连。请立刻重新调用 register 报到，然后待命；无需重述之前内容。';

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
  const router = new Router(deliverer, {
    now: () => Date.now(), genId: () => `m${++n}`, routes: cfg.routes, guards,
  });
  router.addVirtual('boss');

  const sessions = new Map<string, string>();
  const launchCwd = (() => { try { return realpathSync(process.cwd()); } catch { return process.cwd(); } })();
  const store: SessionStore = loadStore(launchCwd);
  pruneToAgents(store, cfg.agents.map((a) => a.name));
  const tmp = mkdtempSync(join(tmpdir(), 'falinks-'));
  let bus: Bus;
  let lastRight = '';

  async function launchInto(
    anchor: string,
    dir: 'vertical' | 'horizontal',
    a: { name: string; cli: string; cwd: string; role?: string; bootstrap?: string },
  ): Promise<string> {
    const cfgPath = join(tmp, `${a.name}-mcp.json`);
    writeFileSync(cfgPath, JSON.stringify(mcpConfigFor(a.name, bus.port)));

    const fullBootstrap =
      `${HOUSE_RULES}\n你的身份：${a.name}${a.role ? `（${a.role}）` : ''}。${a.bootstrap ?? ''}`;

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

    const injectText = resuming ? RECONNECT_NUDGE : fullBootstrap;
    const { command, needsBootstrapInject } = buildAgentLaunch(a.cli, {
      name: a.name, busPort: bus.port, mcpConfigPath: cfgPath,
      bootstrap: injectText, sessionId: claudeSessionId, resumeId,
    });

    const sid = await driver.splitFrom(anchor, dir, { cwd: a.cwd, command });
    sessions.set(a.name, sid);
    router.addAgent(a.name, a.role);
    await driver.setName(sid, a.name).catch(() => {}); // pane 标题=员工名

    if (needsBootstrapInject) {
      // claude：信任对话→就绪后注入（resuming 时注入的是重连提示语）。
      for (let i = 0; i < 30; i++) {
        await sleep(700);
        const state = detectScreenState(await driver.readScreen(sid));
        if (state === 'trust-dialog') { await driver.inject(sid, '', true); continue; }
        if (state === 'ready') { await driver.inject(sid, injectText, true); break; }
      }
    } else {
      // codex：bootstrap/重连语已作为命令位置参数传入；盲发 Enter 接受信任目录对话。
      await sleep(2500);
      await driver.inject(sid, '', true);
      await sleep(1500);
      await driver.inject(sid, '', true);
      await sleep(3000);
      await driver.inject(sid, '', true); // 第三次兜底（codex 启动慢时前两次可能太早）

      // codex 首启：注入 /status 读屏抓 session id。轮询重试——员工此刻可能正在跑 bootstrap 那一轮，
      // /status 框要等它空闲才渲染；反复注入 /status 是幂等的（只重渲染状态框），抓到即停。读不到则不记，下次仍 fresh。
      if (!resuming) {
        for (let i = 0; i < 8; i++) {
          await driver.inject(sid, '/status', true);
          await sleep(1800);
          const captured = parseStatusSessionId(await driver.readScreen(sid).catch(() => ''), 'codex');
          if (captured) { sessionId = captured; break; }
        }
      }
    }

    // 落盘：拿到 id 才记；codex 没抓到则删掉旧条目，确保下次 fresh 而非误 resume。
    if (sessionId) store.agents[a.name] = { cli: a.cli, sessionId };
    else delete store.agents[a.name];
    saveStore(launchCwd, store);

    return sid;
  }

  bus = await startBus({
    router,
    getSessionId: (name) => sessions.get(name),
    onAddAgent: async (spec) => {
      if (!lastRight) return { ok: false, error: 'layout not ready' };
      if (router.get(spec.name)) return { ok: false, error: 'name exists' };
      lastRight = await launchInto(lastRight, 'horizontal', spec);
      try { addAgentToConfigFile(configPath, spec); } catch { /* 配置写回失败不致命 */ }
      return { ok: true };
    },
    onRemoveAgent: async (name) => {
      const sid = sessions.get(name);
      if (!sid) return { ok: false, error: 'unknown agent' };
      await driver.closePane(sid);
      sessions.delete(name);
      router.removeAgent(name);
      try { removeAgentFromConfigFile(configPath, name); } catch { /* 配置写回失败不致命 */ }
      return { ok: true };
    },
  }, cfg.busPort);
  mkdirSync(runtimeDir(), { recursive: true });
  writeFileSync(runtimePath(), JSON.stringify({ port: bus.port }));
  console.log(`[falinks] bus on :${bus.port}`);

  // 单窗口：若在 iTerm 交互终端里运行，当前 pane 直接当控制台，员工向右 split——只有一个窗口。
  // 否则（非 iTerm / 非 TTY）回退：另开窗口放一个独立的控制台进程。
  const here = process.env.ITERM_SESSION_ID?.split(':').pop();
  const inProcessConsole = Boolean(here) && Boolean(process.stdin.isTTY);

  if (inProcessConsole) {
    lastRight = here!;
  } else {
    const consoleCmd = consoleLaunchCommand(process.argv[1], process.execPath);
    lastRight = await driver.launch({ cwd: process.cwd(), command: consoleCmd });
    await sleep(800);
  }

  let first = true;
  for (const a of cfg.agents) {
    console.log(`[falinks] 启动员工 ${a.name} (${a.cli})…`);
    lastRight = await launchInto(lastRight, first ? 'vertical' : 'horizontal', a);
    first = false;
  }
  console.log(`[falinks] ✅ 办公室就绪：${cfg.agents.length} 名员工 + 控制台。Ctrl-C 收工。`);

  // 健康轮询(1.5s)：员工 pane 被关 → 自动下线；以及自动检测空闲 → 投出排队消息。
  const IDLE_GRACE_MS = 3000; // 刚投递后这段时间内不判空闲（避开"已提交但还没开始生成"的空窗）
  setInterval(() => {
    void (async () => {
      for (const [name, sid] of [...sessions]) {
        try {
          if (!(await driver.paneExists(sid))) {
            sessions.delete(name);
            router.removeAgent(name);
            lastDeliverAt.delete(name);
            // 单窗口（进程内控制台）时不打印，避免污染 Ink 画面（花名册会自动反映下线）。
            if (!inProcessConsole) console.log(`[falinks] ${name} 的窗口已关，自动下线`);
            continue;
          }
          await driver.setName(sid, name); // 持续把 pane 标题钉成员工名（覆盖 CLI 自改的标题）

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
  if (inProcessConsole) renderConsole(bus.port);
}
