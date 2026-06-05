import { renderConsole } from './run.js';
import { resolveBus } from '../discovery.js';

// 优先 --port(up 直传,免发现);手动调用回退按 cwd 寻址。
const i = process.argv.indexOf('--port');
const argPort = i >= 0 ? Number(process.argv[i + 1]) : NaN;
if (Number.isFinite(argPort) && argPort > 0) {
  renderConsole(argPort);
} else {
  const r = await resolveBus(process.cwd());
  if (!r.ok) { console.error(r.error); process.exit(1); }
  renderConsole(r.port);
}
