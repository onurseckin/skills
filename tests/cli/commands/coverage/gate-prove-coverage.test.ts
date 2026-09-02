import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { gateProveCommand } from "../../../../olt/scripts/src/cli/commands/gate-prove.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import * as gateProofModule from "../../../../olt/scripts/src/graph/gate-proof.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../fixtures/task-ops-fixture.ts";

const roots: string[] = [];
const spies: Array<{ mockRestore: () => void }> = [];

describe("gate:prove CLI Command Coverage Suite", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(async () => {
    for (const s of spies.splice(0)) s.mockRestore();
    await cleanupRoots(roots);
    cleanupVirtualCliFS();
  });

  test("validates required flags, missing tasks, missing gates, and empty write scope", async () => {
    const { run } = await setupCompiledRun("gate-val", roots);

    expect(() => gateProveCommand({ run: "", task: "task-core", actor: "tester" })).toThrow();
    expect(() => gateProveCommand({ run, task: "unknown-task", actor: "tester" })).toThrow(
      /unknown task unknown-task/,
    );

    // 1. Missing compiled gate
    transact(run, "coordinator", "corrupt-task-gate", {}, (draft) => {
      if (Array.isArray(draft.gates)) {
        draft.gates = [];
      }
      if (
        draft.graph &&
        typeof draft.graph === "object" &&
        Array.isArray((draft.graph as { gates?: unknown[] }).gates)
      ) {
        (draft.graph as { gates: unknown[] }).gates = [];
      }
    });

    expect(() => gateProveCommand({ run, task: "task-core", actor: "tester" })).toThrow(
      /no compiled task-scope gate to prove/,
    );

    // 2. Empty write scope
    transact(run, "coordinator", "empty-write-scope", {}, (draft) => {
      draft.gates = [{ id: "gate-core", scope: "task", command: "bun gate-core.ts" }];
      const tasks = draft.tasks as Record<string, { write_scope?: string[] }>;
      if (tasks["task-core"]) {
        tasks["task-core"].write_scope = [];
      }
    });

    expect(() => gateProveCommand({ run, task: "task-core", actor: "tester" })).toThrow(
      /no write scope to revert/,
    );
  });

  test("rejects weak gate command policy at execution time", async () => {
    const { run } = await setupCompiledRun("gate-weak", roots);

    transact(run, "coordinator", "weak-gate", {}, (draft) => {
      draft.gates = [{ id: "gate-core", scope: "task", command: "true" }];
    });

    expect(() => gateProveCommand({ run, task: "task-core", actor: "tester" })).toThrow(
      /fails the gate-command-policy re-check/,
    );
  });

  test("handles claimed_base_sha variations across state tasks and attempts", async () => {
    const { run } = await setupCompiledRun("gate-sha", roots);

    transact(run, "coordinator", "set-claimed-sha", {}, (draft) => {
      const tasks = draft.tasks as Record<string, { attempts?: unknown[] }>;
      if (tasks["task-core"]) {
        tasks["task-core"].attempts = [
          null,
          { claimed_base_sha: { value: "sha-attempt-1", evidence_class: "harness_observed" } },
        ];
      }
    });

    const spy = spyOn(gateProofModule, "proveGateFalsifiable").mockReturnValue({
      outcome: "falsifiable",
      falsifiable: true,
      base: "sha-attempt-1",
      exitCode: 1,
      timedOut: false,
      restoredPaths: ["tests/core/a.ts"],
      deletedPaths: [],
      revertedScope: ["tests/core"],
      copiedFileCount: 2,
      durationMs: 15,
      stdoutTail: "",
      stderrTail: "",
    });
    spies.push(spy);

    const res = gateProveCommand({
      run,
      task: "task-core",
      actor: "tester",
      "timeout-ms": 2000,
      "max-files": 50,
    });

    expect(res.outcome).toBe("falsifiable");
    expect(res.base).toBe("sha-attempt-1");
    expect(res.falsifiable).toBe(true);
    expect(res.markdown).toContain("**PROVEN FALSIFIABLE**");
    expect(res.markdown).toContain("Prior proof**: none recorded for this exact gate");
  });

  test("renders verdict and drift markdown for timeouts, refusals, and regression transitions", async () => {
    const { run } = await setupCompiledRun("gate-drift", roots);

    // 1. Refused absent at base outcome
    const spy = spyOn(gateProofModule, "proveGateFalsifiable");
    spies.push(spy);

    spy.mockReturnValue({
      outcome: "refused_absent_at_base",
      falsifiable: false,
      base: "main",
      exitCode: null,
      timedOut: false,
      restoredPaths: [],
      deletedPaths: [],
      revertedScope: [],
      copiedFileCount: 0,
      durationMs: 5,
      stdoutTail: "",
      stderrTail: "",
    });

    const res1 = gateProveCommand({
      run,
      task: "task-core",
      actor: "tester",
      base: "main",
    });

    expect(res1.outcome).toBe("refused_absent_at_base");
    expect(res1.markdown).toContain("**REFUSED**");
    expect(res1.markdown).toContain("has no representation at `main`");

    // 2. Unchanged prior proof with legacy record lacking outcome property
    transact(run, "coordinator", "corrupt-prior-outcome", {}, (draft) => {
      const proofs = draft.gate_proofs as Array<Record<string, unknown>>;
      if (proofs && proofs.length > 0) {
        delete proofs[0]!.outcome;
        proofs[0]!.falsifiable = false;
      }
    });

    spy.mockReturnValue({
      outcome: "not_falsifiable",
      falsifiable: false,
      base: "main",
      exitCode: 0,
      timedOut: false,
      restoredPaths: [],
      deletedPaths: [],
      revertedScope: ["tests/core"],
      copiedFileCount: 1,
      durationMs: 10,
      stdoutTail: "",
      stderrTail: "",
    });

    const res2 = gateProveCommand({
      run,
      task: "task-core",
      actor: "tester",
    });

    expect(res2.outcome).toBe("not_falsifiable");
    expect(res2.markdown).toContain("**NOT FALSIFIABLE**");
    expect(res2.markdown).toContain("unchanged — also not falsifiable");

    // 3. Regressed prior proof transition and timedOut verdict
    spy.mockReturnValue({
      outcome: "not_falsifiable",
      falsifiable: false,
      base: "main",
      exitCode: null,
      timedOut: true,
      restoredPaths: [],
      deletedPaths: [],
      revertedScope: ["tests/core"],
      copiedFileCount: 1,
      durationMs: 5000,
      stdoutTail: "",
      stderrTail: "",
    });

    const res3 = gateProveCommand({
      run,
      task: "task-core",
      actor: "tester",
    });

    expect(res3.timed_out).toBe(true);
    expect(res3.markdown).toContain("**UNPROVEN**");
    expect(res3.markdown).toContain("the gate timed out against the reverted tree");
  });

  test("exercises all humanOutcome branches and edge cases in claimedBaseShaFor", async () => {
    const { run } = await setupCompiledRun("gate-edges", roots);

    // Test non-evidenced and non-array attempts in claimedBaseShaFor
    transact(run, "coordinator", "edge-tasks-state", {}, (draft) => {
      const tasks = draft.tasks as Record<string, { attempts?: unknown }>;
      if (tasks["task-core"]) {
        tasks["task-core"].attempts = [{ claimed_base_sha: "not-an-evidenced-object" }];
      }
    });

    const spy = spyOn(gateProofModule, "proveGateFalsifiable").mockReturnValue({
      outcome: "falsifiable",
      falsifiable: true,
      base: "HEAD",
      exitCode: 1,
      timedOut: false,
      restoredPaths: [],
      deletedPaths: [],
      revertedScope: ["tests/core"],
      copiedFileCount: 1,
      durationMs: 20,
      stdoutTail: "",
      stderrTail: "",
    });
    spies.push(spy);

    const res = gateProveCommand({
      run,
      task: "task-core",
      actor: "tester",
    });

    expect(res.base).toBe("HEAD");
    expect(res.gate_proofs).toBeDefined();

    // Test legacy proof with falsifiable: true and missing outcome
    transact(run, "coordinator", "legacy-falsifiable-prior", {}, (draft) => {
      const proofs = draft.gate_proofs as Array<Record<string, unknown>>;
      if (proofs && proofs.length > 0) {
        delete proofs[proofs.length - 1]!.outcome;
        proofs[proofs.length - 1]!.falsifiable = true;
      }
    });

    // Test regression drift message when previous was falsifiable and now refused_absent_at_base
    spy.mockReturnValue({
      outcome: "refused_absent_at_base",
      falsifiable: false,
      base: "HEAD",
      exitCode: null,
      timedOut: false,
      restoredPaths: [],
      deletedPaths: [],
      revertedScope: [],
      copiedFileCount: 0,
      durationMs: 8,
      stdoutTail: "",
      stderrTail: "",
    });

    const resRefused = gateProveCommand({
      run,
      task: "task-core",
      actor: "tester",
    });

    expect(resRefused.markdown).toContain(
      "**REGRESSED** — was falsifiable, now refused (absent at base)",
    );
  });
});
