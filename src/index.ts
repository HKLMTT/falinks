import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from './core/config.js';
import { Router } from './core/router.js';
import { Guards } from './core/guards.js';
import { makeDeliverer, detectScreenState } from './orchestrator.js';
import { ITerm2Driver } from './terminal/iterm.js';
import { startBus, type Bus } from './bus/server.js';
import { mcpConfigFor, buildAgentLaunch } from './agent/mcp-config.js';
import { runtimeDir, runtimePath, consoleLaunchCommand } from './runtime.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 全员通用协作规则（前缀到每个员工的 bootstrap）。核心：省 token、禁客套。 */
const HOUSE_RULES =
  '【dagent 协作规则】你是办公室里的 AI 员工，通过 dagent 的 MCP 工具协作。' +
  '① 开机立刻调用 register 报到。' +
  '② 收到形如「【来自 X】…」的消息后，只有当你有实质内容（答案/数据/明确问题）时，才用 sendmsg(to="X", message="…") 回复。' +
  '③ 严禁发送任何寒暄、确认、客套或表情——例如「收到」「好的」「谢谢」「不客气」「没问题」「👍」一律不要发，这些纯属浪费。' +
  '④ 完成任务、或没有实质内容要说时，直接调用 idle 结束本回合，不要发任何结束语。' +
  '⑤ 转达/汇报要一次说完，不要来回确认。';

export async function up(configPath: string) {
  const cfg = parseConfig(JSON.parse(readFileSync(configPath, 'utf8')));
  const driver = new ITerm2Driver();
  let n = 0;
  const guards = new Guards(cfg.guards, () => Date.now());
  const router = new Router(makeDeliverer(driver), {
    now: () => Date.now(), genId: () => `m${++n}`, routes: cfg.routes, guards,
  });
  router.addVirtual('boss');

  const sessions = new Map<string, string>();
  const tmp = mkdtempSync(join(tmpdir(), 'dagent-'));
  let bus: Bus;
  let lastRight = '';

  async function launchInto(
    anchor: string,
    dir: 'vertical' | 'horizontal',
    a: { name: string; cli: string; cwd: string; role?: string; bootstrap?: string },
  ): Promise<string> {
    const cfgPath = join(tmp, `${a.name}-mcp.json`);
    writeFileSync(cfgPath, JSON.stringify(mcpConfigFor(a.name, bus.port)));
    const bootstrap = `${HOUSE_RULES}\n你的身份：${a.name}${a.role ? `（${a.role}）` : ''}。${a.bootstrap ?? ''}`;
    const { command, needsBootstrapInject } = buildAgentLaunch(a.cli, {
      name: a.name, busPort: bus.port, mcpConfigPath: cfgPath, bootstrap,
    });
    const sid = await driver.splitFrom(anchor, dir, { cwd: a.cwd, command });
    sessions.set(a.name, sid);
    router.addAgent(a.name, a.role);
    if (needsBootstrapInject) {
      // claude：处理信任对话；就绪后注入 bootstrap。
      for (let i = 0; i < 30; i++) {
        await sleep(700);
        const state = detectScreenState(await driver.readScreen(sid));
        if (state === 'trust-dialog') { await driver.inject(sid, '', true); continue; }
        if (state === 'ready') { await driver.inject(sid, bootstrap, true); break; }
      }
    } else {
      // codex：bootstrap 已作为初始 prompt 传入。它首次进新目录必弹"信任目录"对话
      //（Press enter to continue，默认 1. Yes），但 codex inline 模式读屏不可靠（text of s 返回空），
      // 无法检测——因此盲发两次 Enter 接受默认。若目录已受信，多余 Enter 等于空输入提交，无害。
      await sleep(2500);
      await driver.inject(sid, '', true);
      await sleep(1500);
      await driver.inject(sid, '', true);
      await sleep(3000);
      await driver.inject(sid, '', true); // 第三次兜底（codex 启动慢时前两次可能太早）
    }
    return sid;
  }

  bus = await startBus({
    router,
    getSessionId: (name) => sessions.get(name),
    onAddAgent: async (spec) => {
      if (!lastRight) return { ok: false, error: 'layout not ready' };
      if (router.get(spec.name)) return { ok: false, error: 'name exists' };
      lastRight = await launchInto(lastRight, 'horizontal', spec);
      return { ok: true };
    },
    onRemoveAgent: async (name) => {
      const sid = sessions.get(name);
      if (!sid) return { ok: false, error: 'unknown agent' };
      await driver.closePane(sid);
      sessions.delete(name);
      router.removeAgent(name);
      return { ok: true };
    },
  }, cfg.busPort);
  mkdirSync(runtimeDir(), { recursive: true });
  writeFileSync(runtimePath(), JSON.stringify({ port: bus.port }));
  console.log(`[falinks] bus on :${bus.port}`);

  const consoleCmd = consoleLaunchCommand(process.argv[1], process.execPath);
  const consoleSid = await driver.launch({ cwd: process.cwd(), command: consoleCmd });
  await sleep(800);
  lastRight = consoleSid;
  let first = true;
  for (const a of cfg.agents) {
    lastRight = await launchInto(lastRight, first ? 'vertical' : 'horizontal', a);
    first = false;
  }
  console.log('[falinks] 布局就绪。控制台在左 pane。Ctrl-C 收工。');

  // 健康轮询：员工 pane 被关 → 自动下线（移出花名册）。
  setInterval(() => {
    void (async () => {
      for (const [name, sid] of [...sessions]) {
        try {
          if (!(await driver.paneExists(sid))) {
            sessions.delete(name);
            router.removeAgent(name);
            console.log(`[falinks] ${name} 的窗口已关，自动下线`);
          }
        } catch {
          /* 探测失败忽略，下一轮再试 */
        }
      }
    })();
  }, 3000);
}
