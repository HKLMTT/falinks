import { ITerm2Driver } from '../src/terminal/iterm.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const d = new ITerm2Driver();
  const consoleSid = await d.launch({ cwd: '/tmp', command: 'echo CONSOLE; cat' });
  await sleep(800);
  let right = await d.splitFrom(consoleSid, 'vertical', { cwd: '/tmp', command: 'echo EMP1; cat' });
  await sleep(500);
  right = await d.splitFrom(right, 'horizontal', { cwd: '/tmp', command: 'echo EMP2; cat' });
  await sleep(500);
  console.log('注入 EMP2 ...');
  await d.inject(right, 'hello-emp2', true);
  await sleep(800);
  const ok = (await d.readScreen(right)).includes('hello-emp2');
  console.log('运行时增员工 EMP3 ...');
  const emp3 = await d.splitFrom(right, 'horizontal', { cwd: '/tmp', command: 'echo EMP3; cat' });
  await sleep(600);
  console.log('删 EMP3 pane ...');
  await d.closePane(emp3);
  await sleep(500);
  console.log(ok ? '✅ LAYOUT SMOKE PASS' : '❌ FAIL');
  await sleep(1500);
  await d.close(consoleSid);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
