# Runtime State Machine Transitions

## Overview

This document outlines the state transitions and ledger appending behavior implemented in `StateMachine` and `StateLedger`.

## Unconstrained Finding Count

**Total Findings:** 2

## Step-by-Step Disk Mutation Trace

1. **StateMachine Transition (`runtime/state-machine.ts`)**:
   - Creates a temporary file `{path}.tmp`.
   - Serializes the new state wrapped in a JSON object.
   - Synchronously writes to the temporary file using `writeFileSync`.
   - Atomically renames the temporary file to `{path}`.
2. **StateLedger Append (`engine/state-ledger.ts`)**:
   - Pushes new state to in-memory `cache`.
   - Reads the current full state array from disk.
   - Appends the new state.
   - Writes to `{path}.tmp` and renames to `{path}` synchronously.

## Concurrency and Lock Queue Mechanics

- Writes rely entirely on POSIX `renameSync` for atomic file updates.
- There is no file-level POSIX advisory lock on the state ledger or state machine, implying that external coordination (like `AsyncLock`) is assumed to prevent concurrent writers.
- Reading the state handles missing files safely by catching errors or checking `existsSync`.

## Assessment

The transition logic correctly utilizes the `.tmp` swap-file pattern for atomic persistence. The `StateLedger` is not suitable for high-throughput multi-process environments without an explicit locking mechanism, but is safe under single-writer assumptions.
