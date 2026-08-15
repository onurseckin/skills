# 02. Write Scopes & Directory Containment Invariants

[⬅ Previous: Leasing & Heartbeats](./01-leasing-and-heartbeats.md) | [Master Table of Contents](../README.md) | [Next: Submission & Evidence Collection ➡](./03-submission-and-evidence-collection.md)

---

## 🛑 The Principle of Strict Write Containment

In multi-agent systems, "scope creep" often takes the form of uncoordinated file modifications:

- An implementer fixing an authentication bug decides to "clean up formatting" in `src/utils/logger.ts`.
- Another implementer concurrently refactors `src/utils/logger.ts`.
- A git conflict occurs, or one agent silently clobbers the other's changes.

To eliminate this class of bugs entirely, the harness enforces the **Write Scope Containment Invariant**:

> **An agent holding a task lease is strictly forbidden from creating, modifying, formatting, or deleting any file located outside its leased `write_scope`.**

---

## 🔍 Path Normalization & Ancestor Validation

During plan validation (`validate`) and submission validation (`submit`), write scopes are strictly normalized:

1. **No Relative Traversal:** Paths with `.` or `..` components are resolved and normalized relative to repository root.
2. **Normalized Prefix Matching:** A modified file path $F$ belongs to scope $S$ if and only if:
   - $F == S$ (Exact file match), or
   - $F$ starts with $S + \text{"/"}$ (Directory containment).
3. **Quarantine on Boundary Breach:** If `files_changed` in a submission report contains even one file outside the leased write scope, the submission is **instantly rejected with `WRITE_SCOPE_VIOLATION`**.

```text
Task Leased Write Scope: ["orchestrating-long-tasks/docs/05-task-execution"]

Valid File Modifications:
  ✅ orchestrating-long-tasks/docs/05-task-execution/01-leasing.md
  ✅ orchestrating-long-tasks/docs/05-task-execution/02-scopes.md

Invalid File Modifications (Rejected with Error):
  ❌ orchestrating-long-tasks/docs/01-foundations/01-why.md  [Out of scope]
  ❌ orchestrating-long-tasks/package.json                   [Out of scope]
  ❌ tests/execution/suite.test.ts                           [Out of scope]
```

---

## 📂 Shared Files & Monolithic Configurations

What if multiple tasks need to add exports to a shared `index.ts` or package manifest?

- **Pattern:** Create a dedicated integration task downstream whose write scope is `["src/index.ts"]` or `["package.json"]`.
- **Ordering:** The integration task declares `depends_on: [task-A, task-B]`. It runs only after both parallel workers have finished, merging the exports deterministically without races!

---

[⬅ Previous: Leasing & Heartbeats](./01-leasing-and-heartbeats.md) | [Master Table of Contents](../README.md) | [Next: Submission & Evidence Collection ➡](./03-submission-and-evidence-collection.md)
