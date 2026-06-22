// tests/terminal/submit.test.ts
import { expect, test } from 'vitest';
import { inputBoxRetainsBody, submitWithVerify } from '../../src/terminal/submit.js';

// —— inputBoxRetainsBody:正文是否还滞留在底部输入框 ——

test('正文还在底部输入框 → 判定为未提交(true)', () => {
  const screen = [
    '上一回合的输出……',
    '╭───────────────────────────╮',
    '│ > 来自 frontend 的消息:请把 en_US.json 改一下提交 │',
    '╰───────────────────────────╯',
    '  回车换行 · \\\\+回车 提交',
  ].join('\n');
  expect(inputBoxRetainsBody(screen, '来自 frontend 的消息:请把 en_US.json 改一下提交')).toBe(true);
});

test('已提交、输入框为空 → false(底部只剩空框/提示)', () => {
  const screen = [
    '· 来自 frontend 的消息:请把 en_US.json 改一下提交',  // 已上移成对话回显
    '正在处理……',
    '╭───────────────────────────╮',
    '│ >                                              │',
    '╰───────────────────────────╯',
    '  回车换行 · \\\\+回车 提交',
  ].join('\n');
  expect(inputBoxRetainsBody(screen, '来自 frontend 的消息:请把 en_US.json 改一下提交')).toBe(false);
});

test('抗硬折行:正文在框内被 TUI 折成多行,去空白后仍能匹配末尾探针', () => {
  const screen = [
    '╭──────────────╮',
    '│ > 一段很长很长的消息正文需要 │',
    '│   要被终端硬折成两行来显示结尾在这里收尾 │',
    '╰──────────────╯',
  ].join('\n');
  expect(inputBoxRetainsBody(screen, '一段很长很长的消息正文需要要被终端硬折成两行来显示结尾在这里收尾')).toBe(true);
});

test('空正文恒 false(无需验证)', () => {
  expect(inputBoxRetainsBody('任何屏幕', '')).toBe(false);
  expect(inputBoxRetainsBody('任何屏幕', '   ')).toBe(false);
});

// —— submitWithVerify:发回车 → 验证 → 重试 ——

function mk(opts: { screens: string[]; body: string; maxAttempts?: number }) {
  const calls = { enter: 0, read: 0, slept: [] as number[] };
  let readIdx = 0;
  return {
    calls,
    run: () => submitWithVerify({
      enter: async () => { calls.enter++; },
      readScreen: async () => { calls.read++; return opts.screens[Math.min(readIdx++, opts.screens.length - 1)]; },
      sleep: async (ms) => { calls.slept.push(ms); },
      body: opts.body,
      settleMs: 600,
      verifyMs: 400,
      maxAttempts: opts.maxAttempts ?? 3,
    }),
  };
}

test('首次提交即成功:发一次回车、验证一次、不重试', async () => {
  const { calls, run } = mk({ screens: ['框已空 >'], body: '你好这是一条消息正文结尾' });
  await run();
  expect(calls.enter).toBe(1);
  expect(calls.read).toBe(1);
});

test('回车被吞:正文仍在框 → 重发,直到验证通过', async () => {
  const body = '你好这是一条消息正文结尾';
  // 前两次读屏正文还在框(未提交),第三次空了(提交成功)
  const { calls, run } = mk({ screens: [`> ${body}`, `> ${body}`, '框已空 >'], body });
  await run();
  expect(calls.enter).toBe(3);
});

test('一直吞:到 maxAttempts 封顶停手(不无限重试)', async () => {
  const body = '你好这是一条消息正文结尾';
  const { calls, run } = mk({ screens: [`> ${body}`], body, maxAttempts: 3 });
  await run();
  expect(calls.enter).toBe(3); // 封顶 3 次
});

test('空正文:发一次回车即返回,不读屏验证(信任对话/盲回车)', async () => {
  const { calls, run } = mk({ screens: ['x'], body: '' });
  await run();
  expect(calls.enter).toBe(1);
  expect(calls.read).toBe(0);
});

test('读屏失败:按已提交处理,不重发', async () => {
  const calls = { enter: 0 };
  await submitWithVerify({
    enter: async () => { calls.enter++; },
    readScreen: async () => { throw new Error('read fail'); },
    sleep: async () => {},
    body: '一条消息正文结尾在此',
    settleMs: 600, verifyMs: 400, maxAttempts: 3,
  });
  expect(calls.enter).toBe(1);
});
