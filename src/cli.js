#!/usr/bin/env node
/**
 * CLI: render a .yml file to HTML (+ optional JSON-LD dump)
 * Usage: node src/cli.js templates/product.yml [--json] [--doc] [--strict] [--watch] [--profile key=value ...] [KEY=value ...]
 *
 *   --json     print { html, ldJson, contentMap } as JSON
 *   --doc      print a full HTML document
 *   --strict   validate the tree first (also VERSO_STRICT=1)
 *   --watch    re-render on file change; keeps stdout parseable (markers on stderr)
 *   --profile  profiling attributes for if:/flag: — collect key=value pairs
 *              after the flag until the next --flag, e.g.
 *              --profile audience=admin platform=web
 *              (vocabulary: audience, platform, product; omit → everything renders)
 */

import fs from 'node:fs';
import path from 'node:path';
import { renderYaml, toDocument } from './parser/yamlDom.js';

const args = process.argv.slice(2);
const PARAM_RE = /^([A-Za-z_]\w*)=(.*)$/;

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

const file = args.find((a, i) => !profileSpan.has(i) && !a.startsWith('--') && !PARAM_RE.test(a));
const asJson = args.includes('--json');
const asDoc = args.includes('--doc');
const strict = args.includes('--strict') ? true : undefined;
const watch = args.includes('--watch');

if (!file) {
  console.error('Usage: node src/cli.js <file.yml> [--json] [--doc] [--strict] [--watch] [--profile key=value ...] [KEY=value ...]');
  process.exit(1);
}

const filePath = path.resolve(file);

// Optional KEY=value params (profile pairs are a separate channel)
const params = {};
for (let i = 0; i < args.length; i++) {
  if (profileSpan.has(i)) continue;
  const m = args[i].match(PARAM_RE);
  if (m) params[m[1]] = m[2];
}

function renderOnce() {
  const source = fs.readFileSync(filePath, 'utf8');
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
  console.error(`verso: ${err.message}`);
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
      console.error(`\n[verso] re-rendered at ${new Date().toLocaleTimeString()}`);
      try {
        renderOnce();
      } catch (err) {
        console.error(`[verso] render error: ${err.message}`);
      }
    }, 60);
  });

  console.error(`[verso] watching ${watched} — Ctrl+C to stop`);
}
