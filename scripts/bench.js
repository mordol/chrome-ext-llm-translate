// Q4 benchmark: runs the host like the browser does and translates the same
// paragraphs with several batch sizes, one batch at a time.
// Usage: node scripts/bench.js <cli> [model] [batchSizes=1,5,10,20]
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const [cli = 'claude', model = '', sizesArg = '1,5,10,20'] = process.argv.slice(2);
const sizes = sizesArg.split(',').map(Number);
const paragraphs = JSON.parse(fs.readFileSync(path.join(__dirname, 'bench-paragraphs.json'), 'utf8'));

const host = spawn(path.join(__dirname, '..', 'host', 'run-host.sh'), [], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { HOME: process.env.HOME, USER: process.env.USER, LOGNAME: process.env.USER, TMPDIR: process.env.TMPDIR, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
});

let buf = Buffer.alloc(0);
let waiter = null;
host.stdout.on('data', chunk => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const msg = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
    buf = buf.subarray(4 + len);
    waiter?.(msg);
  }
});

function runJob(job, batch) {
  return new Promise(resolve => {
    const paras = [];
    let error = null;
    waiter = msg => {
      if (msg.job !== job) return;
      if (msg.type === 'para') paras.push(msg);
      else if (msg.type === 'error') error = msg.error;
      else if (msg.type === 'done') resolve({ stats: msg.stats, paras, error });
    };
    const body = Buffer.from(JSON.stringify({ type: 'translate', job, cli, model: model || undefined, paragraphs: batch }), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    host.stdin.write(Buffer.concat([header, body]));
  });
}

(async () => {
  const rows = [];
  for (const size of sizes) {
    const t0 = Date.now();
    const jobs = [];
    let firstVisibleMs = null;
    for (let i = 0; i < paragraphs.length; i += size) {
      const r = await runJob(`b${size}-${i}`, paragraphs.slice(i, i + size));
      if (r.error) console.error(`[${size}] error:`, r.error);
      if (firstVisibleMs === null && r.stats.firstParaMs !== null) firstVisibleMs = r.stats.firstParaMs;
      jobs.push(r.stats);
    }
    const wall = Date.now() - t0;
    const avg = key => Math.round(jobs.reduce((a, s) => a + (s[key] ?? 0), 0) / jobs.length);
    const missing = jobs.reduce((a, s) => a + s.missing.length, 0);
    const cost = jobs.reduce((a, s) => a + (s.costUsd || 0), 0);
    rows.push({
      cli, model: jobs[0].model || model || 'default', batch: size, calls: jobs.length,
      avgReadyMs: avg('readyMs'), firstParaMs: firstVisibleMs, avgCallMs: avg('totalMs'),
      wallMs: wall, msPerPara: Math.round(wall / paragraphs.length), missing, costUsd: +cost.toFixed(4),
    });
    console.error(JSON.stringify(rows.at(-1)));
  }
  console.table(rows);
  fs.appendFileSync(path.join(__dirname, '..', 'bench-results.jsonl'), rows.map(r => JSON.stringify({ at: new Date().toISOString(), ...r })).join('\n') + '\n');
  host.stdin.end();
})();
