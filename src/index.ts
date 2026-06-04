import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from './core/config.js';
import { Router } from './core/router.js';
import { Guards } from './core/guards.js';
import { makeDeliverer, detectScreenState } from './orchestrator.js';
import { ITerm2Driver } from './terminal/iterm.js';
import { startBus, type Bus } from './bus/server.js';
import { mcpConfigFor, buildAgentLaunch } from './agent/mcp-config.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    const bootstrap = a.bootstrap ?? `你是 ${a.name}。开机调 register；收到「来自 X」用 sendmsg 回复 X；收尾调 idle。`;
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
  writeFileSync('.dagent-runtime.json', JSON.stringify({ port: bus.port }));
  console.log(`[dagent] bus on :${bus.port}`);

  const consoleSid = await driver.launch({ cwd: process.cwd(), command: 'npx tsx src/console/main.tsx' });
  await sleep(800);
  lastRight = consoleSid;
  let first = true;
  for (const a of cfg.agents) {
    lastRight = await launchInto(lastRight, first ? 'vertical' : 'horizontal', a);
    first = false;
  }
  console.log('[dagent] 布局就绪。控制台在左 pane。Ctrl-C 收工。');

  // 健康轮询：员工 pane 被关 → 自动下线（移出花名册）。
  setInterval(() => {
    void (async () => {
      for (const [name, sid] of [...sessions]) {
        try {
          if (!(await driver.paneExists(sid))) {
            sessions.delete(name);
            router.removeAgent(name);
            console.log(`[dagent] ${name} 的窗口已关，自动下线`);
          }
        } catch {
          /* 探测失败忽略，下一轮再试 */
        }
      }
    })();
  }, 3000);
}
