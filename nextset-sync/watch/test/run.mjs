#!/usr/bin/env node
// Runs watch-test.js inside the real Espruino interpreter (Linux build).
//   ESPRUINO=/path/to/espruino node nextset-sync/watch/test/run.mjs
// Build the interpreter with nextset-sync/scripts/build-espruino.sh.
import {readFileSync, mkdtempSync, writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..', 'nsync');
const fx = join(here, '..', '..', 'protocol', 'fixtures');
const read = p => readFileSync(p, 'utf8');
const expected = JSON.parse(read(join(fx, 'sleep-expected.json')));
const archive = JSON.parse(read(join(fx, 'sleeplog-archive.json')));
const log = read(join(fx, 'sleeplog-sample.log'));
const lines = log.trim().split('\n').filter(l => !l.startsWith(','));
const FILES = {
  lib: read(join(app, 'lib.js')), boot: read(join(app, 'boot.js')), app: read(join(app, 'app.js')),
  tools: read(join(app, 'tools.js')),
  schedLib: read(join(here, 'vendor', 'sched-0.43-lib.js')),
  healthLib: read(join(here, 'vendor', 'health-0.44-lib.js')),
  healthRawB64: readFileSync(join(fx, 'health-2026-11.raw')).toString('base64'), // binary: via atob, not JSON text
  healthExpected: JSON.parse(read(join(fx, 'health-expected.json'))),
  schedBoot: read(join(here, 'vendor', 'sched-0.43-boot.js')),
  sleeplog: read(join(here, 'vendor', 'sleeplog-0.26-lib.js')),
};
const FIXTURE = {log, archive, archiveName: expected.archiveFileName,
  first: archive[0][0], lastT10: Number(lines.at(-1).split(',')[0])};
const VECTORS = JSON.parse(read(join(here, '..', '..', 'protocol', 'vectors.json')));
const script = `var FILES=${JSON.stringify(FILES)};\nvar FIXTURE=${JSON.stringify(FIXTURE)};\nvar VECTORS=${JSON.stringify(VECTORS)};\n` + read(join(here, 'watch-test.js'));
const dir = mkdtempSync(join(tmpdir(), 'nsync-esp-'));
writeFileSync(join(dir, 'test.js'), script);
const bin = process.env.ESPRUINO || 'espruino';
// stdin stays open and silent: a closed stdin makes the REPL echo noise.
const child = spawn(bin, ['--test', 'test.js'], {cwd: dir, stdio: ['pipe', 'pipe', 'pipe']});
let out = '';
child.stdout.setEncoding('latin1'); child.stderr.setEncoding('latin1');
child.stdout.on('data', d => { out += d; if (/-{5,} (PASS|FAIL) test\.js/.test(out)) child.kill(); });
child.stderr.on('data', d => { out += d; if (/-{5,} (PASS|FAIL) test\.js/.test(out)) child.kill(); });
const killer = setTimeout(() => child.kill(), 120000);
await new Promise(r => child.on('close', r));
clearTimeout(killer);
const clean = out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[^\x20-\x7e\n]/g, '');
const shown = clean.split('\n').map(l => l.replace(/^>+/, '').trim())
  .filter(l => /^(ok - |FAIL|# |Uncaught|in function|espruino: -+ (PASS|FAIL)|ERROR|ASSERT)/.test(l));
console.log(shown.join('\n')); if (process.env.RAW) console.log(clean);
const passed = /-+ PASS/.test(clean) && !/FAIL:|Uncaught/.test(clean);
console.log(passed ? 'WATCH TESTS PASSED' : 'WATCH TESTS FAILED');
process.exit(passed ? 0 : 1);
