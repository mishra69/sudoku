#!/usr/bin/env node
//
// Pre-generate hard puzzles and emit SQL to seed the `puzzles` table.
//
// This exists because the hardest levels can't be generated in a browser: one
// `insane` puzzle costs roughly 50-75 seconds of synchronous CPU, which would
// freeze the app. They're static data, so they get made once, here, on a
// machine with no CPU limit — not in a Worker, where you'd pay for a minute of
// billable CPU per 81-character string.
//
//   node scripts/generate-puzzles.mjs --level insane --count 200
//   wrangler d1 execute sudoku-db --remote --file=scripts/out/puzzles-insane.sql
//
// Options:
//   --level <name|number>  sudoku.js level, or a raw given count   (default: insane)
//   --count <n>            how many to generate                    (default: 20)
//   --jobs <n>             parallel processes            (default: CPU count - 1)
//   --out <path>           SQL output file               (default: scripts/out/puzzles-<level>.sql)
//
// Generation is embarrassingly parallel and each puzzle is slow, so this fans
// out across cores: 200 insane puzzles is ~3 hours on one core, ~25 minutes on
// eight.

import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(HERE, '..', 'frontend', 'js', 'vendor', 'sudoku.js');

// ── Child mode: generate one puzzle at a time, stream results to the parent ──
if (process.env.PUZZLE_WORKER) {
  const { createRequire } = await import('node:module');
  const sudoku = createRequire(import.meta.url)(LIB).sudoku;
  const level = /^\d+$/.test(process.env.LEVEL) ? Number(process.env.LEVEL) : process.env.LEVEL;
  const want = Number(process.env.WANT);

  for (let made = 0; made < want; ) {
    const started = Date.now();
    let puzzle, solution;
    try {
      puzzle = sudoku.generate(level);
      solution = puzzle && sudoku.solve(puzzle);
    } catch (e) {
      // At very low given counts the library's constraint propagation recurses
      // deep enough to throw RangeError: Maximum call stack size exceeded. It's
      // per-attempt, not fatal — discard this one and try again rather than
      // letting the whole worker die and silently drop its share.
      process.send({ type: 'reject', reason: e.name === 'RangeError' ? 'stack overflow' : e.message });
      continue;
    }
    const problem = validate(puzzle, solution);
    if (problem) {
      // Don't ship a broken puzzle; just try again and tell the parent.
      process.send({ type: 'reject', reason: problem });
      continue;
    }
    made++;
    process.send({
      type: 'puzzle', puzzle, solution,
      givens: [...puzzle].filter(c => c !== '.').length,
      ms: Date.now() - started,
    });
  }
  process.exit(0);
}

// A generator that returns an unsolvable or inconsistent grid would poison the
// pool for every player who draws it, and it is cheap to rule out here.
function validate(puzzle, solution) {
  if (typeof puzzle !== 'string' || puzzle.length !== 81) return 'puzzle is not 81 chars';
  if (typeof solution !== 'string' || solution.length !== 81) return 'no solution';
  if (!/^[1-9]{81}$/.test(solution)) return 'solution has empty cells';
  for (let i = 0; i < 81; i++) {
    if (puzzle[i] !== '.' && puzzle[i] !== solution[i]) return 'solution contradicts a given';
  }
  const groups = [];
  for (let i = 0; i < 9; i++) {
    groups.push([...Array(9)].map((_, j) => solution[i * 9 + j]));            // row
    groups.push([...Array(9)].map((_, j) => solution[j * 9 + i]));            // column
    const r0 = Math.floor(i / 3) * 3, c0 = (i % 3) * 3;                       // box
    groups.push([...Array(9)].map((_, j) =>
      solution[(r0 + Math.floor(j / 3)) * 9 + (c0 + j % 3)]));
  }
  if (groups.some(g => new Set(g).size !== 9)) return 'solution breaks sudoku rules';
  return null;
}

