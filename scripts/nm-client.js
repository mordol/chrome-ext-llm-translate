// Local test client: spawns the host like a browser would and exchanges framed messages.
// Usage: node scripts/nm-client.js '<json message>'
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const host = spawn(path.join(__dirname, '..', 'host', 'run-host.sh'), [], { stdio: ['pipe', 'pipe', 'inherit'], env: { HOME: process.env.HOME, USER: process.env.USER, LOGNAME: process.env.USER, TMPDIR: process.env.TMPDIR, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } });
const msg = JSON.parse(process.argv[2] || '{"type":"echo","payload":"hello"}');
const t0 = Date.now();

const body = Buffer.from(JSON.stringify(msg), 'utf8');
const header = Buffer.alloc(4);
header.writeUInt32LE(body.length, 0);
host.stdin.write(Buffer.concat([header, body]));

let buf = Buffer.alloc(0);
host.stdout.on('data', chunk => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const reply = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
    buf = buf.subarray(4 + len);
    console.log(`+${Date.now() - t0}ms`, JSON.stringify(reply));
    if (reply.type === 'echo' || reply.type === 'models' || reply.type === 'done' || reply.type === 'error') host.stdin.end();
  }
});
