# Architectural Audit: Core Storage Paths & OLT

## Target File(s)
- `core/paths.ts`
- `core/durable-write.ts`
- `core/runtime-tree.ts`

## Things to Look For Count
1. Safe Path Resolution (`safeRepoPath`)
2. Root Escaping & Symlink Defenses
3. Atomic File Writes
4. Directory Fsync Patterns

## What's Happening Here
Storage relies heavily on strictly validated relative boundaries to protect the host machine.
1. **Path Safety Guard:** `safeRepoPath` ensures NO absolute paths, NO parent traversals (`..`), and NO symbolic links are allowed. This strictly confines agent operations inside the designated repo root.
2. **Durable Writes:** `atomicWriteJson` and `atomicWriteBytes` use `renameSync` under the hood. They write to a `.tmp` file and atomically rename it, avoiding partial writes if the OS crashes.
3. **No Follows:** Functions strictly use `lstatSync` instead of `statSync` to explicitly throw errors if symbolic paths are detected.

## LLM Friction Points & Implicit Assumptions
- **Strict Absolute Paths Ban:** If an LLM uses absolute paths inside commands (`safeRepoPath` checks), it results in a fast `PATH_SAFETY` crash. This is a common pitfall when subagents attempt to build absolute URI structures.
- **Symlink Allergic:** Modern monorepos heavily use symlinks (e.g. `pnpm`, `bun`). If an agent attempts to target a symlinked workspace package, `safeRepoPath` will block it violently.

## Concrete Simplification & Improvement Blueprint
1. **Symlink Grace Period:** Expose a safe boundary configuration for controlled symlink resolution, specifically for module `node_modules` resolving in `bun` monorepos.
2. **Streamlined Temporaries:** Manage atomic `.tmp` files in a centralized dedicated `/tmp` or `.olt/scratch` directory, rather than cluttering sibling directories during writes.
3. **Asynchronous Paths:** Evolve `lstatSync` path validation to asynchronous `lstat` buffers for deep hierarchical path traversals, improving initialization metrics.
