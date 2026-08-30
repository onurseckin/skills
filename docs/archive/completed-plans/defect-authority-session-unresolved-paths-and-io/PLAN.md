# Defect Remediation: Authority Session Unresolved Paths and I/O

## Charter

Fix unresolved import `./paths-and-io.ts` in `authority/session/index.ts`, enforce root directory hygiene rules for capsule locations, and maintain strict invariants: zero comments, zero `any`, $\le 300$ LOC/file, $\le 10$ files/directory, named facades, and file-scoped unit testing.

## Summary of Changes

1. **Canonical Module Hierarchy**:
   - Ensured `authority/session/index.ts` exports exclusively from modular canonical endpoints (`./paths.ts`, `./io.ts`, `./grants.ts`, `./resolver.ts`, `./testing-hooks.ts`, `./types.ts`), eliminating dangling or ambiguous imports.
2. **Root Hygiene Purity**:
   - Removed `.capsules` from root directory allowlist in `authority/guards/constants.ts` to strictly enforce that all capsule runs reside under `.olt/capsules/` rather than in loose top-level directories.
3. **AST Purity & Quality Invariants**:
   - Zero comments across production `.ts` files.
   - Zero `any` types.
   - Verified all files $\le 300$ LOC (`paths.ts`: 114, `io.ts`: 288, `grants.ts`: 263, `resolver.ts`: 287, `testing-hooks.ts`: 27, `types.ts`: 58, `index.ts`: 55, `root-hygiene.ts`: 55, `constants.ts`: 36).
   - Directory density $\le 10$ files per directory (`authority/session`: 7 files, `authority/guards`: 6 files).
4. **Adversarial Validation**:
   - Successfully cleared all 5 rounds of adversarial review with `validator_06` (Product Intent, Modularity & Density, AST Purity, Test Coverage & Edge Cases, Holistic Verification).
   - 379 unit tests passing across 16 authority test files (0 failures).
   - Full TypeScript compilation passes with 0 errors (`tsc --noEmit`).
