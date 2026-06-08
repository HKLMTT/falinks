import { expect, test, afterEach } from 'vitest';
import { t, getLocale, setLocale, detectLocale } from '../src/i18n/index.js';
import { zh } from '../src/i18n/zh.js';
import { en } from '../src/i18n/en.js';

afterEach(() => setLocale('zh')); // 测试间复位基准语言

test('初始 locale 是 zh(基准,保证全套测试确定性)', () => {
  expect(getLocale()).toBe('zh');
});

test('setLocale 切换 t() 的词典', () => {
  expect(t()).toBe(zh);
  setLocale('en');
  expect(t()).toBe(en);
  expect(getLocale()).toBe('en');
});

test('detectLocale:LC_ALL > LC_MESSAGES > LANG,zh 开头=zh,否则 en,全空回退 zh', () => {
  expect(detectLocale({ LANG: 'zh_CN.UTF-8' })).toBe('zh');
  expect(detectLocale({ LANG: 'en_US.UTF-8' })).toBe('en');
  expect(detectLocale({ LC_ALL: 'zh_TW.UTF-8', LANG: 'en_US.UTF-8' })).toBe('zh');
  expect(detectLocale({ LC_MESSAGES: 'ja_JP.UTF-8', LANG: 'zh_CN.UTF-8' })).toBe('en');
  expect(detectLocale({})).toBe('zh');
  expect(detectLocale({ LC_ALL: '', LANG: 'zh_CN.UTF-8' })).toBe('zh'); // 空串跳过
});

test('en 与 zh 的 key 集合完全一致(防 as any 逃逸)', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
});

test('agentStatus:zh 把状态译成中文,未知值原样返回', () => {
  expect(zh.agentStatus('launching')).toBe('启动中');
  expect(zh.agentStatus('idle')).toBe('空闲');
  expect(zh.agentStatus('busy')).toBe('工作中');
  expect(zh.agentStatus('stuck')).toBe('卡住');
  expect(zh.agentStatus('dead')).toBe('已下线');
  expect(zh.agentStatus('weird')).toBe('weird');
});

test('agentStatus:en 保留英文状态词', () => {
  expect(en.agentStatus('idle')).toBe('idle');
  expect(en.agentStatus('busy')).toBe('busy');
  expect(en.agentStatus('launching')).toBe('launching');
  expect(en.agentStatus('stuck')).toBe('stuck');
  expect(en.agentStatus('dead')).toBe('dead');
});

test('消息投递徽标文案 zh/en 都在', () => {
  expect(zh.msgQueued).toContain('排队');
  expect(zh.msgDelivered).toContain('送达');
  expect(en.msgQueued).toContain('queued');
  expect(en.msgDelivered).toContain('delivered');
});
