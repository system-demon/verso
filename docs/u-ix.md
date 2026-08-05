# u-ix — user interaction experience

How humans *drive* Twinseed: shell UX, completion, and prompt chrome — not the type system itself.

## Thrust

- **Taste × Twinseed completion.** Completions that know Twinseed’s verbs, paths, and shapes the way clink / yori / init-rc know their shells — suggest what fits the seed, not generic filenames.
- **Prompt enrichment.** Statusline-like chrome that surfaces session context above the prompt: active seed, profile, strictness, last render / genome dirty — patterned after Cursor’s statusline (command → short line out). **PowerShell, bash, and zsh** share one helper; none is secondary.
- **Drive, don’t decorate.** Every affordance should shorten the path from intent → twinseed action. Completion and prompt chrome are the hands; the genome stays the source of truth.

## Plan

Phased work: [u-ix-plan.md](u-ix-plan.md).

## Prototype

Prompt chrome and Twinseed-aware completion live under [`shell/`](../shell/README.md). The CLI speaks the same restraint: seed as truth, sparse help (`--help`), quiet errors.

```powershell
# PowerShell
Import-Module .\shell\twinseed.psm1 -DisableNameChecking
Enable-TwinseedPrompt
# Tab: Use-TwinseedSeed, Set-TwinseedProfile, Invoke-TwinseedRender …
```

```bash
# bash or zsh
source ./shell/twinseed.sh
twinseed-prompt on
# Tab: twinseed-use, twinseed-profile, twinseed-render …
```
