# Runtime Capsule Lifecycle

## Overview

This document traces the initialization and lifecycle management of capsules within the `olt` runtime system.

## Unconstrained Finding Count

**Total Findings:** 3

## Step-by-Step Disk Mutation Trace (engine/store/capsule.ts)

1. **Validation**: Validate run_id, capture mode, and source bytes.
2. **Directory Creation**: Creates capsules root if it does not exist using `mkdirSync` with mode 0755. Calls `fsyncDirectory(repoRoot)`.
3. **Run Root Creation**: Creates specific `run_id` directory under capsules root. Calls `fsyncDirectory(capsulesRoot)`.
4. **Layout Scaffolding**: Iterates through `initialCapsuleDirectories` and creates them.
5. **Initial Files**:
   - `prompt.md` is written atomically.
   - Optional `runtime/` pinning.
   - `manifest.json` written atomically.
   - `events.jsonl` written atomically as an empty file.
   - `state.json` written atomically using `initialState`.
   - `README.md` written atomically.
6. **Failure Cleanup**: On failure during scaffolding, uses `rmSync(runRoot, { recursive: true, force: true })` and throws error.

## Concurrency and Lock Queue Mechanics

- Writes use `atomicWriteBytes` and `atomicWriteJson` which use a swap-file and atomic `renameSync` to guarantee no partial writes.
- `fsyncDirectory` ensures directory dentries are synced to disk, mitigating power-loss partial state.

## Assessment

The `initRun` function enforces safe disk initialization. Atomic operations are strictly adhered to. The fallback cleanup mechanism avoids leaving orphaned directories.
