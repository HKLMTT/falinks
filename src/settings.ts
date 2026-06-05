import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runtimeDir } from './runtime.js';

/** 用户全局设置:~/.falinks/settings.json。损坏/缺失/非法值一律回退默认。 */
export interface Settings { locale: 'zh' | 'en' | 'auto'; }
const DEFAULTS: Settings = { locale: 'auto' };

export function settingsPath(root = runtimeDir()): string {
  return join(root, 'settings.json');
}

export function loadSettings(root = runtimeDir()): Settings {
  try {
    const d = JSON.parse(readFileSync(settingsPath(root), 'utf8'));
    const locale = d?.locale === 'zh' || d?.locale === 'en' || d?.locale === 'auto' ? d.locale : DEFAULTS.locale;
    return { locale };
  } catch { return { ...DEFAULTS }; }
}

export function saveSettings(s: Settings, root = runtimeDir()): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(settingsPath(root), JSON.stringify(s, null, 2));
}
