# Quickstart

**Verso** turns a YAML tree into HTML for browsers and **JSON-LD** for the Semantic Web — from the same source. Optional JSON-RPC and WebSockets keep the presentational view and the linked-data graph in sync when state changes.

> The other side of the page is meaning.

## Requirements

- Node.js 18+

## Install & run

```bash
npm install
npm start
```

Open [http://localhost:3847](http://localhost:3847). Edit the fields and submit — the rendered fragment and the JSON-LD panel update together. Open a second tab to see live sync of both layers.

## Render a file from the CLI

```bash
# HTML + JSON-LD script
npm run render -- templates/demo.yml

# Structured output (html + ldJson + contentMap)
npm run render -- templates/demo.yml --json

# Full HTML document with JSON-LD in <head>
npm run render -- templates/demo.yml --doc

# Fill {{placeholders}} (entity / graph data)
npm run render -- templates/product.yml --json id=item_1 name="Widget" price=19.99 description="A thing" finish=Steel
```

## Minimal Verso file

```yaml
body:
  main:
    h1: "Hello"
    p: |
      Multi-line text uses a YAML block scalar.
    div:
      class: "card"
      id: "c1"
      children:
        - p:
            class: "name"
            text: "Card title"
        - span:
            class: "price"
            text: "9.99"
```

Notes:

- Keys are HTML tags (`div`, `h1`, `p`, …).
- Use `text:` (or a bare string) for content; use `class`, `id`, `href`, `style`, etc. for attributes.
- YAML maps cannot repeat the same key — put siblings in a `children:` list.
- Bare `@context` / `@type` keys are fine; the parser quotes them for `js-yaml`.

## Assert linked data without a second document

The same tree can carry JSON-LD. Schema.org is used below as a familiar `@context`; any vocabulary works the same way.

**Implicit** — a convention maps a presentational class to a typed entity and harvests child fields:

```yaml
div:
  class: "product"
  id: "item_1"
  children:
    - h1:
        class: "name"
        text: "Widget"
    - span:
        class: "price"
        text: "19.99"
```

**Reactive** — graph properties reference the presentational content (one fact, two views):

```yaml
ld:
  "@type": Product
  name: { ref: "#item_1 .name" }
  offers:
    "@type": Offer
    price: { ref: "#item_1 .price" }
    priceCurrency: USD
```

**Conditional** — assertions depend on values in the tree:

```yaml
ld_if:
  condition:
    ref: "#item_1 .price"
    operator: "<"
    value: 100
  then:
    "@type": BudgetProduct
  else:
    "@type": PremiumProduct
```

## Publish over JSON-RPC

```bash
curl -s http://localhost:3847/rpc -H "Content-Type: application/json" -d "{
  \"jsonrpc\": \"2.0\",
  \"method\": \"renderComponent\",
  \"params\": {
    \"componentId\": \"product\",
    \"data\": {
      \"id\": \"item_55\",
      \"name\": \"Quantum Headphones\",
      \"price\": \"299.00\",
      \"description\": \"From the future\",
      \"finish\": \"Matte Black\"
    }
  },
  \"id\": 1
}"
```

The result includes both `html` (presentation) and `ldJson` (graph). Built-in methods: `renderComponent`, `renderDocument`, `updateState`, `getState`, `listTemplates`, `ping`.

Templates live in `templates/<name>.yml` and are selected by `componentId`.

## Project map

| Path | Role |
|------|------|
| `src/parser/yamlDom.js` | YAML → HTML + ContentMap + LD harvest |
| `src/parser/conventions.js` | Class → vocabulary type conventions |
| `src/parser/ldResolver.js` | `{ ref }` + `ld_if` |
| `src/server/rpc.js` | JSON-RPC methods |
| `src/server/index.js` | HTTP + Socket.IO |
| `templates/` | Named components for RPC |
| `examples/` | Extension & customization walkthrough |

Next: see [examples/README.md](examples/README.md) for copy-paste patterns to extend conventions, templates, and RPC.
