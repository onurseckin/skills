# Gate Prove & Terminal Run Sealing

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 09](./index.md) > 09-04 Gate Prove & Sealing

---

[⏮️ Previous: 09-03 APCA Perceptual Contrast Mathematics](09-03-apca-perceptual-contrast-mathematics.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: Chapter 10: Durability, Recovery & Merkle Chains](../10-durability-recovery-capsules/index.md)
---

## 1. `gate:prove` Mutation Testing

Before a run can complete, `bun harness.ts gate:prove` executes mutation assertions:

- Injects intentional syntax or logic mutations into temporary test runs.
- Verifies that the test suite actually catches the regression (killing mutants).
- Proves tests are non-tautological.

---

## 2. Terminal Run Sealing (`run:complete`)

Once all evidence gates pass:

1. `manifest.json` is updated to status `completed`.
2. The final Merkle root hash is committed.
3. All ephemeral worktrees and locks are destroyed.

---

[⏮️ Previous: 09-03 APCA Perceptual Contrast Mathematics](09-03-apca-perceptual-contrast-mathematics.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: Chapter 10: Durability, Recovery & Merkle Chains](../10-durability-recovery-capsules/index.md)
---
