# Plan 22: `olt/` vs `.olt/` Canonical Namespace & Directory Isolation Guard - Post Analysis

## Overview

This report provides a grounded, evidence-based code and architectural audit of the repository against the goals and deliverables specified in Plan 22.

## Task 1: `NamespaceIsolationGuard` Implementation

- **Implementation Status:** **Missing**
- **Details:** The required guard class `NamespaceIsolationGuard` has not been implemented.
  - **File:** `olt/scripts/src/authority/namespace-isolation-guard.ts` does not exist.
  - **Integration:** There is no integration of `NamespaceIsolationGuard` within the pre-command middleware. A review of `olt/scripts/src/cli/execute.ts` confirms that no namespace isolation enforcement logic has been injected into the command execution lifecycle.
- **Code Gaps:**
  - Need to create `olt/scripts/src/authority/namespace-isolation-guard.ts`.
  - Need to write the unit test `tests/unit/authority/namespace-isolation-guard.test.ts` as outlined in the plan.
  - Need to invoke `NamespaceIsolationGuard.assertValidPath(...)` inside the execution middleware in `olt/scripts/src/cli/execute.ts`.

## Invariant 1: `olt/` vs `.olt/` Decoupling & Resolution

- **Implementation Status:** **Fully Implemented** (At the path resolution level)
- **Details:** The runtime ledgers are strictly mapped to the `.olt/` directory in the path resolution logic.
  - **File:** `olt/scripts/src/core/shared/paths.ts`
  - **Proof:**
    - Line 6: `export const OLT_DIR_NAME = ".olt";` defines the root directory for runtime ledgers.
    - Lines 95-135: Methods like `resolveBacklogPath`, `resolveCompletedTasksPath`, `resolveDefectsPath`, `resolveTelemetryPath`, `resolveMemoryPath`, and `resolveWatchdogsPath` explicitly use `OLT_DIR_NAME` (`".olt"`) to construct paths (e.g., `join(root, OLT_DIR_NAME, OLT_FILES.BACKLOG)`).

## Invariant 2: Prevention of direct state writes to `olt/`

- **Implementation Status:** **Partially Implemented**
- **Details:** While there are no explicit hardcoded paths writing to `olt/` in the codebase, the _mechanical enforcement_ preventing such an action is missing (due to the missing `NamespaceIsolationGuard`).
  - An audit of path usage reveals no commands or scripts currently attempting to write runtime JSON state directly into `olt/`. The `OLT_DIR_NAME` is consistently used.
  - However, because the overarching goal is to _mechanically enforce_ this via the `NamespaceIsolationGuard`, the lack of the guard means the repository relies on convention rather than strict mechanical safety rules.

## Summary of Code Gaps

To fully satisfy Plan 22, the following exact code gaps must be addressed:

1. Create and implement `olt/scripts/src/authority/namespace-isolation-guard.ts`.
2. Add comprehensive unit testing for the guard in `tests/unit/authority/namespace-isolation-guard.test.ts`.
3. Wire the guard into `olt/scripts/src/cli/execute.ts` (or equivalent core pre-command interceptor) to actively block file write operations targeting the `olt/` namespace for runtime artifacts.
