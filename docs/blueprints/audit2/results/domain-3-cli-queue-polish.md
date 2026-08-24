# Domain 3: CLI Briefings & Queue Polish

## 1. Zero-JSON Markdown Enforcement in `task-brief.ts`

- Stripped extraneous raw JSON metadata fields (`run_root`, `task`, `grant`, `briefing`, `agent_briefing`, `exact_anchor_briefing`, `anchors`, `symbols`) from the return payload of `taskBriefCommand`.
- Enforced strict pure Markdown output (`markdown: combinedMarkdown`) avoiding unintentional state metadata leakage via `--format=json`.

## 2. Synchronous & Atomic Queue State Re-indexing

- Wrapped `taskSubmitCommand` (from `task-claim.ts`) and `taskReleaseCommand` (from `diagnostics-ops.ts`) inside `task-ops.ts`.
- Introduced synchronous `writeIndex(run, loaded.state)` executions wrapping the core submit and release handlers.
- Modified `cli/registry/diagnostics.ts` and `cli/commands/index.ts` to export explicitly and correctly link the wrapper functions to the CLI entrypoints.
- This ensures that queue state indexing updates (`index.json`) remain atomic and synchronous with state ledger mutation via `task:release` or `task:submit`.

## 3. DAG Views Line Limits

- Fixed `dag-view.ts` where `enforceLineLimit` incorrectly used `80`.
- Ensured that `enforceLineLimit(fullMarkdown, 30)` is applied strictly in line with the terminal output policies, mirroring behavior in `dag.ts`.

## 4. TypeScript Strictness

- `bun run typecheck` run verified strict null safety, 0 `any`s and 0 `@ts-ignore` overrides.
- Export re-declarations fixed.
