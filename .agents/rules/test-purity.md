---
description: Test purity guardrails enforcing in-memory VirtualMemoryFS, zero real filesystem mutation, and leak containment
globs:
  - "**/*.test.ts"
  - "**/*.spec.ts"
alwaysApply: false
---

# Test Purity Guardrails & Isolation Invariants

## Core Invariants

- VirtualMemoryFS Requirement: Tests must operate strictly in-memory using virtual filesystem fixtures (`VirtualMemoryFS`), never mutating the real repository filesystem.
- Zero Real Filesystem Mutation: Mutating fs calls (`writeFileSync`, `mkdirSync`, `unlinkSync`, `appendFileSync`, etc.) on real repository paths are forbidden during test execution.
- Fail-Closed Interception: Interceptor spies must fail closed and throw `[VFS_SAFETY]` errors whenever an unhandled mutating operation targets non-virtual paths.
- Principled Containment Exception: Real filesystem interactions are allowed ONLY for containment auditors whose express purpose is policing the real filesystem, provided they are declared with an explicit human reason in the purity baseline (`index.jsonl`).
- Zero Leaked Resources: Tests must restore all global mocks/spies in `afterEach` hooks.

---

## 1. VirtualMemoryFS Requirement

All unit and integration tests requiring filesystem access must operate strictly in-memory using virtual filesystem fixtures (`VirtualMemoryFS`) rather than touching the physical disk.

- Tests instantiate a fresh in-memory filesystem (e.g., `VirtualMemoryFS` or `createVirtualFSSession()`) to maintain complete hermetic isolation across test runs.
- In-memory structures provide fast, deterministic test outcomes without creating disk artifacts, workspace churn, or race conditions during parallel test runs.
- Operating against memory fixtures guarantees that no temporary files or mock fixtures leak into the repository tree.

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("hermetic component unit test", () => {
  let vfs: VirtualMemoryFS;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
  });

  afterEach(() => {
    vfs.reset();
  });

  it("reads and writes within virtual memory only", () => {
    vfs.writeFileSync("/virtual/spec.json", JSON.stringify({ ok: true }));
    expect(vfs.existsSync("/virtual/spec.json")).toBe(true);
    expect(vfs.readFileSync("/virtual/spec.json", "utf-8")).toContain("true");
  });
});
```

---

## 2. Zero Real Filesystem Mutation

Mutating filesystem calls on real repository paths are strictly forbidden during test execution.

- **Forbidden Calls**: `writeFileSync`, `mkdirSync`, `unlinkSync`, `appendFileSync`, `rmdirSync`, `rmSync`, `copyFileSync`, `truncateSync`, and their asynchronous or promises counterparts (`fs.promises.*`).
- **Forbidden Targets**: Any real directory, including repository source directories, fixtures directories, system temp directories, or user home directories.
- **Rationale**: Direct disk mutations cause cross-test pollution, intermittent CI test failures, git working tree contamination, and race conditions during concurrent test executions.

---

## 3. Fail-Closed Interception & `[VFS_SAFETY]`

All mocked or spied filesystem operations must fail closed on unintercepted or unauthorized mutating calls.

- Interceptors and spies wrapping Node.js `fs` or `node:fs/promises` must inspect destination paths before any mutating operation.
- If a mutating operation targets a non-virtual or disallowed path, the interceptor must throw a fatal error prefixed with `[VFS_SAFETY]` rather than silently allowing the mutation to reach the disk.
- Never install passive or silent mocks that let unintended mutations fall through to the real filesystem.

```typescript
export function assertVirtualSafety(targetPath: string): void {
  if (!targetPath.startsWith("/virtual/") && !targetPath.startsWith("vfs://")) {
    throw new Error(
      `[VFS_SAFETY] Forbidden real filesystem mutation intercepted at path: ${targetPath}`,
    );
  }
}
```

---

## 4. Principled Containment Exception

Real filesystem interactions are allowed **ONLY** for containment auditors whose express purpose is policing the real filesystem.

- **Auditor Definition**: Containment tools, repository policy validators, and baseline verifiers that inspect static structure or verify workspace boundaries.
- **Baseline Declaration**: Every exception must be declared with an explicit human reason in the purity baseline (`index.jsonl`).
- **Audit Review**: Unregistered real filesystem access in test suites will fail the purity ratchet and pre-commit checks.
- **Read-Only by Default**: Even containment auditors must default to read-only traversal. If temporary files are unavoidable during subprocess or sandbox verification, they must be strictly contained and cleaned up.

---

## 5. Zero Leaked Resources & Teardown

Tests must maintain clean boundaries and leave zero residual state after completion.

- **Teardown Hooks**: Tests must restore all global mocks, spies, and environment stubs in `afterEach` or `afterAll` hooks.
- **Zero Leaked Temp Directories**: Any temporary directory created during permitted containment or sandbox tests must be registered for cleanup and deleted in teardown hooks.
- **Process Isolation**: Spurious subprocesses, child workers, and persistent file descriptors must be closed and verified before completing test suites.
