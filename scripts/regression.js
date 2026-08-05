/**
 * Regression: render every example and template in lenient and strict modes.
 * Exits non-zero on the first failure with the failing command's output.
 * Usage: node scripts/regression.js   (or: npm test)
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'src', 'cli.js');
let failed = 0;
let count = 0;

function run(label, args) {
  count++;
  try {
    execFileSync(process.execPath, args, { cwd: root, stdio: 'pipe' });
    console.log(`ok   ${label}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${label}`);
    console.error(String(err.stdout ?? '').slice(0, 500));
    console.error(String(err.stderr ?? '').slice(0, 500));
  }
}

const examplesDir = path.join(root, 'examples');
const examples = fs
  .readdirSync(examplesDir)
  .filter((f) => f.endsWith('.yml'))
  .sort();

for (const f of examples) {
  const rel = path.join('examples', f);
  run(`${f} --json`, [cli, rel, '--json']);
  run(`${f} --strict`, [cli, rel, '--strict']);
}

run('14-map --json', [cli, 'examples/14-map/site.map.yml', '--json']);
run('14-map --strict', [cli, 'examples/14-map/site.map.yml', '--strict']);
run('14-map --emit resolved', [cli, 'examples/14-map/site.map.yml', '--emit', 'resolved']);

run('17-feed --json', [cli, 'examples/17-feed/knowledge.map.yml', '--json']);
run('17-feed --strict', [cli, 'examples/17-feed/knowledge.map.yml', '--strict']);
run('17-feed --emit atom', [cli, 'examples/17-feed/knowledge.map.yml', '--emit', 'atom']);
run('17-feed --emit rss', [cli, 'examples/17-feed/knowledge.map.yml', '--emit', 'rss']);
run('17-feed --emit context', [cli, 'examples/17-feed/knowledge.map.yml', '--emit', 'context']);

run('demo.yml --strict', [cli, 'templates/demo.yml', '--strict']);
run('product.yml --strict (params)', [
  cli,
  'templates/product.yml',
  '--strict',
  'id=t1',
  'name=T',
  'price=9',
  'description=D',
  'finish=F',
]);

run('emit keys', [cli, 'examples/12-keys.yml', '--emit', 'resolved']);
run('emit profiles', [
  cli,
  'examples/16-profiles.yml',
  '--emit',
  'resolved',
  '--profile',
  'audience=novice',
]);

run('05-register-convention.js', [path.join('examples', '05-register-convention.js')]);
run('06-custom-rpc.js', [path.join('examples', '06-custom-rpc.js')]);
run('18-knowledge-watch.js', [path.join('examples', '18-knowledge-watch.js')]);
run('concept.yml --strict (params)', [
  cli,
  'templates/concept.yml',
  '--strict',
  'id=json-rpc',
  'name=JSON-RPC',
  'description=RPC over JSON',
  'version=2.0',
  'status=stable',
]);
run('diagram-highlights.js', [path.join('scripts', 'diagram-highlights.js')]);
run('diagram-focus.skel.yml --json', [
  cli,
  'exemplar/templates/diagram-focus.skel.yml',
  '--json',
]);

for (const f of fs.readdirSync(path.join(root, 'live')).filter((f) => f.endsWith('.yml'))) {
  run(`live/${f} --strict`, [cli, path.join('live', f), '--strict']);
}

console.log(`\n${count - failed}/${count} passed`);
process.exit(failed ? 1 : 0);
