# Quickstart

**render-tree** turns YAML into HTML, and can derive JSON-LD from the same tree. Optional JSON-RPC + WebSockets keep the UI and metadata in sync when state changes.

## Requirements

- Node.js 18+

## Install & run

```bash
npm install
npm start
```

Open [http://localhost:3847](http://localhost:3847). Edit name/price/finish and submit — the HTML card and the JSON-LD panel update together. Open a second tab to see live sync.

## Render a file from the CLI

```bash
# HTML + JSON-LD script comment
npm run render -- templates/demo.yml

# Structured output
npm run render -- templates/demo.yml --json

# Full HTML document
npm run render -- templates/demo.yml --doc

# Fill {{placeholders}}
npm run render -- templates/product.yml --json id=item_1 name="Widget" price=19.99 description="A thing" finish=Steel
```

## Minimal YML-DOM file

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

## Add Schema.org without duplicating copy

**Implicit** — a trigger class fills JSON-LD from child classes:

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

**Reactive** — point LD fields at the UI:

```yaml
ld:
  "@type": Product
  name: { ref: "#item_1 .name" }
  offers:
    "@type": Offer
    price: { ref: "#item_1 .price" }
    priceCurrency: USD
```

**Conditional** — branch metadata on content:

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

## Call the renderer over JSON-RPC

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

Built-in methods: `renderComponent`, `renderDocument`, `updateState`, `getState`, `listTemplates`, `ping`.

Templates live in `templates/<name>.yml` and are selected by `componentId`.

## Project map

| Path | Role |
|------|------|
| `src/parser/yamlDom.js` | YAML → HTML + ContentMap + LD harvest |
| `src/parser/conventions.js` | Implicit Schema.org class → type map |
| `src/parser/ldResolver.js` | `{ ref }` + `ld_if` |
| `src/server/rpc.js` | JSON-RPC methods |
| `src/server/index.js` | HTTP + Socket.IO |
| `templates/` | Named components for RPC |
| `examples/` | Extension & customization walkthrough |

Next: see [examples/README.md](examples/README.md) for copy-paste patterns to extend conventions, templates, and RPC.
