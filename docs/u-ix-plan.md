# u-ix plan

Shell UX for Twinseed — drive the genome from the prompt. Not a second canvas.

**Parity.** PowerShell, bash, and zsh share one status helper and the same metaphor. No shell is an afterthought.

Taste skill was not found under Cursor skills; phase 3 uses Twinseed voice (sparse, paper/ink) and the thrust in `docs/u-ix.md`.

---

## 1 — Prompt / status chrome

Thin session line above the prompt: active seed, profile, strictness, last render, genome dirty when cheap.

- Shared emitter: `shell/status.js` → JSON or one formatted line
- Consumers: `shell/twinseed.psm1`, `shell/twinseed.sh`
- Env is the session: `TWINSEED_SEED`, `TWINSEED_BASEDIR`, `TWINSEED_PROFILE`, `TWINSEED_STRICT`, render stamp
- Enable notes: `shell/README.md`

Done when: enabling the module/script shows Twinseed context without touching the type system.

## 2 — Twinseed-aware completion

Suggest what fits the seed: templates, `--profile` keys, flags, `baseDir`, emit targets — not generic filenames.

- Same completion surface on PS and bash/zsh (scripts or generated specs; one source of verbs)
- Taste as filter: sparse, correct, quiet when unsure

## 3 — Taste pass

Help text, errors, defaults, naming — CLI as hands, genome as truth. Restraint over chrome.

---

Ship phase 1 as a prototype. Completion and taste follow once the chrome earns its keep.
