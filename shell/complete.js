#!/usr/bin/env node
/**
 * Twinseed shell completion — shared by PowerShell / bash / zsh.
 *
 * One sparse surface: seeds, CLI flags, profile pairs, emit targets,
 * baseDirs, and shell helper modes. Quiet when unsure (empty stdout).
 *
 *   node shell/complete.js --kind seeds [--word PREFIX]
 *   node shell/complete.js --kind flags [--word PREFIX] [--have a,b]
 *   node shell/complete.js --kind profile [--word PREFIX]
 *   node shell/complete.js --kind emit [--word PREFIX]
 *   node shell/complete.js --kind basedirs [--word PREFIX]
 *   node shell/complete.js --kind strict|mark|prompt [--word PREFIX]
 *   node shell/complete.js --kind cli [--word PREFIX] [--tokens JSON]
 *   node shell/complete.js --surface   # JSON vocab (docs / debug)
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);

/** @returns {string | undefined} */
function flagValue(name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}

const kind = flagValue('--kind');
const word = flagValue('--word') ?? '';
const haveRaw = flagValue('--have') ?? '';
const tokensRaw = flagValue('--tokens');
const wantSurface = args.includes('--surface');

/** Fixed CLI / profile vocabulary — keep sparse and correct. */
const SURFACE = {
  flags: ['--json', '--doc', '--strict', '--watch', '--emit', '--profile'],
  emit: ['resolved'],
  profileKeys: ['audience', 'platform', 'product'],
  profileValues: {
    audience: ['admin', 'novice'],
    platform: ['web'],
    product: [],
  },
  /** Common full pairs from examples / reading room. */
  profilePairs: [
    'audience=admin',
    'audience=novice',
    'platform=web',
  ],
  strict: ['on', 'off'],
  mark: ['ok', 'fail'],
  prompt: ['on', 'off'],
  /** Seed search roots under the twinseed package (relative). */
  seedRoots: ['exemplar/templates', 'templates', 'examples'],
};

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

/**
 * @param {string} prefix
 * @param {string[]} items
 * @returns {string[]}
 */
function filterPrefix(prefix, items) {
  if (!prefix) return items;
  const lower = prefix.toLowerCase().replace(/\\/g, '/');
  return items.filter((item) => {
    const pathLike = item.toLowerCase().replace(/\\/g, '/');
    if (pathLike.startsWith(lower)) return true;
    // Bare word: also match basename (practice → …/practice.skel.yml).
    if (!lower.includes('/')) {
      const base = pathLike.slice(pathLike.lastIndexOf('/') + 1);
      if (base.startsWith(lower)) return true;
    }
    return false;
  });
}

/**
 * Prefer paths relative to cwd when under the repo; else repo-relative.
 * @param {string} abs
 * @param {string} root
 * @param {string} cwd
 */
function displayPath(abs, root, cwd) {
  const norm = abs.replace(/\\/g, '/');
  const rootN = root.replace(/\\/g, '/');
  const cwdN = cwd.replace(/\\/g, '/');
  if (norm.startsWith(cwdN + '/') || norm === cwdN) {
    const rel = path.relative(cwd, abs).replace(/\\/g, '/');
    return rel || '.';
  }
  if (norm.startsWith(rootN + '/') || norm === rootN) {
    return path.relative(root, abs).replace(/\\/g, '/') || '.';
  }
  return norm;
}

/**
 * @param {string} dir
 * @param {(name: string, abs: string) => void} visit
 */
function walkYml(dir, visit) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      // Sparse: skip node_modules and deep junk; allow one level of map dirs.
      if (ent.name === 'node_modules' || ent.name === 'partials') continue;
      walkYml(abs, visit);
    } else if (/\.(yml|yaml)$/i.test(ent.name)) {
      visit(ent.name, abs);
    }
  }
}

/**
 * @param {string} root
 * @param {string} cwd
 * @param {string} prefix
 * @returns {string[]}
 */
function listSeeds(root, cwd, prefix) {
  /** @type {{ path: string, rank: number }[]} */
  const found = [];
  const wantPartials =
    /partial/i.test(prefix) || prefix.replace(/\\/g, '/').includes('partials/');

  for (const relRoot of SURFACE.seedRoots) {
    const absRoot = path.join(root, relRoot);
    if (!fs.existsSync(absRoot)) continue;
    walkYml(absRoot, (name, abs) => {
      const shown = displayPath(abs, root, cwd);
      let rank = 50;
      if (/\.skel\.yml$/i.test(name)) rank = 10;
      else if (/\.map\.yml$/i.test(name)) rank = 20;
      else if (relRoot === 'exemplar/templates' || relRoot === 'templates') rank = 30;
      else if (relRoot === 'examples') rank = 40;
      found.push({ path: shown, rank });
    });
    if (wantPartials && relRoot === 'examples') {
      const partials = path.join(absRoot, 'partials');
      walkYml(partials, (_name, abs) => {
        found.push({ path: displayPath(abs, root, cwd), rank: 80 });
      });
    }
  }

  found.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
  const uniq = [...new Set(found.map((f) => f.path))];
  return filterPrefix(prefix.replace(/\\/g, '/'), uniq);
}

/**
 * @param {string} root
 * @param {string} cwd
 * @param {string} prefix
 * @returns {string[]}
 */
function listBaseDirs(root, cwd, prefix) {
  const dirs = new Set();
  for (const rel of [...SURFACE.seedRoots, 'exemplar', 'examples']) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) dirs.add(displayPath(abs, root, cwd));
  }
  // Parents of skeleton templates are useful include bases.
  for (const seed of listSeeds(root, cwd, '')) {
    const abs = path.isAbsolute(seed) ? seed : path.resolve(cwd, seed);
    dirs.add(displayPath(path.dirname(abs), root, cwd));
  }
  return filterPrefix(prefix.replace(/\\/g, '/'), [...dirs].sort());
}

