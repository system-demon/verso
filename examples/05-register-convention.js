/**
 * Example: register a vocabulary convention (class → typed JSON-LD entity),
 * then render YAML that uses it.
 *
 *   node examples/05-register-convention.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerConvention } from '../src/parser/conventions.js';
import { renderYaml } from '../src/parser/yamlDom.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

registerConvention('event', {
  type: 'Event',
  fields: {
    name: '.name',
    startDate: '.startDate',
    location: '.location',
  },
  transform(entity) {
    if (entity.location) {
      entity.location = { '@type': 'Place', name: entity.location };
    }
    return entity;
  },
});

const source = fs.readFileSync(path.join(__dirname, '06-event.yml'), 'utf8');
const result = renderYaml(source);

console.log('=== HTML ===');
console.log(result.html);
console.log('\n=== JSON-LD ===');
console.log(JSON.stringify(result.ldJson, null, 2));
