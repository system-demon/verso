# render-tree

YAML structural markup that renders to HTML — with reactive JSON-LD, JSON-RPC, and WebSocket sync.

Write indentation-based trees instead of angle-bracket HTML. The same source can drive the visible DOM and Schema.org metadata, so UI copy and SEO stay one source of truth. Optional live transport re-renders components when state changes and pushes HTML + linked data to connected clients.

## Features

- **YML-DOM** — keys are tags; indentation is the tree; `children:` for sibling elements
- **Reactive JSON-LD** — `{ ref: "#id .class" }` pulls values from rendered content
- **Conditional metadata** — `ld_if` branches Schema.org types on content (e.g. price thresholds)
- **Implicit conventions** — classes like `product` / `review` / `article` emit Schema.org entities
- **Templates** — `{{placeholders}}` filled from CLI args or RPC params
- **JSON-RPC + Socket.IO** — remote render and real-time `pushUpdate`

## Quick start

```bash
npm install
npm start
```

Open [http://localhost:3847](http://localhost:3847) for the live demo.

```bash
# Render a file
npm run render -- templates/demo.yml --json

# With placeholder data
npm run render -- templates/product.yml --json \
  id=item_1 name="Widget" price=19.99 description="A thing" finish=Steel
```

Requires **Node.js 18+**.

Full walkthrough: [QUICKSTART.md](QUICKSTART.md)
Extend & customize: [examples/README.md](examples/README.md)

## Example

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

Renders HTML for the card and JSON-LD that reflects both the implicit `Product` convention and the `ld_if` branch (`BudgetProduct` here).

## JSON-RPC

With the server running:

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
| `src/parser/` | YAML → HTML, ContentMap, LD resolution, conventions |
| `src/server/` | Express JSON-RPC + Socket.IO |
| `src/cli.js` | Offline render |
| `templates/` | Named components for RPC |
| `public/` | Live demo client |
| `examples/` | Syntax and extension samples |

## Extend

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
