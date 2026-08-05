/**
 * Smoke / unit checks for s-ia diagram highlights (P1 + FocusSet + wildcards).
 * Usage: node scripts/diagram-highlights.js
 */

import assert from 'node:assert/strict';
import {
  expandWildcardPath,
  extractDiagramHighlights,
  formatHighlightDirective,
  jsonDiagramText,
  roleStereotype,
} from '../src/server/diagram.js';

assert.equal(roleStereotype('Focus'), 'Focus');
assert.equal(roleStereotype({ '@id': 'https://twinseed.local/ia#Warning' }), 'Warning');
assert.equal(roleStereotype('ia:StatusOk'), 'StatusOk');
assert.equal(
  formatHighlightDirective(['@graph', '0', 'status'], 'Focus'),
  '#highlight "@graph" / "0" / "status" <<Focus>>',
);

const ld = {
  '@context': ['/exemplar/schema.jsonld', '/ia/schema.jsonld'],
  '@graph': [
    {
      '@type': 'PracticeCanvas',
      name: 'Diagram focus',
      status: 'practicing',
      purpose: 'highlights',
    },
    {
      '@type': 'DiagramHighlight',
      highlightPath: ['@graph', '0', 'status'],
      role: 'Focus',
    },
    {
      '@type': 'DiagramHighlight',
      highlightPath: ['@graph', '0', 'purpose'],
      role: { '@id': 'https://twinseed.local/ia#Warning' },
    },
  ],
};

const { body, lines } = extractDiagramHighlights(ld);
assert.deepEqual(lines, [
  '#highlight "@graph" / "0" / "status" <<Focus>>',
  '#highlight "@graph" / "0" / "purpose" <<Warning>>',
]);
assert.equal(/** @type {any} */ (body)['@graph'].length, 1);
assert.equal(/** @type {any} */ (body)['@graph'][0].status, 'practicing');

const uml = jsonDiagramText(ld);
assert.match(uml, /#highlight "@graph" \/ "0" \/ "status" <<Focus>>/);
assert.match(uml, /#highlight "@graph" \/ "0" \/ "purpose" <<Warning>>/);
assert.match(uml, /\.Focus \{/);
assert.match(uml, /\.Warning \{/);
assert.doesNotMatch(uml, /DiagramHighlight/);
assert.match(uml, /"status": "practicing"/);
assert.match(uml, /skinparam backgroundColor #f5f0e4/);

// Wildcard `"*"` expands against the stripped body (one segment fan-out)
const wildBody = {
  '@graph': [
    { status: 'a', purpose: 'x' },
    { status: 'b', purpose: 'y' },
  ],
};
assert.deepEqual(expandWildcardPath(['@graph', '*', 'status'], wildBody), [
  ['@graph', '0', 'status'],
  ['@graph', '1', 'status'],
]);
assert.deepEqual(expandWildcardPath(['*'], {}), []);

const wild = extractDiagramHighlights({
  '@graph': [
    { status: 'a' },
    { status: 'b' },
    {
      '@type': 'DiagramHighlight',
      highlightPath: ['@graph', '*', 'status'],
      role: 'Focus',
    },
  ],
});
assert.deepEqual(wild.lines, [
  '#highlight "@graph" / "0" / "status" <<Focus>>',
  '#highlight "@graph" / "1" / "status" <<Focus>>',
]);
assert.equal(/** @type {any} */ (wild.body)['@graph'].length, 2);
assert.doesNotMatch(JSON.stringify(wild.body), /DiagramHighlight/);

// Lone wildcard with empty body after strip → no directives
const loneWild = extractDiagramHighlights({
  '@type': 'DiagramHighlight',
  highlightPath: ['*'],
  role: 'Focus',
});
assert.deepEqual(loneWild.lines, []);
assert.deepEqual(loneWild.body, {});

// DiagramFocusSet bundles highlights; whole set is stripped
const focusSetLd = {
  '@context': ['/exemplar/schema.jsonld', '/ia/schema.jsonld'],
  '@graph': [
    {
      '@type': 'PracticeCanvas',
      name: 'Focus set',
      status: 'practicing',
      purpose: 'bundle',
    },
    {
      '@type': 'DiagramFocusSet',
      highlights: [
        {
          '@type': 'DiagramHighlight',
          highlightPath: ['@graph', '0', 'status'],
          role: 'Focus',
        },
        {
          highlightPath: ['@graph', '0', 'purpose'],
          role: 'Warning',
        },
      ],
    },
  ],
};
const bundled = extractDiagramHighlights(focusSetLd);
assert.deepEqual(bundled.lines, [
  '#highlight "@graph" / "0" / "status" <<Focus>>',
  '#highlight "@graph" / "0" / "purpose" <<Warning>>',
]);
assert.equal(/** @type {any} */ (bundled.body)['@graph'].length, 1);
assert.doesNotMatch(JSON.stringify(bundled.body), /DiagramFocusSet|DiagramHighlight/);

const bundledUml = jsonDiagramText(focusSetLd);
assert.doesNotMatch(bundledUml, /DiagramFocusSet/);
assert.match(bundledUml, /skinparam backgroundColor #f5f0e4/);
assert.match(bundledUml, /\.Focus \{/);

// FocusSet + wildcard in one highlight member
const setWild = extractDiagramHighlights({
  '@graph': [
    { name: 'one', status: 'ok' },
    { name: 'two', status: 'bad' },
    {
      '@type': 'DiagramFocusSet',
      highlights: [
        {
          '@type': 'DiagramHighlight',
          highlightPath: ['@graph', '*', 'status'],
          role: 'StatusOk',
        },
      ],
    },
  ],
});
assert.deepEqual(setWild.lines, [
  '#highlight "@graph" / "0" / "status" <<StatusOk>>',
  '#highlight "@graph" / "1" / "status" <<StatusOk>>',
]);

// Root diagramFocus sugar
const sugar = extractDiagramHighlights({
  '@graph': [{ status: 'practicing' }],
  diagramFocus: {
    '@type': 'DiagramFocusSet',
    highlights: [
      {
        '@type': 'DiagramHighlight',
        highlightPath: ['@graph', '0', 'status'],
        role: 'Focus',
      },
    ],
  },
});
assert.deepEqual(sugar.lines, ['#highlight "@graph" / "0" / "status" <<Focus>>']);
assert.equal(/** @type {any} */ (sugar.body).diagramFocus, undefined);

console.log('ok   diagram-highlights (FocusSet + wildcards)');
