import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../src/core/config.js';
import { Router } from '../src/core/router.js';
import { makeDeliverer, detectScreenState } from '../src/orchestrator.js';
import { ITerm2Driver } from '../src/terminal/iterm.js';
import { startBus } from '../src/bus/server.js';
import { mcpConfigFor, launchCommandFor } from '../src/agent/mcp-config.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tail = (s: string, n: number) =>
  s.split('\n').map((l) => l.trimEnd()).filter((l) => l.length).slice(-n).join('\n');

async function main() {
  const cfg = parseConfig({
    busPort: 0,
    agents: [
      { name: 'alice', cli: 'claude', cwd: '/tmp/dagent-alice', role: 'manager',
        bootstrap: '你是办公室员工 alice。你有一个 MCP 工具集 dagent，含 register/sendmsg/idle/who。现在立刻调用 dagent 的 register 工具报到。之后：当你收到形如「【来自 X】...」的消息时，必须用 sendmsg(to="X", message="...") 回复，不要只在窗口里打字；每当你这一回合没有更多动作时，调用 idle。' },
      { name: 'bob', cli: 'claude', cwd: '/tmp/dagent-bob', role: 'dev',
        bootstrap: '你是办公室员工 bob。你有一个 MCP 工具集 dagent，含 register/sendmsg/idle/who。现在立刻调用 dagent 的 register 工具报到。之后：当你收到形如「【来自 X】...」的消息时，必须用 sendmsg(to="X", message="...") 回复；没有更多动作时调用 idle。' },
    ],
    routes: { manager: 'alice' },
  });

  const driver = new ITerm2Driver();
  let n = 0;
  const router = new Router(makeDeliverer(driver), {
    now: () => Date.now(), genId: () => `m${++n}`, routes: cfg.routes,
  });
  for (const a of cfg.agents) router.addAgent(a.name, a.role);

  const sessions = new Map<string, string>();
  const bus = await startBus({ router, getSessionId: (name) => sessions.get(name) }, cfg.busPort);
  console.log(`[dagent] bus on :${bus.port}`);

  const tmp = mkdtempSync(join(tmpdir(), 'dagent-'));
  for (const a of cfg.agents) {
    const cfgPath = join(tmp, `${a.name}-mcp.json`);
    writeFileSync(cfgPath, JSON.stringify(mcpConfigFor(a.name, bus.port)));
    const command = launchCommandFor(a.cli, cfgPath);
    const sid = await driver.launch({ cwd: a.cwd, command });
    sessions.set(a.name, sid);
    console.log(`[dagent] launched ${a.name} (${sid}) :: ${command}`);

    // 就绪轮询：信任对话注 Enter；ready 后让 TUI settle，再分两步注入正文+单独回车提交
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await sleep(700);
      const screen = await driver.readScreen(sid);
      const state = detectScreenState(screen);
      if (state === 'trust-dialog') { await driver.inject(sid, '', true); continue; }
      if (state === 'ready') { ready = true; break; }
    }
    let injected = false;
    if (ready) {
      await sleep(1500);                          // 等 TUI 完全 settle
      await driver.inject(sid, a.bootstrap, true); // driver 内部两步可靠提交
      injected = true;
    }
    console.log(`[dagent] ${a.name} ready=${ready} bootstrap injected=${injected}`);
  }

  // 等两人都 register（status idle），最多 70s
  console.log('[dagent] waiting for both agents to register...');
  for (let i = 0; i < 35; i++) {
    await sleep(2000);
    const st = router.roster().map((a) => `${a.name}=${a.status}`).join(' ');
    const reg = router.roster().filter((a) => a.status !== 'launching').length;
    console.log(`  t=${i * 2}s ${st}`);
    if (reg === 2) { console.log('[dagent] both registered ✅'); break; }
  }

  // seed 话题给 alice
  console.log('[dagent] seeding alice...');
  router.send('system', 'alice',
    '请用 sendmsg 给 bob 发一条消息，问他「今天几号」。发出后立刻调用 idle 结束本回合（你会在 bob 回复后再次被唤醒）。');

  // 观察 ~70s：是否出现 alice->bob->alice 往返
  let bobGotMsg = false, aliceGotReply = false;
  for (let i = 0; i < 35; i++) {
    await sleep(2000);
    const aScreen = await driver.readScreen(sessions.get('alice')!);
    const bScreen = await driver.readScreen(sessions.get('bob')!);
    if (/【来自 alice】/.test(bScreen)) bobGotMsg = true;
    if (/【来自 bob】/.test(aScreen)) aliceGotReply = true;
    const st = router.roster().map((a) => `${a.name}=${a.status}`).join(' ');
    console.log(`  t=${i * 2}s ${st} | bobGotMsg=${bobGotMsg} aliceGotReply=${aliceGotReply}`);
    if (bobGotMsg && aliceGotReply) { console.log('[dagent] round-trip observed ✅'); break; }
  }

  console.log('\n===== alice screen tail =====\n' + tail(await driver.readScreen(sessions.get('alice')!), 12));
  console.log('\n===== bob screen tail =====\n' + tail(await driver.readScreen(sessions.get('bob')!), 12));

  const verdict = bobGotMsg && aliceGotReply ? 'PASS (纯工具回传成立)'
    : bobGotMsg && !aliceGotReply ? 'PARTIAL (alice->bob 成功, bob 未用 sendmsg 回 → B2 需读屏兜底)'
    : !bobGotMsg ? 'FAIL (alice 未通过 sendmsg 发出 → 检查 register/MCP 连接)' : 'UNKNOWN';
  console.log(`\n[VERDICT] bobGotMsg=${bobGotMsg} aliceGotReply=${aliceGotReply} → ${verdict}`);

  console.log('closing windows in 4s...');
  await sleep(4000);
  for (const sid of sessions.values()) { try { await driver.close(sid); } catch {} }
  await bus.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
