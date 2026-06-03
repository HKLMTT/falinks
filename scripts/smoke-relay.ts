import { Router } from '../src/core/router.js';
import { makeDeliverer } from '../src/orchestrator.js';
import { ITerm2Driver } from '../src/terminal/iterm.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const driver = new ITerm2Driver();
  const deliverer = makeDeliverer(driver);
  let n = 0;
  const router = new Router(deliverer, { now: () => Date.now(), genId: () => `m${++n}` });

  router.addAgent('alice');
  console.log('launching alice window (running cat as stand-in agent)...');
  const sid = await driver.launch({ cwd: '/tmp', command: 'cat' });
  await sleep(1500);
  router.register('alice', sid);

  console.log('sending boss -> alice ...');
  router.send('boss', 'alice', 'PING_12345 多行测试\n第二行');
  await sleep(1500);

  const screen = await driver.readScreen(sid);
  const ok = screen.includes('PING_12345') && screen.includes('第二行');
  console.log('--- alice screen ---\n' + screen);

  // 额外验证（Task 5 审查要求）：特殊字符往返 + 无效 id 报错
  router.onIdle('alice'); // alice 处理完第一条，回到 idle，才能投递下一条
  router.send('boss', 'alice', 'quote:" back:\\ end');
  await sleep(1200);
  const screen2 = await driver.readScreen(sid);
  const special = screen2.includes('quote:"') && screen2.includes('back:\\');
  console.log('special-char round-trip:', special ? 'OK' : 'FAIL');

  let invalidThrew = false;
  try {
    await driver.readScreen('BOGUS-SESSION-ID');
  } catch {
    invalidThrew = true;
  }
  console.log('invalid-id throws:', invalidThrew ? 'OK' : 'FAIL');

  const pass = ok && special && invalidThrew;
  console.log(pass ? '\n✅ SMOKE PASS' : '\n❌ SMOKE FAIL');

  console.log('closing window in 3s...');
  await sleep(3000);
  await driver.close(sid);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
