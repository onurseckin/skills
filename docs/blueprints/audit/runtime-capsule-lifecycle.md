# Architectural Audit: Runtime Capsule Lifecycle

## Target File(s)
- `engine/store/capsule.ts`
- `core/contracts/capsule.ts`

## Things to Look For Count
1. Capsule Initialization (`initRun`)
2. State & Manifest Bootstrapping
3. File Layout Configuration (`manifest.json`, `events.jsonl`, `state.json`)
4. Directory Integrity & FSyncs

## What's Happening Here
Capsules act as atomic operational contexts initialized via `initRun` within the `.olt/capsules/<run_id>` directory. 
1. **Validation & Modes:** Validates the `runId`, `captureMode`, and prompt payloads. Determines behavior via `CapsuleMode` (`feature` or `mind`).
2. **Scaffolding:** Synchronously creates the necessary directories (`manifest.json`, `events.jsonl`, `state.json`, `prompt.md`).
3. **Durability:** Utilizes `fsyncDirectory` and `atomicWriteJson`/`atomicWriteBytes` aggressively. It ensures power-loss protection and state durability before yielding control to the orchestrator.
4. **Pinning:** Optionally pins the executing runtime source natively inside the capsule, guaranteeing reproducibility.

## LLM Friction Points & Implicit Assumptions
- **Strict Byte Requirements:** `prompt` must be a raw `Uint8Array`. Subagents providing JSON or string configurations directly to the init functions will crash.
- **Mode Contracts:** It inherently trusts the caller passes a valid `isCaptureMode(captureMode)` flag.
- **FSync Bottleneck:** Continuous POSIX `fsync` across directories generates notable latency which can look like a hanging process in isolated VMs.

## Concrete Simplification & Improvement Blueprint
1. **Virtual Capsules:** For ephemeral planning or `mind` discovery phases, allow in-memory / virtual capsule layouts to bypass the heavy `fsyncDirectory` calls.
2. **Asynchronous Pinning:** Decouple the runtime pinning. Perform symlinking in lightweight nodes, saving disk IO.
3. **State Factory Cleanup:** Consolidate `initialState` generation and `writeIndex` into a unified builder pattern.
