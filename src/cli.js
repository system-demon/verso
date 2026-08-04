#!/usr/bin/env node
/**
 * CLI: render a .yml file to HTML (+ optional JSON-LD dump)
 * Usage: node src/cli.js templates/product.yml [--json] [--doc]
 */

import fs from 'node:fs';
import path from 'node:path';
import { renderYaml, toDocument } from './parser/yamlDom.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const asJson = args.includes('--json');
const asDoc = args.includes('--doc');

if (!file) {
  console.error('Usage: node src/cli.js <file.yml> [--json] [--doc]');
  process.exit(1);
}

const source = fs.readFileSync(path.resolve(file), 'utf8');

// Optional KEY=value params after --
const params = {};
for (const a of args) {
  const m = a.match(/^([A-Za-z_]\w*)=(.*)$/);
  if (m) params[m[1]] = m[2];
}

const result = renderYaml(source, { params });

if (asJson) {
  console.log(JSON.stringify({ html: result.html, ldJson: result.ldJson, contentMap: result.contentMap }, null, 2));
} else if (asDoc) {
  console.log(toDocument(result));
} else {
  console.log(result.html);
  console.log('\n<!-- JSON-LD -->');
  console.log(result.ldScript);
}
