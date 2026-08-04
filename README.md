# Verso

YAML structural markup that renders to HTML — and publishes **JSON-LD** from the same tree.

The web has always had two layers that rarely stay aligned: a **presentational tree** (what browsers paint) and a **knowledge graph** (what machines can interpret). Verso treats them as two faces of one leaf. You author an indentation-based structure; the runtime emits DOM for humans and linked data for the Semantic Web.

Optional JSON-RPC and WebSockets re-evaluate that pipeline when state changes, so presentation and assertions update together.

> The other side of the page is meaning.

## Features

- **Verso markup** — keys are tags; indentation is the tree; `children:` for sibling elements
- **Linked data from structure** — `@context` / `@type`, `ld:` blocks, and class→vocabulary conventions
- **Reactive assertions** — `{ ref: "#id .class" }` binds graph properties to the same content the UI shows
- **Conditional assertions** — `ld_if` chooses types or properties from the data in the tree
- **Vocabulary conventions** — map presentational classes to types in Schema.org (or your own context)
- **Live graph views** — JSON-RPC renders fragments; Socket.IO pushes HTML + JSON-LD on update

## Quick start

```bash
npm install
npm start
```

Open [http://localhost:3847](http://localhost:3847) for the live demo: change state and watch the presentational tree and the JSON-LD graph update together.

```bash
# Render a file (HTML + linked data)
npm run render -- templates/demo.yml --json

# Inject graph/entity data into placeholders
npm run render -- templates/product.yml --json \
  id=item_1 name="Widget" price=19.99 description="A thing" finish=Steel
```

Requires **Node.js 18+**.

Full walkthrough: [QUICKSTART.md](QUICKSTART.md)  
Extend & customize: [examples/README.md](examples/README.md)

## Example

A presentational subtree that also asserts typed entities in a shared vocabulary (`https://schema.org` here — any JSON-LD `@context` fits the same pattern):

```yaml
"@context": "https://schema.org"

div:
  class: "product"
  id: "item_1"

  ld_if:
    condition: { ref: "#item_1 .price", operator: "<", value: 100 }
    then: { "@type": BudgetProduct }
    else: { "@type": PremiumProduct }

  children:
    - h1:
        class: "name"
        text: "Travel Mug"
    - span:
        class: "price"
        text: "79.00"
```

The runtime renders the HTML card and a JSON-LD document: implicit `Product` properties from the convention, plus the conditional type from `ld_if`. Presentation and graph share one tree.

## Why this shape?

HTML alone is weak as a knowledge carrier. Separate RDF/JSON-LD files drift from the page. Verso keeps **structure, presentation, and assertion** in one authoring pass — closer to the Semantic Web’s original bet that the web of documents and the web of data should be the same web.

Crawlers and rich-result consumers are one audience for that graph. Agents, datasets, and interoperable APIs are others.

## JSON-RPC

Publish or refresh a fragment and its linked data:

```bash
curl -s http://localhost:3847/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "renderComponent",
    "params": {
      "componentId": "product",
      "data": {
        "id": "item_55",
        "name": "Quantum Headphones",
        "price": "299.00",
        "description": "From the future",
        "finish": "Matte Black"
      }
    },
    "id": 1
  }'
```

Methods: `renderComponent`, `renderDocument`, `updateState`, `getState`, `listTemplates`, `ping`.

Templates are files in `templates/<name>.yml`, selected by `componentId`.

## Project layout

| Path | Role |
|------|------|
| `src/parser/` | YAML → HTML, ContentMap, JSON-LD resolution, vocabulary conventions |
| `src/server/` | Express JSON-RPC + Socket.IO (live graph/presentation sync) |
| `src/cli.js` | Offline render |
| `templates/` | Named components for RPC |
| `public/` | Live demo client |
| `examples/` | Syntax and extension samples |

## Extend

Bind a new presentational class to a vocabulary type, or add an RPC method that returns HTML + JSON-LD:

```js
import { registerConvention } from './src/parser/conventions.js';
import { registerMethod } from './src/server/rpc.js';

registerConvention('event', {
  type: 'Event',
  fields: { name: '.name', startDate: '.startDate', location: '.location' },
});

registerMethod('renderSnippet', (params) => { /* ... */ });
```

See [examples/README.md](examples/README.md) for runnable patterns.

## License

No license file yet — all rights reserved unless otherwise noted.
