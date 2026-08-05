#!/usr/bin/env node
/**
 * Twinseed shell status — shared by PowerShell / bash / zsh prompt chrome.
 *
 *   node shell/status.js          → JSON object (one line)
 *   node shell/status.js --line   → sparse prompt fragment (or empty)
 *   node shell/status.js --color  → --line wrapped in muted ANSI
 *
 * Reads session env (set by twinseed.psm1 / twinseed.sh helpers):
 *   TWINSEED_SEED, TWINSEED_BASEDIR, TWINSEED_PROFILE, TWINSEED_STRICT,
 *   TWINSEED_LAST_RENDER (ok|fail), TWINSEED_RENDER_AT (epoch ms of seed
 *   mtime at last successful render — dirty when seed mtime is newer).
 */

import fs from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const wantLine = args.has('--line') || args.has('--color');
const wantColor = args.has('--color');
const wantStamp = args.has('--stamp');

const env = process.env;

/** @returns {string | null} */
function findTwinseedRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    try {
      const raw = fs.readFileSync(pkg, 'utf8');
      const name = JSON.parse(raw)?.name;
      if (name === 'twinseed') return dir;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** @returns {boolean} */
function strictOn() {
  return /^(1|true|yes)$/i.test(env.TWINSEED_STRICT ?? '');
}

/**
 * @param {string | undefined} seedPath
 * @returns {'dirty' | 'clean' | null}
 */
function genomeState(seedPath) {
  if (!seedPath) return null;
  const stamp = env.TWINSEED_RENDER_AT;
  if (!stamp || !/^\d+$/.test(stamp)) return null;
  try {
    const mtime = Math.floor(fs.statSync(seedPath).mtimeMs);
    // Allow 1ms slack for cross-runtime stamp writes.
    return mtime > Number(stamp) + 1 ? 'dirty' : 'clean';
  } catch {
    return null;
  }
}

/** @returns {string | null} */
function resolveSeed() {
  const raw = env.TWINSEED_SEED?.trim();
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

const seedAbs = resolveSeed();

if (wantStamp) {
  if (!seedAbs) {
    process.stderr.write('twinseed: no TWINSEED_SEED for --stamp\n');
    process.exit(1);
  }
  try {
    process.stdout.write(String(Math.floor(fs.statSync(seedAbs).mtimeMs)));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`twinseed: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }
}

const root = findTwinseedRoot(process.cwd());
const seedRel =
  seedAbs && root
    ? path.relative(root, seedAbs).replace(/\\/g, '/')
    : seedAbs
      ? path.basename(seedAbs)
      : null;

const profile = env.TWINSEED_PROFILE?.trim() || null;
const baseDirRaw = env.TWINSEED_BASEDIR?.trim() || null;
const baseDirAbs = baseDirRaw
  ? path.isAbsolute(baseDirRaw)
    ? baseDirRaw
    : path.resolve(process.cwd(), baseDirRaw)
  : null;
const seedDir = seedAbs ? path.dirname(seedAbs) : null;
const baseDirShown =
  baseDirAbs && (!seedDir || path.resolve(baseDirAbs) !== path.resolve(seedDir))
    ? root
      ? path.relative(root, baseDirAbs).replace(/\\/g, '/') || '.'
      : baseDirAbs.replace(/\\/g, '/')
    : null;
const last = /^(ok|fail)$/i.test(env.TWINSEED_LAST_RENDER ?? '')
  ? env.TWINSEED_LAST_RENDER.toLowerCase()
  : null;
const genome = genomeState(seedAbs ?? undefined);
const strict = strictOn();

const status = {
  root: root ? root.replace(/\\/g, '/') : null,
  seed: seedRel,
  baseDir: baseDirAbs
    ? (root
        ? path.relative(root, baseDirAbs).replace(/\\/g, '/') || '.'
        : baseDirAbs.replace(/\\/g, '/'))
    : null,
  profile,
  strict,
  render: last,
  genome,
};

const hasSession =
  Boolean(seedRel || profile || baseDirAbs || last || genome) || strict;

if (wantLine) {
  if (!hasSession) {
    process.stdout.write('');
    process.exit(0);
  }

  /** @type {string[]} */
  const parts = ['ts'];
  if (seedRel) parts.push(seedRel);
  if (baseDirShown) parts.push(`base:${baseDirShown}`);
  if (profile) parts.push(profile);
  if (strict) parts.push('strict');
  if (last === 'ok') parts.push('ok');
  else if (last === 'fail') parts.push('fail');
  if (genome === 'dirty') parts.push('dirty');

  let line = parts.join(' · ');
  if (wantColor && line) {
    line = `\u001b[90m${line}\u001b[0m`;
  }
  process.stdout.write(line);
  process.exit(0);
}

process.stdout.write(JSON.stringify(status));
