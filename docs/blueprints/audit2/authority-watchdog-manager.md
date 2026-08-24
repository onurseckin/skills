# Authority: Watchdog Manager Audit

## Exact Unconstrained Finding Count
- **Findings**: 0 (Verified Clean Status)
- Fixes verified: stale session pruning mechanism exists via file updates.

## Comprehensive Call Graph & State Transition Trace
- **Entry Points**: `registerWatchdog`, `heartbeatWatchdog`, `terminateWatchdog`
- **Call Graph**:
  1. Initializes via `registerWatchdog`, writes to `watchdogs.json`.
  2. Periodic pulses trigger `heartbeatWatchdog`, updating `last_heartbeat_at`.
  3. `terminateWatchdog` clears active run upon graceful exit.
- **State Transition Trace**:
  - State moves from `active` -> `active` (on heartbeat) -> `null` (on terminate).
  - Handles legacy `version: 1` stores by overriding with a fresh `version: 2` default state.

## Native Host Tool Interaction Details
- Interfaces with the filesystem, managing `watchdogs.json` utilizing `atomicWriteJson`. Does not call `schedule` or `manage_subagents` directly; it provides the state schema for external schedulers.

## Current Live Code Verification Assessment
- Reliable locking and timeout tracking. Gracefully manages file persistence issues.
