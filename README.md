# Twinseed

YAML structural markup that renders to HTML — and publishes **JSON-LD** from the same tree.

The web has always had two layers that rarely stay aligned: a **presentational tree** (what browsers paint) and a **knowledge graph** (what machines can interpret). Twinseed treats them as two faces of one leaf. You author an indentation-based structure; the runtime emits DOM for humans and linked data for the Semantic Web.

Optional JSON-RPC and WebSockets re-evaluate that pipeline when state changes, so presentation and assertions update together.

> One seed, two leaves.

## Features

**Language**

- **Twinseed markup** — keys are tags; indentation is the tree; `children:` for ordered siblings
- **Includes** — `include: "file.yml"` inlines a partial; `file.yml#id` pulls a single element (conref-lite), `include: { key: name }` makes it a conkeyref
- **Keys** — a `keys:` block binds symbolic names; `{ key: name }` resolves them in text, attributes, `ld:` values, and `include:` paths — late-bound from one place
- **Presentation profiles** — `if:` / `flag:` filter or mark content per render against an `audience` / `platform` / `product` profile; excluded content never asserts into the graph
- **Document heads** — `head:` blocks (`title`, `meta`, `link`, `css:`) fill the `<head>` of `--doc` output

**Linked data**

- **Linked data from structure** — `@context` (string, array, or map), `ld:` blocks, and class→vocabulary conventions
- **Reactive assertions** — `{ ref: "#id .class" }` binds graph properties to the same content the UI shows
- **Conditional assertions** — `ld_if` chooses types or properties from the data in the tree
- **YAML conventions** — declare class→type mappings in the file itself, with `extends:` single inheritance (`@type` union) and `requires:` strict-mode field checks
- **Graph identity** — `@id` on any element names its graph node; co-authored entities sharing an `@id` deep-merge, `@type`s union

**Composition**

- **Map documents** — a top-level `map:` composes fragments into a publication: nested `<section>`s, generated nav, related-links, prev/next pagers, and a `CollectionPage` node with `hasPart` — one structure, three projections
- **Knowledge feeds** — the same seed projects Atom / RSS (`--emit atom`, `GET /feed`) from TechArticle / DefinedTerm / HowTo-shaped graph nodes — a changelog/concept stream, not a product catalog
- **Knowledge watches** — session watches on ContentMap selectors (version, status, …) reuse `ld_if` conditions; Socket.IO emits `knowledgeAlert` when a condition edges true or a watched value changes

**Tooling**

- **CLI** — render, `--json`, `--doc`, `--watch`, `--strict`, `--profile`, `KEY=value` params, and `--emit resolved` to inspect the resolved intermediate tree
- **Live graph views** — JSON-RPC renders fragments and map sections; Socket.IO pushes HTML + JSON-LD on update (and `knowledgeAlert` for watches)
- **Reading room** — `/live/` serves book-spread demos rendered straight from `.yml` sources

## Quick start

```bash
npm install
npm start
```

