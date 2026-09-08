---
description: File structure, modularity line limits, fanout budgets, and facade architecture rules
globs:
  - "**/*.ts"
  - "**/*.tsx"
alwaysApply: true
---

# File Structure & Modularity Invariants

- Maximum 400 physical lines per source file. Codebase authority: `scripts/modularity/inventory/physical-lines.ts:LINE_LIMIT`.
- Maximum 10 direct .ts/.tsx files per directory (fanout limit), `index.ts` included with no exemption. Codebase authority: `scripts/modularity/inventory/fanout.ts:FANOUT_LIMIT`.
- Explicit Named Facade Invariant: Every TypeScript directory must expose an explicit `index.ts` facade containing named exports. Wildcard exports (`export * from ...`) are strictly prohibited.
- Zero Facade Bypass Invariant: Cross-directory imports must strictly target destination `index.ts` facades (e.g. `import { foo } from "../policy/index.ts"`), never reaching across directory boundaries to private internal submodule paths.
- Semantic Naming: Split files and folders must be named semantically for their responsibility, never with partition numbers (`part1`, `utils-2`).