/**
 * @param {string} prefix
 * @returns {string[]}
 */
function listProfile(prefix) {
  const keyMatch = prefix.match(/^([A-Za-z_]\w*)=(.*)$/);
  if (keyMatch) {
    const [, key, valPrefix] = keyMatch;
    if (!SURFACE.profileKeys.includes(key)) return [];
    const vals = SURFACE.profileValues[key] ?? [];
    return filterPrefix(valPrefix, vals).map((v) => `${key}=${v}`);
  }
  // Bare prefix: suggest keys with = and known full pairs.
  const keys = SURFACE.profileKeys.map((k) => `${k}=`);
  const pairs = SURFACE.profilePairs;
  const merged = [...new Set([...pairs, ...keys])];
  return filterPrefix(prefix, merged);
}

/**
 * @param {string} prefix
 * @param {string[]} have
 */
function listFlags(prefix, have) {
  const used = new Set(have.map((h) => h.toLowerCase()));
  const available = SURFACE.flags.filter((f) => !used.has(f.toLowerCase()));
  // --json / --doc conflict with --emit; keep suggesting until chosen —
  // taste: still list them; CLI errors if combined.
  return filterPrefix(prefix, available);
}

/**
 * Context-aware CLI completion (render helper / node src/cli.js).
 * tokens: words after the command name (JSON array).
 * @param {string} prefix
 * @param {string[]} tokens
 */
function listCli(prefix, tokens) {
  const haveFlags = tokens.filter((t) => t.startsWith('--'));
  const emitIdx = tokens.lastIndexOf('--emit');
  if (emitIdx !== -1 && emitIdx === tokens.length - 1) {
    return filterPrefix(prefix, SURFACE.emit);
  }
  if (emitIdx !== -1 && tokens.length === emitIdx + 2 && !prefix.startsWith('-')) {
    // Completing/replacing the emit target
    return filterPrefix(prefix, SURFACE.emit);
  }

  const profileIdx = tokens.lastIndexOf('--profile');
  if (profileIdx !== -1) {
    const after = tokens.slice(profileIdx + 1);
    const hitNextFlag = after.some((t) => t.startsWith('--'));
    if (!hitNextFlag) {
      // Still in profile span — pairs only (or empty → pairs)
      if (!prefix.startsWith('--')) return listProfile(prefix);
    }
  }

  const pathish = tokens.some((t, i) => {
    if (t.startsWith('-') || /^[A-Za-z_]\w*=/.test(t)) return false;
    const prev = tokens[i - 1];
    if (prev === '--emit') return false;
    // Tokens inside a --profile span are pairs, not paths.
    const pIdx = tokens.lastIndexOf('--profile');
    if (pIdx !== -1 && i > pIdx) {
      const between = tokens.slice(pIdx + 1, i);
      if (!between.some((x) => x.startsWith('--'))) return false;
    }
    return true;
  });

  if (prefix.startsWith('-')) {
    return listFlags(prefix, haveFlags);
  }

  if (prefix === '') {
    const flags = listFlags('', haveFlags);
    if (pathish) return flags;
    const root = findTwinseedRoot(process.cwd());
    if (!root) return flags;
    // Sparse: skeletons/templates first, then flags — not a dump of everything.
    const seeds = listSeeds(root, process.cwd(), '').slice(0, 12);
    return [...seeds, ...flags];
  }

  // Non-flag word: seed path, unless previous token was --emit (handled) or KEY=
  if (/^[A-Za-z_]\w*=/.test(prefix)) {
    // Param completion is open-ended — stay quiet.
    return [];
  }

  const root = findTwinseedRoot(process.cwd());
  if (!root) return [];
  return listSeeds(root, process.cwd(), prefix);
}

function emitLines(lines) {
  for (const line of lines) {
    if (line !== undefined && line !== null && String(line).length) {
      process.stdout.write(`${line}\n`);
    }
  }
}

if (wantSurface) {
  process.stdout.write(JSON.stringify(SURFACE, null, 2));
  process.exit(0);
}

if (!kind) {
  process.stderr.write(
    'twinseed: completion needs --kind (seeds|flags|profile|emit|basedirs|strict|mark|prompt|cli)\n',
  );
  process.exit(1);
}

const cwd = process.cwd();
const root = findTwinseedRoot(cwd);
const have = haveRaw
  ? haveRaw.split(',').map((s) => s.trim()).filter(Boolean)
  : [];

/** @type {string[]} */
let out = [];

switch (kind) {
  case 'seeds': {
    if (!root) break;
    out = listSeeds(root, cwd, word);
    break;
  }
  case 'basedirs': {
    if (!root) break;
    out = listBaseDirs(root, cwd, word);
    break;
  }
  case 'flags':
    out = listFlags(word, have);
    break;
  case 'profile':
    out = listProfile(word);
    break;
  case 'emit':
    out = filterPrefix(word, SURFACE.emit);
    break;
  case 'strict':
    out = filterPrefix(word, SURFACE.strict);
    break;
  case 'mark':
    out = filterPrefix(word, SURFACE.mark);
    break;
  case 'prompt':
    out = filterPrefix(word, SURFACE.prompt);
    break;
  case 'cli': {
    /** @type {string[]} */
    let tokens = [];
    if (tokensRaw) {
      try {
        const parsed = JSON.parse(tokensRaw);
        if (Array.isArray(parsed)) tokens = parsed.map(String);
      } catch {
        /* quiet */
      }
    }
    out = listCli(word, tokens);
    break;
  }
  default:
    // Unknown kind → quiet (taste: don't noise the shell).
    process.exit(0);
}

emitLines(out);