Open [http://localhost:3847](http://localhost:3847) for the live sync demo (DefinedTerm concept card + knowledge watches). Then browse the reading room at [http://localhost:3847/live/](http://localhost:3847/live/) — hello, exotic HTML5, Semantic Web mockup, feed, and watch lab.

```bash
# Render a file (HTML + linked data)
npm run render -- templates/demo.yml --json

# Compose a publication from fragments
node src/cli.js examples/14-map/site.map.yml --doc

# Inspect the resolved tree the renderer consumes
node src/cli.js examples/12-keys.yml --emit resolved

# Inject concept placeholders (prefer over product.yml for docs demos)
npm run render -- templates/concept.yml --json \
  id=json-rpc name="JSON-RPC" description="RPC over JSON" version=2.0 status=stable

# Knowledge feed from the same seed graph
node src/cli.js examples/17-feed/knowledge.map.yml --emit atom
```

Requires **Node.js 18+**.

Full walkthrough: [QUICKSTART.md](QUICKSTART.md)
Extend & customize: [examples/README.md](examples/README.md)
Design research (DITA → Twinseed): [docs/dita-research.md](docs/dita-research.md)

## Example

A presentational subtree that also asserts a typed concept — with `keys:` binding names once and `{ key }` / `{ ref }` resolving them on both faces of the leaf (`https://schema.org` here — any JSON-LD `@context` fits the same pattern):

```yaml
"@context": "https://schema.org"

keys:
  term-name: "JSON-LD"                          # variable text
  glossary: { href: "https://www.w3.org/TR/json-ld11/" }

div:
  class: "definedterm"
  id: "json-ld"

  ld:
    "@type": DefinedTerm
    name: { key: term-name }
    description: { ref: "#json-ld .description" }
    termCode: "json-ld"

  children:
    - h1: { class: "name", text: { key: term-name } }
    - p: { class: "description", text: "A JSON-based concrete syntax for RDF." }
    - a: { href: { key: glossary }, text: "W3C JSON-LD 1.1" }
```

The runtime renders the HTML and a JSON-LD document: the `DefinedTerm` entity named by `{ key }`, described by `{ ref }`. Presentation and graph share one tree — change the key once and both sides follow.

## Why this shape?

HTML alone is weak as a knowledge carrier. Separate RDF/JSON-LD files drift from the page. Twinseed keeps **structure, presentation, and assertion** in one authoring pass — closer to the Semantic Web’s original bet that the web of documents and the web of data should be the same web.

Crawlers and linked-data consumers are one audience for that graph. Agents, datasets, and interoperable APIs are others.

## JSON-RPC

Publish or refresh a fragment and its linked data:

```bash
curl -s http://localhost:3847/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "renderComponent",
    "params": {
      "componentId": "concept",
      "data": {
        "id": "json-rpc",
        "name": "JSON-RPC 2.0",
        "description": "RPC encoded in JSON",
        "version": "2.0",
        "status": "stable"
      }
    },
    "id": 1
  }'
```

Methods: `renderComponent`, `renderDocument`, `renderInline`, `renderFeed`, `getBacklinks`, `updateState`, `addWatch`, `getState`, `listTemplates`, `ping`.

- `renderInline` renders YAML supplied in the request body — no `templates/` file needed.
- `params.item: "KEY"` on `renderComponent` / `renderInline` chunks a `map:` document into one section's HTML plus its slice of the graph.
- `params.profile: { "audience": "admin" }` filters `if:` / `flag:` for that render.
- `addWatch` / `knowledgeAlert` watch concept fields (version, status, …) over Socket.IO.

Templates are files in `templates/<name>.yml`, selected by `componentId`. Prefer `concept` for technical-docs demos; `product` remains for legacy callers.

## The reading room — `/live/`

[http://localhost:3847/live/](http://localhost:3847/live/) is a small reading room: each leaf renders a `.yml` source live over RPC (`renderInline`) into a book spread — JSON-LD on the verso page, HTML on the recto, source in the colophon.

- **sync** (`/`) — live multi-window concept card + knowledge watches
- **hello, world** — the full arc in one file: keys, YAML conventions with `extends:`, `ld:` / `ld_if`, and profiles
- **exotic** — a field guide to HTML5's stranger elements, every one authored as a YAML key
- **semantic web** — the Wikipedia “Semantic Web” article mocked up as one Twinseed tree
- **feed** — Atom/RSS knowledge stream from the same map as HTML + JSON-LD
- **watch** — register version/status watches and see `knowledgeAlert` fire
- **backlinks** — inverse relations from `map.relations` + JSON-LD edges (`getBacklinks`)
- **editor** — collaborative YAML draft room
## Project layout

| Path | Role |
|------|------|
| `src/parser/` | YAML → HTML, ContentMap, JSON-LD resolution, vocabulary conventions |
| `src/parser/keys.js` | `keys:` block + `{ key }` resolution |
| `src/parser/map.js` | `map:` composition documents (sections, nav, pager, site graph) |
| `src/parser/feed.js` | Atom / RSS knowledge feed + backlinks from the JSON-LD / map graph |
| `src/parser/context.js` | LLM knowledge pack (`--emit context` / `renderContext`) |
| `src/parser/profiles.js` | `if:` / `flag:` profile filtering |
| `src/parser/includes.js` | `include:` partials and `file.yml#id` element pulls |
| `src/parser/validate.js` | strict-mode validation |
| `src/server/` | Express JSON-RPC + Socket.IO (live graph/presentation sync) |
| `src/cli.js` | Offline render; `--emit resolved|atom|rss|context` |
| `templates/` | Named components for RPC |
| `public/` | Live demo client |
| `live/` | Reading room — book-spread demos and their `.yml` sources |
| `examples/` | Syntax and extension samples |
| `docs/` | Research notes (DITA concepts mapped onto Twinseed) |

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

[MIT](LICENSE)
