# HN post draft — Show HN: Verso

Working draft. Delete before posting or keep for the archive; do not link from the README.

## Title (pick one)

1. `Show HN: Verso – YAML that renders HTML and publishes JSON-LD from the same tree`
2. `Show HN: Verso – a markup language where the page and its linked data are one tree`
3. `Show HN: Verso – the other side of the page is meaning`

Recommendation: **#1** — concrete, says what it does, no poetry tax. #3 is the brand line; save it for the first comment.

## Post body (if text post) or first comment (if link post)

> Verso is a small YAML-based markup language where one tree renders to HTML for browsers and JSON-LD for the Semantic Web — the two projections can never drift, because they're derived from the same structure.
>
> The problem: most pages maintain what humans see and what machines read as separate artifacts (HTML here, Schema.org blob there). They drift. Verso treats the presentational tree and the knowledge graph as two faces of one leaf — in bookbinding, *verso* is the other side of the page.
>
> How the graph stays honest:
>
> - **Reactive refs** — `name: { ref: "#item_1 .name" }` pulls the assertion from the rendered text itself
> - **Conditional typing** — `ld_if` changes the entity's `@type` based on actual content values (e.g. price thresholds)
> - **Conventions** — a class like `product` auto-asserts a typed entity from its children; `extends:` builds new vocabularies by inheritance
> - **Maps, keys, profiles** — composition documents, late-bound indirection, and audience filtering, ideas borrowed from DITA (research doc in the repo)
> - **Live sync** — JSON-RPC + WebSockets re-render fragments and push HTML *and* graph together when state changes
>
> Try it in a minute:
>
> ```
> npm i && npm start   # → localhost:3847
> ```
>
> The reading room (/live/) has a two-pane editor where the left page is your YAML manuscript and the right book sets itself — presentation on the recto, JSON-LD on the verso. Open the same link in two windows and type; both update.
>
> Honest boundaries: this is a working prototype, not a React replacement and not a CMS. It fits entity-shaped pages (docs, datasets, profiles, catalogs) where the page *is* a set of claims. Node 18+, MIT, three runtime deps.

## The example (paste under the comment, ~12 lines)

```yaml
"@context": "https://schema.org"

product:                      # convention: a typed entity, no ld: block needed
  id: "mug_1"
  ld_if:                      # the graph reads the page's own values
    condition: { ref: "#mug_1 .price", operator: "<", value: 100 }
    then: { "@type": BudgetProduct }
    else: { "@type": PremiumProduct }
  children:
    - h1: { class: "name", text: "Travel Mug" }
    - span: { class: "price", text: "79.00" }
```

One YAML tree renders the card as HTML and asserts `Product` (fields harvested from the classes) merged with `BudgetProduct` — change 79.00 to 129.00 and the graph changes its mind.

## Anticipated comments — pre-loaded replies

**"Why not JSX / MDX / Astro?"**
You'd wire Schema.org by hand in all of them. Verso's difference is that linked data is first-class: refs bind assertions to rendered text, conditionals read the content map, conventions map classes to vocabulary types. It's closer to "Pug with a semantic layer" than to a framework.

**"YAML for markup? Whitespace sensitivity, really?"**
Fair. It's for structure-shaped documents — entity cards, docs, publications — not freeform prose. Prose goes in block scalars (`|`). The tree shape is the feature: indentation *is* the hierarchy.

**"JSON-LD is just SEO plumbing."**
Schema.org is one `@context`; swap in your own vocabulary. The point isn't rich results — it's that the machine-readable claim and the human-readable page are the same fact. Crawlers, agents, and datasets all read the graph; Google is just the loudest consumer.

**"The Semantic Web is dead."**
Its tooling says otherwise in 2026 — structured-data editors now ship AI-friendly output formats, and agents are the fastest-growing consumers of machine-readable pages. Verso's bet: the audience for the graph is growing, and it deserves better than a blob nobody maintains.

**"Live sync is a framework's job."**
Agreed — Verso is deliberately a fragment/entity renderer with a sync channel, not an app shell. It plugs into a page rather than owning it.

**"DITA? Really?"**
The OASIS committee's own lightweight variant (LwDITA) kept typed topics, maps, conref, and keys — and dropped the machinery. Verso takes the same five ideas as data in the tree, never as a build pipeline. There's a research doc in the repo (`docs/dita-research.md`) with the anti-goal list.

## Posting notes

- Weekday morning US time; be online for the first hour, replies matter more than the title
- Lead with the example, not the feature list
- If it doesn't catch: same comment, trimmed, to r/webdev and the usual Discords — the two-window editor is the thing people will remember
