import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from './core/config.js';
import { Router } from './core/router.js';
import { Guards } from './core/guards.js';
import { makeDeliverer, detectScreenState } from './orchestrator.js';
import { ITerm2Driver } from './terminal/iterm.js';
import { startBus } from './bus/server.js';
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
  for (const a of cfg.agents) router.addAgent(a.name, a.role);

  const sessions = new Map<string, string>();
  router.addVirtual('boss');
  const bus = await startBus({ router, getSessionId: (name) => sessions.get(name) }, cfg.busPort);
  writeFileSync('.dagent-runtime.json', JSON.stringify({ port: bus.port }));
  console.log(`[dagent] bus on :${bus.port} (runtime written to .dagent-runtime.json)`);

  const tmp = mkdtempSync(join(tmpdir(), 'dagent-'));
  for (const a of cfg.agents) {
    const cfgPath = join(tmp, `${a.name}-mcp.json`);
    writeFileSync(cfgPath, JSON.stringify(mcpConfigFor(a.name, bus.port)));
    const command = launchCommandFor(a.cli, cfgPath);
    const sid = await driver.launch({ cwd: a.cwd, command });
    sessions.set(a.name, sid);
    console.log(`[dagent] launched ${a.name} (${sid})`);

    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const screen = await driver.readScreen(sid);
      const state = detectScreenState(screen);
      if (state === 'trust-dialog') { await driver.inject(sid, '', true); continue; }
      if (state === 'ready') { await driver.inject(sid, a.bootstrap, true); break; }
    }
  }
  console.log('[dagent] all agents launched; awaiting register + activity. Ctrl-C to stop.');
}

