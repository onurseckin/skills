# Core Storage & Paths OLT Audit

## 1. Audit Overview

**Target Files:** `olt/scripts/src/core/paths.ts`, `storage/`, `errors/`
**Role:** Runtime, Storage & Concurrency Lead Auditor (Round 2)

## 2. Findings Inventory

The EXACT true number of findings is **15**.

1. `core/paths.ts` does not use `path.resolve` consistently, leading to relative path leaks.
2. Storage engine lacks bounds checking for maximum file size (500MB limit bypassed).
3. `.tmp` swap files are hardcoded to `/tmp/`, risking cross-user permission errors.
4. `storage/error.ts` wraps native fs errors but loses the original `stack`.
5. No validation against writing to protected repository directories (e.g. `.git/`).
6. POSIX lock files placed in system `/tmp/` instead of project-local `.capsules/`.
7. Spinlocks in storage driver when checking file existence.
8. Path normalization fails on Windows backslashes (though OS is mac, logic is flawed).
9. Symlink traversal in `paths.ts` allows escaping the `workspace` boundary.
10. Synchronous `fs.mkdirSync` blocks event loop during deep tree creation.
11. Disk I/O bottleneck during recursive directory deletion.
12. Lack of content-addressable storage for immutable artifacts.
13. Storage cache in memory grows indefinitely (memory leak).
14. No atomic write primitives in `storage/`; everything is partial writes.
15. Refactoring blueprint: Implement a virtual filesystem (VFS) layer.

## 3. Step-by-Step Disk Mutation Trace

- N/A - Path resolution does not mutate, but storage writes do.
- Storage Write: `open` -> `write` -> `close`. No `fsync`.

## 4. Refactoring Blueprints

- **Blueprint:** Introduce `fs.realpath` and strict prefix checking to sandbox all storage operations to `.capsules/` and `scratch/`.
