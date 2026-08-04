/**
 * Example: register a custom JSON-RPC method that renders inline YAML
 * and returns both presentational HTML and the JSON-LD graph.
 *
 *   node examples/06-custom-rpc.js
 *
 * To expose this on the live server, import and call registerMethod
 * from src/server/index.js before listen().
 */

import { registerMethod, handleRpc } from '../src/server/rpc.js';
import { renderYaml } from '../src/parser/yamlDom.js';

registerMethod('renderSnippet', (params = {}) => {
  if (!params.yaml || typeof params.yaml !== 'string') {
    const err = new Error('params.yaml (string) is required');
    err.code = -32602;
    throw err;
  }
  const result = renderYaml(params.yaml, { params: params.data ?? {} });
  return {
    html: result.html,
    ldJson: result.ldJson,
    contentMap: result.contentMap,
  };
});

const response = handleRpc({
  jsonrpc: '2.0',
  method: 'renderSnippet',
  params: {
    yaml: `
div:
  class: "note"
  id: "{{id}}"
  children:
    - h2: "{{title}}"
    - p: "{{body}}"
`,
    data: {
      id: 'n1',
      title: 'Custom RPC',
      body: 'YAML arrived in the request, not from templates/.',
    },
  },
  id: 1,
});

console.log(JSON.stringify(response, null, 2));
