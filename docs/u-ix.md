# u-ix — user interaction experience

How humans *drive* Twinseed: shell UX, completion, and prompt chrome — not the type system itself.

## Thrust

- **Taste × Twinseed completion.** Bring Cursor’s taste skill into the CLI: completions that know Twinseed’s verbs, paths, and shapes the way clink / yori / init-rc know their shells — suggest what fits the seed, not generic filenames.
- **Prompt enrichment.** PowerShell (and statusline-like) chrome that surfaces session context above the prompt: cwd, worktree, active seed, maybe genotype glance — patterned after Cursor’s statusline (command + JSON stdin → short line out).
- **Drive, don’t decorate.** Every affordance should shorten the path from intent → twinseed action. Completion and prompt chrome are the hands; the genome stays the source of truth.
