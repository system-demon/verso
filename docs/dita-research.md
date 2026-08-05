# DITA research for Twinseed — ideas and tooling

Research synthesis, August 2026. Two workstreams: DITA concepts mapped onto Twinseed, and the DITA tooling ecosystem surveyed for borrowable patterns.

**Framing.** DITA and Twinseed share a thesis: structure authored once should project into many outputs. DITA projects topics into HTML/PDF/etc.; Twinseed projects one tree into HTML + JSON-LD. The meta-lesson from the OASIS committee itself: when they built **LwDITA**, they kept *typed topics, maps, conref, and keys* — and dropped specialization machinery, grammar files, and pipelines. MDITA even reached for YAML front matter for metadata. Twinseed already *is* an LwDITA in spirit.

The through-line: DITA spent decades separating **content, composition, and delivery**; Twinseed unified **presentation and assertion**. Import the separation as *data in the tree*, never as a build pipeline.

---

## Concept inventory (what each DITA idea solves)

- **Topic types** (`topic` → concept/task/reference/glossentry) — consistency of content units; types constrain structure. Notably, these are *specializations of a base type*, not hardcoded.
- **Specialization** (the "D" in Darwin) — new types derived by inheritance, with `@class` ancestry enabling graceful fallback to base-type processing. Domains add cross-cutting elements; constraints narrow without new types.
- **conref / conkeyref** — element-level transclusion; referencing element's attributes override. conkeyref names the target via a key instead of a path.
- **conref push / conrefend ranges** — inject into content you don't own; reuse ranges. Highest confusion-to-value ratio in DITA.
- **Maps / bookmaps** — composition, order, navigation, and inter-content linking as separate documents; topics stay map-agnostic; metadata cascades down.
- **Relationship tables** — typed related-links generated from composition, links living outside content.
- **DITAVAL + profiling attributes** (`audience`/`platform`/`product`) — one source, many deliverables; exclude/include/flag decided by an external filter document.
- **Keys (`keydef`/`keyref`)** — symbolic names bound in maps, late-bound, overridable per publication. Variable text and link redirection are the killer apps. DITA's most-loved feature.
- **Chunking** — authoring granularity decoupled from delivery granularity.
- **LwDITA** — XDITA/HDITA/MDITA: three authoring formats, one model. Specialization explicitly out of scope. The committee's own answer to "what if DITA were light?"
- **DITA 2.0** (beta, mid-2026) — still pruning: machinery task, classification map, delayed conref, XNAL removed.

## Mapping table

| DITA concept | Twinseed analog today | Verdict |
|---|---|---|
| Topic types | Conventions + entity shorthand (graph-side typing) | Adapt: `requires:` in strict mode |
| Specialization | Flat JS-only registry | **Adopt lite**: `extends:` + `@type` union fallback |
| Constraints | `--strict` knows nothing of conventions | **Adopt lite**: `requires:` field checks |
| conref | `include:` (file-level; local-keys-win already mirrors attribute override) | **Extend**: `#id` fragment addressing |
| conkeyref | None | Free with keys |
| conref push / ranges | None | **Avoid** |
| Maps / bookmaps | **Nothing** — biggest gap | **Adopt**: `map:` documents |
| reltable / collection-type | None | Flat `relations:` only; next/prev falls out of order |
| DITAVAL | `ld_if` is graph-side, different axis | **Adopt lite**: `if:`/`flag:` + `--profile` params |
| keydef/keyref | `{ ref }` is direct selector coupling; `{{params}}` are compile-time | **Adopt**: `keys:` + `{ key }` |
| Key scopes, chunk attrs, full reltable, subjectScheme | None | **Avoid** |

## Proposals

### P1 — `map:` documents (composition as a first-class file)

The map owns the publication; fragments own content. Twinseed twist DITA never had: a map is *also* graph composition — one structure, three projections (HTML document, nav, site-level knowledge graph via `CollectionPage`/`hasPart`).

```yaml
"@context": "https://schema.org"
map:
  title: "Twinseed Docs"
  ld: { "@type": CollectionPage }
  keys: { product-name: "WonderWidget" }
  items:
    - key: intro
      include: "topics/intro.yml"
      nav: "Introduction"
    - key: pricing
      include: "topics/pricing.yml"
      nav: "Pricing"
      items:
        - key: tiers
          include: "topics/tiers.yml"
          nav: "Tiers"
  relations:
    - [intro, pricing]
```

Items run through existing include machinery, wrapped in `<section id>`; generated `<nav>` reflects structure; `--doc` = one page, `renderComponent` with a named item = fragment (chunking falls out free). Map-level `keys:` and `@context` cascade; `head:` does not.

### P2 — `keys:` + `{ key: name }` (indirection, late-bound)

Fixes `{ ref }`'s silent-breakage risk (selector coupling) and `{{params}}`'s compile-time-only binding.

```yaml
keys:
  product-name: "WonderWidget"        # variable text
  price: { ref: "#item_1 .price" }    # named selector alias
  support: { href: "/support" }       # named link
  logo: "partials/logo.yml"           # named resource

div:
  class: "product"
  id: "item_1"
  ld:
    "@type": Product
    name: { key: product-name }
    offers: { "@type": Offer, price: { key: price } }
  children:
    - h1: { class: "name", text: { key: product-name } }
    - a: { href: { key: support }, text: "Support" }
    - include: { key: logo }
```

