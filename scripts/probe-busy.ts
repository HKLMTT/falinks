import { spawn } from 'node:child_process';
import { isPaneBusy } from '../src/orchestrator.js';

function osa(script: string): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn('osascript', ['-']);
    let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', () => {});
    p.on('close', () => resolve(out));
    p.stdin.write(script); p.stdin.end();
  });
}
const onSession = (id: string, action: string) => `tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if (id of s) is "${id}" then
          ${action}
        end if
      end repeat
    end repeat
  end repeat
end tell`;

async function listSessions(): Promise<{ id: string; name: string }[]> {
  const raw = await osa(`tell application "iTerm2"
    set out to ""
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          set out to out & (id of s) & "\\t" & (name of s) & linefeed
        end repeat
      end repeat
    end repeat
    return out
  end tell`);
  return raw.trim().split('\n').filter(Boolean).map((l) => {
    const [id, ...rest] = l.split('\t'); return { id, name: rest.join('\t') };
  });
}

async function sample(id: string): Promise<{ proc: boolean; scrape: boolean }> {
  const r = await osa(onSession(id, 'return ((is processing of s) as string) & "<<<SEP>>>" & (text of s)'));
  const idx = r.indexOf('<<<SEP>>>');
  const procStr = (idx >= 0 ? r.slice(0, idx) : r).trim();
  const text = idx >= 0 ? r.slice(idx + 9) : '';
  return { proc: procStr === 'true', scrape: isPaneBusy(text) };
}

async function main() {
  const sessions = await listSessions();
  // 探测对象:命令行给的 id 列表,否则全部 (node) 会话
  const argIds = process.argv.slice(2);
  const targets = argIds.length ? sessions.filter((s) => argIds.includes(s.id)) : sessions;
  console.log(`probing ${targets.length} sessions, 30 samples @1s. P=is_processing  B=scrape(isPaneBusy)\n`);
  const SAMPLES = 30;
  const rows = new Map<string, { p: string; b: string; name: string }>();
  for (const t of targets) rows.set(t.id, { p: '', b: '', name: t.name });
  for (let i = 0; i < SAMPLES; i++) {
    for (const t of targets) {
      const { proc, scrape } = await sample(t.id);
      const r = rows.get(t.id)!;
      r.p += proc ? 'P' : '.';
      r.b += scrape ? 'B' : '.';
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log('legend: top=is_processing  bottom=scrape   (divergence = where they disagree)\n');
  for (const [, r] of rows) {
    // 仅显示这 30s 内出现过 busy 的会话(过滤一直空闲的)
    if (!r.p.includes('P') && !r.b.includes('B')) continue;
    const diverge = [...r.p].map((c, k) => (((c === 'P') !== (r.b[k] === 'B')) ? '^' : ' ')).join('');
    console.log(`【${r.name}】`);
    console.log(`  proc : ${r.p}`);
    console.log(`  scrape ${r.b}`);
    console.log(`  diff : ${diverge}`);
    const procBusy = [...r.p].filter((c) => c === 'P').length;
    const scrapeBusy = [...r.b].filter((c) => c === 'B').length;
    const disagree = [...r.p].filter((c, k) => (c === 'P') !== (r.b[k] === 'B')).length;
    console.log(`  busy 采样数: proc=${procBusy}/30  scrape=${scrapeBusy}/30  分歧=${disagree}/30\n`);
  }
}
main();
