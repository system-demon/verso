#!/usr/bin/env node
/**
 * Twinseed CLI — render a seed (YAML genome → HTML + JSON-LD).
 *
 *   node src/cli.js <seed.yml> [--json] [--doc] [--strict] [--watch]
 *                   [--emit resolved] [--profile key=value ...] [KEY=value ...]
 *
 * The seed is the source of truth. Flags only choose how the leaves are shown.
 *
 *   --json       { html, ldJson, contentMap } as JSON
 *   --doc        full HTML document
 *   --strict     validate the tree first (also TWINSEED_STRICT=1)
 *   --watch      re-render on change; stdout stays parseable (status on stderr)
 *   --emit resolved
 *                print the resolved intermediate tree as YAML instead of
 *                rendering (includes inlined, profile applied, keys/params
 *                substituted; maps: assembled section/nav). Not with --json/--doc.
 *   --profile    if:/flag: attributes — key=value pairs until the next --flag
 *                (vocabulary: audience, platform, product; omit → all renders)
 *   -h, --help   this help
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { renderYaml, resolveTree, toDocument } from './parser/yamlDom.js';

const args = process.argv.slice(2);
const PARAM_RE = /^([A-Za-z_]\w*)=(.*)$/;

const USAGE =
  'twinseed: render a seed — node src/cli.js <seed.yml> [--json] [--doc] [--strict] [--watch] [--emit resolved] [--profile key=value ...] [KEY=value ...]';

const HELP = `twinseed — render a seed (YAML genome → HTML + JSON-LD)

  node src/cli.js <seed.yml> [options] [KEY=value ...]

Options
  --json              print { html, ldJson, contentMap }
  --doc               full HTML document
  --strict            validate first (or TWINSEED_STRICT=1)
  --watch             re-render on change (status on stderr)
  --emit resolved     print the resolved tree as YAML (not with --json/--doc)
  --profile k=v …     presentation profile for if:/flag:
                      vocabulary: audience, platform, product
  -h, --help          this help

The seed is the source of truth. Flags only choose how the leaves are shown.
`;

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(HELP);
  process.exit(0);
}

// --profile key=value ... — pairs after the flag until the next --flag
const profileIdx = args.indexOf('--profile');
/** @type {string[] | undefined} */
let profilePairs;
const profileSpan = new Set();
if (profileIdx !== -1) {
  profilePairs = [];
  for (let i = profileIdx + 1; i < args.length && !args[i].startsWith('--'); i++) {
    profilePairs.push(args[i]);
    profileSpan.add(i);
  }
}

// --emit <target> — print an intermediate form instead of rendering
const emitIdx = args.indexOf('--emit');
/** @type {string | undefined} */
let emitTarget;
let emitValueIdx = -1;
if (emitIdx !== -1) {
  emitValueIdx = emitIdx + 1;
  const value = args[emitValueIdx];
  if (value === undefined || value.startsWith('--')) {
    console.error('twinseed: --emit needs a target (resolved)');
    process.exit(1);
  }
  if (value !== 'resolved') {
    console.error(`twinseed: unknown --emit target "${value}" (resolved)`);
    process.exit(1);
  }
  emitTarget = value;
}

const file = args.find((a, i) => !profileSpan.has(i) && i !== emitValueIdx && !a.startsWith('--') && !PARAM_RE.test(a));
const asJson = args.includes('--json');
const asDoc = args.includes('--doc');
const strict = args.includes('--strict') ? true : undefined;
const watch = args.includes('--watch');

if (emitTarget && (asJson || asDoc)) {
  console.error('twinseed: --emit resolved cannot combine with --json or --doc');
  process.exit(1);
}

if (!file) {
  console.error(USAGE);
  process.exit(1);
}

const filePath = path.resolve(file);
if (!fs.existsSync(filePath)) {
  console.error(`twinseed: seed not found: ${file}`);
  process.exit(1);
}

// Optional KEY=value params (profile pairs are a separate channel)
const params = {};
for (let i = 0; i < args.length; i++) {
  if (profileSpan.has(i)) continue;
  const m = args[i].match(PARAM_RE);
  if (m) params[m[1]] = m[2];
}

function renderOnce() {
  const source = fs.readFileSync(filePath, 'utf8');

  if (emitTarget === 'resolved') {
    const tree = resolveTree(source, {
      params,
      strict,
      baseDir: path.dirname(filePath),
      profile: profilePairs,
    });
    process.stdout.write(yaml.dump(tree));
    return;
  }

  const result = renderYaml(source, {
    params,
    strict,
    baseDir: path.dirname(filePath),
    profile: profilePairs,
  });

  if (asJson) {
    console.log(JSON.stringify({ html: result.html, ldJson: result.ldJson, contentMap: result.contentMap }, null, 2));
  } else if (asDoc) {
    console.log(toDocument(result));
  } else {
    console.log(result.html);
    console.log('\n<!-- JSON-LD -->');
    console.log(result.ldScript);
  }
}

try {
  renderOnce();
} catch (err) {
  console.error(`twinseed: ${err.message}`);
  if (!watch) process.exit(1);
}

if (watch) {
  // fs.watch aborts the whole process on Windows (libuv assertion) when the
  // path contains 8.3 short-name components — canonicalize to the long form.
  let watched = filePath;
  try {
    watched = fs.existsSync(filePath)
      ? fs.realpathSync.native(filePath)
      : path.join(fs.realpathSync.native(path.dirname(filePath)), path.basename(filePath));
  } catch {
    // keep the unresolved path; watching may still work
  }

  // Watch the directory and filter by basename: atomic-save editors replace
  // the file, which silently kills watchers attached to the file itself.
  const dir = path.dirname(watched);
  const base = path.basename(watched);
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;

  fs.watch(dir, (event, filename) => {
    if (filename && filename !== base) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      console.error(`\ntwinseed: rendered ${new Date().toLocaleTimeString()}`);
      try {
        renderOnce();
      } catch (err) {
        console.error(`twinseed: ${err.message}`);
      }
    }, 60);
  });

  console.error(`twinseed: watching ${watched} — Ctrl+C to stop`);
}
