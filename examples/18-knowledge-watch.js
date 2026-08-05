/**
 * 18 — Knowledge watch: alert when a concept version/status changes.
 *
 *   node examples/18-knowledge-watch.js
 *
 * Session watches reuse ld_if's condition evaluator. Mode "change" fires when
 * a ContentMap selector's value changes; mode "when" edge-triggers on a
 * condition becoming true (e.g. status == deprecated).
 */

import { handleRpc } from '../src/server/rpc.js';
import { clearWatches } from '../src/server/watches.js';

const sessionId = 'knowledge-demo';
clearWatches(sessionId);

function rpc(method, params, id) {
  const response = handleRpc(
    { jsonrpc: '2.0', method, params: { sessionId, ...params }, id },
    { sessionId },
  );
  if (response.error) {
    console.error(method, response.error);
    process.exitCode = 1;
    throw new Error(response.error.message);
  }
  return response.result;
}

const base = {
  componentId: 'concept',
  itemId: 'json-rpc',
  data: {
    id: 'json-rpc',
    name: 'JSON-RPC 2.0',
    description: 'A lightweight remote procedure call protocol encoded in JSON.',
    version: '2.0',
    status: 'stable',
  },
};

rpc('addWatch', {
  id: 'version-bump',
  mode: 'change',
  ref: '#json-rpc .version',
  conceptId: 'json-rpc',
  message: 'JSON-RPC concept version changed — review dependents.',
}, 1);

rpc('addWatch', {
  id: 'deprecated',
  mode: 'when',
  ref: '#json-rpc .status',
  operator: '==',
  value: 'deprecated',
  conceptId: 'json-rpc',
  message: 'Warning: JSON-RPC concept marked deprecated.',
}, 2);

// Prime change-watch with the initial sample (no alert yet)
let out = rpc('updateState', { ...base, updates: {} }, 3);
if (out.alerts?.length) {
  console.error('unexpected alerts on prime', out.alerts);
  process.exitCode = 1;
  process.exit(1);
}

out = rpc(
  'updateState',
  { ...base, updates: { version: '2.1' } },
  4,
);
const versionAlert = out.alerts?.find((a) => a.watchId === 'version-bump');
if (!versionAlert || versionAlert.previousValue !== '2.0' || versionAlert.currentValue !== '2.1') {
  console.error('expected version-bump alert', out.alerts);
  process.exitCode = 1;
  process.exit(1);
}

out = rpc(
  'updateState',
  {
    ...base,
    updates: { version: '2.1', status: 'deprecated' },
  },
  5,
);
const depAlert = out.alerts?.find((a) => a.watchId === 'deprecated');
if (!depAlert) {
  console.error('expected deprecated alert', out.alerts);
  process.exitCode = 1;
  process.exit(1);
}

const listed = rpc('listWatches', {}, 6);
console.log(
  JSON.stringify(
    {
      ok: true,
      versionAlert,
      depAlert,
      watches: listed.watches.map((w) => w.id),
      ldType: out.newLdJson?.['@graph']?.[0]?.['@type'] ?? out.newLdJson?.['@type'],
    },
    null,
    2,
  ),
);

clearWatches(sessionId);
