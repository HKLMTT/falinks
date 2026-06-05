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