// ── Parent mode ─────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2).join(' ').split('--').filter(Boolean)
    .map(s => s.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(' ') || true])
);

const level = args.level || 'insane';
const count = Number(args.count || 20);
const jobs = Math.max(1, Math.min(Number(args.jobs || Math.max(1, os.cpus().length - 1)), count));
const outPath = args.out || path.join(HERE, 'out', `puzzles-${String(level).replace(/\W+/g, '-')}.sql`);

console.log(`generating ${count} × "${level}" across ${jobs} process(es)`);
console.log('this is slow by nature — roughly a minute per puzzle per core\n');

const puzzles = new Map();   // keyed on the puzzle string, so duplicates collapse
let rejects = 0;
let crashed = 0;
const startedAt = Date.now();
const share = n => Math.floor(count / jobs) + (n < count % jobs ? 1 : 0);

await Promise.all([...Array(jobs)].map((_, i) => new Promise(resolve => {
  const want = share(i);
  if (want === 0) return resolve();
  const child = fork(fileURLToPath(import.meta.url), [], {
    env: { ...process.env, PUZZLE_WORKER: '1', LEVEL: String(level), WANT: String(want) },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  child.on('message', m => {
    if (m.type === 'reject') { rejects++; return; }
    puzzles.set(m.puzzle, m);
    const done = puzzles.size;
    const elapsed = (Date.now() - startedAt) / 1000;
    const eta = done < count ? Math.round((elapsed / done) * (count - done)) : 0;
    process.stdout.write(
      `\r  ${done}/${count}  ${m.givens} givens  ${(m.ms / 1000).toFixed(1)}s ` +
      `· elapsed ${Math.round(elapsed)}s · eta ${eta}s      `
    );
  });
  let got = 0;
  child.on('message', m => { if (m.type === 'puzzle') got++; });
  child.on('exit', code => {
    if (got < want) { crashed++; console.log(`\n  worker exited after ${got}/${want} (code ${code})`); }
    resolve();
  });
})));

console.log('\n');
if (puzzles.size === 0) { console.error('no puzzles generated'); process.exit(1); }

const rows = [...puzzles.values()];
const times = rows.map(r => r.ms).sort((a, b) => a - b);
console.log(`generated ${rows.length} unique puzzle(s) in ${Math.round((Date.now() - startedAt) / 1000)}s`);
console.log(`  givens: ${Math.min(...rows.map(r => r.givens))}-${Math.max(...rows.map(r => r.givens))}`);
console.log(`  per puzzle: median ${(times[Math.floor(times.length / 2)] / 1000).toFixed(1)}s, ` +
            `max ${(times[times.length - 1] / 1000).toFixed(1)}s`);
if (rejects) console.log(`  ${rejects} candidate(s) failed validation and were discarded`);
if (puzzles.size < count) {
  // Could be duplicates collapsing, or a worker that died. Say which.
  const short = count - puzzles.size;
  console.log(`  note: ${short} short of the ${count} requested` +
    (crashed ? ` — ${crashed} worker(s) exited early; re-run to top up` : ' (duplicates collapsed)'));
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const sql = [
  `-- ${rows.length} "${level}" puzzles generated ${new Date().toISOString()}`,
  `-- Seed with: wrangler d1 execute sudoku-db --remote --file=${path.relative(path.join(HERE, '..'), outPath)}`,
  `-- INSERT OR IGNORE: puzzle is UNIQUE, so re-running tops the pool up rather than duplicating.`,
  '',
  ...rows.map(r =>
    `INSERT OR IGNORE INTO puzzles (puzzle, solution, givens, difficulty) VALUES ` +
    `('${r.puzzle}', '${r.solution}', ${r.givens}, '${level}');`),
  '',
].join('\n');
fs.writeFileSync(outPath, sql);
console.log(`\nwrote ${outPath}`);
console.log(`seed it:  wrangler d1 execute sudoku-db --remote --file=${path.relative(process.cwd(), outPath)}`);
