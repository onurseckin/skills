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
- Zero Circular Dependencies (DAG Invariant): Import graphs must form a strict Directed Acyclic Graph (DAG). Strongly Connected Component (SCC) dependency cycles between files or directories are strictly prohibited. Codebase authority: `scripts/modularity/inventory/cycles.ts:MAX_SCC_SIZE`.
- Explicit Named Facade Invariant: Every TypeScript directory must expose an explicit `index.ts` facade containing named exports. Wildcard exports (`export * from ...`) are strictly prohibited.
- Zero Facade Bypass Invariant: Cross-directory imports must strictly target destination `index.ts` facades (e.g. `import { foo } from "../policy/index.ts"`), never reaching across directory boundaries to private internal submodule paths.
- Semantic Naming: Split files and folders must be named semantically for their responsibility, never with partition numbers (`part1`, `utils-2`).
- Zero Backwards-Compatibility Shims: When refactoring or modularizing, never create or leave behind backwards-compatibility shims, forwarding files, or dead aliases; update all call sites and import paths directly.
- Pre-Completion Modularity Ratchet Verification: Every implementer and validator modifying code must verify changes against `bun run modularity:staged` (or `bun run modularity:check`) before marking any task complete, releasing leases, or committing.
