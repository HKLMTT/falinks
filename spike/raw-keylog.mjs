import fs from 'node:fs';

const LOG = '/Users/liujia/工作/dagent/spike/keylog.out';
const out = fs.createWriteStream(LOG, { flags: 'a' });

if (!process.stdin.isTTY) {
  out.write('ERROR: stdin is not a TTY\n');
  process.exit(1);
}

process.stdin.setRawMode(true);
process.stdin.resume(); // NO setEncoding -> data events deliver Buffers

out.write(`\n=== keylog start pid=${process.pid} ts=${Date.now()} ===\n`);
process.stdout.write('KEYLOG READY (raw mode, buffers). Inject now. Ctrl-C to exit.\r\n');

process.stdin.on('data', (buf) => {
  const hex = [...buf].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const rep = [...buf]
    .map((b) => {
      if (b === 0x0d) return '<CR>';
      if (b === 0x0a) return '<LF>';
      if (b === 0x1b) return '<ESC>';
      if (b === 0x03) return '<^C>';
      if (b === 0x09) return '<TAB>';
      if (b === 0x7f) return '<DEL>';
      if (b >= 0x20 && b < 0x7f) return String.fromCharCode(b);
      return `<0x${b.toString(16)}>`;
    })
    .join('');
  out.write(`[${Date.now()}] len=${buf.length} hex=[${hex}] rep=[${rep}]\n`);
  if ([...buf].includes(0x03)) {
    out.write('=== got ^C, exiting ===\n');
    process.exit(0);
  }
});
