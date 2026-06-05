import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadSettings, saveSettings } from '../src/settings.js';

const tmpRoot = () => mkdtempSync(join(tmpdir(), 'falinks-set-'));

test('缺省 settings:locale=auto', () => {
  expect(loadSettings(tmpRoot())).toEqual({ locale: 'auto' });
});

test('保存后读回', () => {
  const root = tmpRoot();
  saveSettings({ locale: 'en' }, root);
  expect(loadSettings(root)).toEqual({ locale: 'en' });
});

test('损坏文件回退默认', () => {
  const root = tmpRoot();
  saveSettings({ locale: 'zh' }, root);
  writeFileSync(join(root, 'settings.json'), '{broken');
  expect(loadSettings(root)).toEqual({ locale: 'auto' });
});

test('非法 locale 值回退 auto', () => {
  const root = tmpRoot();
  writeFileSync(join(root, 'settings.json'), JSON.stringify({ locale: 'fr' }));
  expect(loadSettings(root)).toEqual({ locale: 'auto' });
});