Resolution order: explicit `{ ref }` > params > file-local `keys:` > including file's `keys:` (first definition wins, DITA-flavored). `{ key }` works in `ld:` values, attributes, `text:`, and `include:`. Literal keys resolve pre-render; `{ ref }`-valued keys resolve post-render against the ContentMap. Strict mode: unknown key = error.

### P3 — Convention `extends:` + `requires:` (specialization & constraints, lite)

```yaml
conventions:
  vehicle:
    extends: product
    type: Vehicle
    fields: { sku: ".sku" }
    requires: [.name, .sku]
```

Single, shallow inheritance: fields merge child-over-parent, transforms chain parent-first. Fallback lives in the graph: `@type: ["Product", "Vehicle"]` — machinery `unionTypes` already implements. Presentation fallback mirrors it (ancestors match conventions). `requires:` turns information typing into `--strict` field checks — DITA's content-model discipline with zero grammar files. Conventions declarable in YAML, not just JS.

### P4 — `if:` / `flag:` + external profiles (ditaval-lite)

Presentation-side conditionality ("who is this rendering for?") — a different axis from `ld_if` ("what does the data imply for the graph?").

```yaml
div: { class: "admin-panel", if: { audience: admin } }
span: { text: "New in 2.0", flag: { audience: novice } }  # kept, gains class flag-novice
```

Profile = reserved render params (`--profile audience=admin`), evaluated before include/params so excluded content never enters the tree (or the graph). Fixed tiny vocabulary: `audience`, `platform`, `product`. Defer until a second deliverable audience exists.

### P5 — Element-level include (`file.yml#id`, conref-lite)

```yaml
footer:
  include: "partials/legal.yml#copyright"
  class: "site-footer"   # local attrs override — today's merge, unchanged
```

Small delta on `includes.js`; combined with keys, gives conkeyref. Push and ranges deferred.

## Tooling patterns (ranked by value/weight)

1. **Normalize-then-emit with a documented intermediate + debug target** (`--emit resolved`). DITA-OT's preprocess/`dita` transtype; mdBook's debug renderer. Formalizes what exists; unlocks debugging, third-party tooling, future targets.
2. **Target registry with inheritance** — `html-doc` extends `html-fragment`, `embed`/`pdf` extend further; typed introspectable params enumerable via CLI and JSON-RPC (transtype pattern).
3. **"Schematron for Twinseed"** — rules-as-data over the *resolved* tree: selector + predicate + message/severity + phase (`author` phase live in dev server, `publish` gating CLI). Lint results as a third live WebSocket panel. Grammar (strict mode) plateaus; rules are where teams actually accumulate governance.
4. **Lifecycle hooks at stage boundaries only** — `preResolve`/`postResolve`/`preEmit`. DITA-OT's own docs warn against internal-step hooks; Asciidoctor's named hooks are the good model.
5. **Language-agnostic filters over the existing JSON-RPC channel** — Pandoc JSON filters / mdBook stdio plugins. Near-zero new infrastructure.

Notable: oXygen 28 added an **AI-friendly output format** — "agents as a publishing target" is literally Twinseed's JSON-LD home turf. LwDITA's adapter pattern (thin parser lifting another syntax into the same tree) is right, but deferred until a second authoring syntax has real demand.

## Anti-goals

Anything requiring a build stage, grammar compilation, or processing-order law is disqualifying — Twinseed's edge is single-pass rendering that re-evaluates live.

- `@class` ancestry strings / generalization machinery — `@type` union in JSON-LD achieves fallback declaratively
- Grammar files: DTD/XSD content models, shells, domains-vs-constraints formal split
- conref push and `conrefend` ranges
- conref validity rules (type lattice)
- DITAVAL as a separate XML filter vocabulary
- Key scopes, cross-deliverable linking (DITA 2.0 is *still* rewriting this in mid-2026)
- `@chunk` attribute zoo, full reltable semantics, bookmap print roles, subjectScheme, learning domains

## Open questions

1. Maps and liveness: fragment change → push whole map re-render or fragment-granular patches?
2. Key override precedence: one decision + one paragraph of docs, not a spec section.
3. Dual-phase `{ key }` (literal pre-render vs ref post-render): acceptable mental overhead?
4. `extends:` when child omits `type`: inherit-and-union (proposed), inherit-only, or replace?
5. `if:` before or after include/params? (Proposed: before — excluded content never asserts into the graph.)
6. Cascade scope: `@context` and `keys:` yes; `head:` no.
7. How loud should typing be? `requires:` as strict error vs warning-only (`TWINSEED_STRICT=2`?).
8. Map graph shape: `CollectionPage`+`hasPart`, `ItemList`+`itemListElement`, or both? Fragment-stable `@id`s for deep-linking?

## Sequencing

1. **P3** (extends/requires) — smallest, hardens the differentiator
2. **P2** (keys) — independent, high ergonomic payoff, unlocks conkeyref
3. **P1** (maps) — biggest conceptual addition, benefits from P2
4. **P5** (#id includes) — most valuable after maps
5. **P4** (if/flag) — when a second audience appears

Tooling companions: resolved-intermediate debug target rides along early; target registry when a third target appears; rules layer after strict mode settles.
