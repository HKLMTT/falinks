import { zh } from './zh.js';
import { en } from './en.js';
import { loadSettings } from '../settings.js';

export type Locale = 'zh' | 'en';

// 初始恒为 'zh'(基准语言):库代码与测试不读用户 settings、不受 CI 的 LANG 影响。
// 只有进程入口(cli.ts / console/main.tsx)调用 initLocale() 接入用户设置与系统语言。
let current: Locale = 'zh';

export function getLocale(): Locale { return current; }
export function setLocale(l: Locale): void { current = l; }

/** 按当前语言取词典。用法:t().officeReady(3) */
export function t(): typeof zh { return current === 'zh' ? zh : en; }

/** 系统语言判定:LC_ALL > LC_MESSAGES > LANG 取首个非空,zh 开头=中文,否则英文;全空回退中文。 */
export function detectLocale(env: Record<string, string | undefined>): Locale {
  const v = [env.LC_ALL, env.LC_MESSAGES, env.LANG].find((x) => x && x.length > 0);
  if (!v) return 'zh';
  return v.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** 进程入口初始化:settings 的 locale,'auto' 时按系统语言判定。 */
export function initLocale(): Locale {
  const s = loadSettings();
  const l = s.locale === 'auto' ? detectLocale(process.env) : s.locale;
  setLocale(l);
  return l;
}
