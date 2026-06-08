import { expect, test } from 'vitest';
import { detectScreenState, isPaneBusy } from '../src/orchestrator.js';

test('detects the trust dialog', () => {
  expect(detectScreenState('... Is this a project you created or one you trust? ... 1. Yes, I trust')).toBe('trust-dialog');
});

test('detects the ready prompt (claude box)', () => {
  expect(detectScreenState('Claude Code v2.1.161\n❯ \n  for agents')).toBe('ready');
});

test('detects the codex trust dialog', () => {
  expect(detectScreenState('Do you trust the contents of this directory?\n› 1. Yes, continue\n  2. No, quit')).toBe('trust-dialog');
});

test('returns starting when neither marker present', () => {
  expect(detectScreenState('Last login: ...\n$ claude')).toBe('starting');
});

test('isPaneBusy: codex 生成中(Working … esc to interrupt)= busy', () => {
  expect(isPaneBusy('• Working (3s • esc to interrupt)\n› ')).toBe(true);
});

test('isPaneBusy: claude 生成中(esc to interrupt)= busy', () => {
  expect(isPaneBusy('✻ Thinking…\n  (esc to interrupt)\n❯')).toBe(true);
});

test('isPaneBusy: 空闲提示符,无生成标志 = 不忙', () => {
  expect(isPaneBusy('gpt-5.5 default · /private/tmp/x\n› ')).toBe(false);
  expect(isPaneBusy('Claude Code v2.1.163\n❯ \n  ⏵⏵ bypass permissions on')).toBe(false);
});

// 窄分屏里 Claude 状态行最右段「esc to interrupt」被 pane 宽度裁掉,只剩「<动词>… (活计时器…)」。
// 这些是真实截图里被判 idle 的生成中 pane —— 必须判忙。
test('isPaneBusy: claude 生成中但 esc-to-interrupt 被窄 pane 裁掉(只剩 spinner+计时器)= busy', () => {
  expect(isPaneBusy('编译测试提交… (16s)')).toBe(true);
  expect(isPaneBusy('● Hashing… (5m 28s · ↓ 5.7k tokens)\n  └ Next: 测通知消息模板')).toBe(true);
  expect(isPaneBusy('重做短信为通用 HTTP 网关表单… (7m 17s · ↑ 17.5k tokens)')).toBe(true);
});

// 真实抓取(osascript text of s)的空闲屏 + 各种"别人不一样的"自定义 statusLine:
// 判忙绝不能依赖、也绝不能被 statusLine 误触(它用户可自定义,含 (1M context)/(2 errors)/working 等都不算忙)。
test('isPaneBusy: 任意自定义 statusLine 空闲屏都不忙(与 statusLine 无关)', () => {
  expect(isPaneBusy('❯  \n  pasg-dev │ ctx ██████░░░░  57% │ 5h  ████████░░  83% │ 7d  ██████████  98% │ Opus 4.8 (1M context) \n  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents')).toBe(false);
  expect(isPaneBusy('❯ \n  ~/proj (main) ✓            claude-sonnet-4')).toBe(false);
  expect(isPaneBusy('❯ \n  main↑2 │ 12:34 │ 98% │ node 20 (LTS)')).toBe(false);
  expect(isPaneBusy('❯ \n  ctx (1M context) · 5h · 7d')).toBe(false);
  expect(isPaneBusy('❯ \n  branch: working (clean)')).toBe(false);
  expect(isPaneBusy('❯ \n  build (2 errors) · 14:05')).toBe(false);
});

// 回合结束的完成态摘要:有「for」、无「…(」、无括号活计时器 —— 不忙。
test('isPaneBusy: 完成态摘要(Brewed/Crunched/Baked for …)= 不忙', () => {
  expect(isPaneBusy('✦ Brewed for 58s\n❯')).toBe(false);
  expect(isPaneBusy('Crunched for 1m 55s\n❯')).toBe(false);
  expect(isPaneBusy('Baked for 9m 24s\n❯')).toBe(false);
});
