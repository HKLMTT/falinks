import { renderConsole } from './run.js';
import { existsSync } from 'node:fs';
import { resolveBus } from '../discovery.js';
import { initLocale, t } from '../i18n/index.js';
import { DEFAULT_OFFICE, resolveConfigPath } from '../core/office.js';

initLocale();

// --office:连指定办公室(具名);缺省=默认办公室。--port 优先(up 直传,免发现)。
const oi = process.argv.indexOf('--office');
const office = oi >= 0 && process.argv[oi + 1] ? process.argv[oi + 1] : DEFAULT_OFFICE;

const i = process.argv.indexOf('--port');
const argPort = i >= 0 ? Number(process.argv[i + 1]) : NaN;

/** 具名办公室:连上后核对实例 office 匹配,防连错(--port 直传或档案被复用)。默认办公室沿用旧借用兼容,不强校验。 */
async function validateOffice(port: number): Promise<void> {
  if (office === DEFAULT_OFFICE) return;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/admin/info`);
    const info: any = await res.json();
    const got = info?.office ?? DEFAULT_OFFICE;
    if (got !== office) { console.error(t().officeMismatch(office, got)); process.exit(1); }
  } catch { /* 探活失败:交给后续连接报错,不在此拦 */ }
}

/** 具名办公室没找到运行实例时,按"有配置=未启动 / 无配置=不存在"给出可执行提示。 */
function explainNamedMiss(): never {
  if (existsSync(resolveConfigPath(process.cwd(), office))) console.error(t().officeNotRunning(office));
  else console.error(t().officeConfigNotFound(office));
  process.exit(1);
}

if (Number.isFinite(argPort) && argPort > 0) {
  await validateOffice(argPort);
  renderConsole(argPort);
} else {
  const r = await resolveBus(process.cwd(), { office });
  if (!r.ok) {
    if (office !== DEFAULT_OFFICE) explainNamedMiss();
    console.error(r.error);
    process.exit(1);
  }
  await validateOffice(r.port);
  renderConsole(r.port);
}

