# s-ia — system information architecture

Type system / IA so Twinseed genotypes and linked-data shapes can exploit PlantUML’s JSON diagram vocabulary — not just dump JSON into `@startjson`.

## Thrust

- **New type family.** Types suggested by PlantUML’s JSON diagram page: nodes, highlights, separators, arrows, and whatever else the vocabulary names as first-class diagrammatic moves — mirrored as Twinseed genotype / linked-data shapes.
- **Diagram as expression.** Goal: take full advantage of that vocabulary’s illustrative power. Genotype → diagram should read as structured assertion, not a pretty print of the same blob.
- **IA before chrome.** Enrich the type layer so richer diagrams fall out of honest structure; skinparams stay presentation, types carry meaning.

## Registered (highlight family)

Vocab: [`/ia/schema.jsonld`](../ia/schema.jsonld) —

- `DiagramHighlight`, `highlightPath`, `HighlightRole` (+ seeds `Focus`, `Warning`, `StatusOk`, `StatusBad`)
- `DiagramFocusSet` + `highlights` / root `diagramFocus`
- Wildcard path segment `"*"` on `highlightPath` (Twinseed fans out to concrete `#highlight` lines)

Emitter: `src/server/diagram.js` strips IA annotation nodes, expands wildcards against the body, emits `#highlight … <<Role>>`, keeps the paper/ink theme.

Exemplar: [`exemplar/templates/diagram-focus.skel.yml`](../exemplar/templates/diagram-focus.skel.yml). Nominations / rationale: [`s-ia-type-nominations.md`](./s-ia-type-nominations.md).
