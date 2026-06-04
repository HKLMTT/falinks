import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from './core/config.js';
import { Router } from './core/router.js';
import { Guards } from './core/guards.js';
import { makeDeliverer, detectScreenState } from './orchestrator.js';
import { ITerm2Driver } from './terminal/iterm.js';
import { startBus, type Bus } from './bus/server.js';
import { mcpConfigFor, launchCommandFor } from './agent/mcp-config.js';

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
    const command = launchCommandFor(a.cli, cfgPath);
    const sid = await driver.splitFrom(anchor, dir, { cwd: a.cwd, command });
    sessions.set(a.name, sid);
    router.addAgent(a.name, a.role);
    for (let i = 0; i < 30; i++) {
      await sleep(700);
      const state = detectScreenState(await driver.readScreen(sid));
      if (state === 'trust-dialog') { await driver.inject(sid, '', true); continue; }
      if (state === 'ready') {
        await driver.inject(sid, a.bootstrap ?? `你是 ${a.name}。开机调 register；收到「来自 X」用 sendmsg 回复 X；收尾调 idle。`, true);
        break;
      }
    }
    return sid;
  }

  bus = await startBus({
    router,
    getSessionId: (name) => sessions.get(name),
    onAddAgent: async (spec) => {
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
}
