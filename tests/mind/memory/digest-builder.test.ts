import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildEscalationDigest,
  buildOwnerDigest,
} from "../../../olt/scripts/src/mind/memory/digest/builder.ts";
import type {
  DigestDeclinedCandidate,
  DigestEscalation,
  DigestFailingGate,
  DigestFinding,
  DigestOpenProposal,
} from "../../../olt/scripts/src/mind/memory/digest/types.ts";
import { generateTrailingValueSeries } from "../../../olt/scripts/src/mind/lifecycle/interval/index.ts";
import { canonicalJsonBytes } from "../../../olt/scripts/src/core/json.ts";

function createMockCapsule(
  baseDir: string,
  runId: string,
  state: Record<string, unknown> = {},
): string {
  const capDir = join(baseDir, runId);
  mkdirSync(capDir, { recursive: true });
  writeFileSync(
    join(capDir, "manifest.json"),
    canonicalJsonBytes({ capsule_id: `c-${runId}`, run_id: runId }),
  );
  writeFileSync(join(capDir, "prompt.md"), "# Prompt\n");
  writeFileSync(join(capDir, "state.json"), canonicalJsonBytes(state as any));
  writeFileSync(join(capDir, "events.jsonl"), "");
  return capDir;
}

describe("Digest Builder (buildEscalationDigest & buildOwnerDigest)", () => {
  it("builds empty digest with default parameters", () => {
    const digest = buildEscalationDigest();
    expect(digest.runId).toBe("mind");
    expect(typeof digest.generatedAt).toBe("string");
    expect(digest.openFindings).toEqual([]);
    expect(digest.failingGates).toEqual([]);
    expect(digest.escalations).toEqual([]);
    expect(digest.declinedCandidates).toEqual([]);
    expect(digest.openProposals).toEqual([]);
    expect(digest.totalSignalsCount).toBe(0);
    expect(digest.trailingValueSeries.rawValues).toEqual([]);
    expect(buildOwnerDigest).toBe(buildEscalationDigest);
  });

  it("handles now and runId resolution options", () => {
    const fixedTime = 1700000000000;
    const isoString = new Date(fixedTime).toISOString();
    const d1 = buildEscalationDigest({ now: fixedTime, runId: "custom-run-1" });
    expect(d1.generatedAt).toBe(isoString);
    expect(d1.runId).toBe("custom-run-1");

    const d2 = buildEscalationDigest({ now: new Date(fixedTime) });
    expect(d2.generatedAt).toBe(isoString);

    const d3 = buildEscalationDigest({ now: "2026-01-01T12:00:00.000Z" });
    expect(d3.generatedAt).toBe("2026-01-01T12:00:00.000Z");

    const d4 = buildEscalationDigest({ now: "not-a-valid-date" });
    expect(typeof d4.generatedAt).toBe("string");

    const d5 = buildEscalationDigest({ mindRunRoot: "/path/to/capsules/cap-999" });
    expect(d5.runId).toBe("cap-999");
  });

  it("registers explicit items, deduplicates keys, and sorts deterministically", () => {
    const findings: DigestFinding[] = [
      { findingId: "f-2", taskId: "t-1", runId: "r-1", observation: "Obs 2" },
      { findingId: "f-1", taskId: "t-1", runId: "r-1", observation: "Obs 1" },
      { findingId: "f-1", taskId: "t-1", runId: "r-1", observation: "Duplicate f1" },
      { findingId: "f-0", observation: "Obs 0" },
    ];
    const gates: DigestFailingGate[] = [
      { gateId: "g-b", runId: "r-1", command: "test" },
      { gateId: "g-a", runId: "r-1", command: "test" },
      { gateId: "g-a", runId: "r-1", command: "test dup" },
    ];
    const escalations: DigestEscalation[] = [
      { escalationId: "e-z", runId: "r-1", reason: "z" },
      { escalationId: "e-a", runId: "r-1", reason: "a" },
      { escalationId: "e-a", runId: "r-1", reason: "dup a" },
    ];
    const declined: DigestDeclinedCandidate[] = [
      { candidateId: "c-2", statement: "stmt2", declineReason: "r2" },
      { candidateId: "c-1", statement: "stmt1", declineReason: "r1" },
      { candidateId: "c-1", statement: "stmt1 dup", declineReason: "r1 dup" },
    ];
    const proposals: DigestOpenProposal[] = [
      { proposalId: "p-2", statement: "prop2", rationale: "rat2" },
      { proposalId: "p-1", statement: "prop1", rationale: "rat1" },
      { proposalId: "p-1", statement: "prop1 dup", rationale: "rat1 dup" },
    ];

    const digest = buildEscalationDigest({
      openFindings: findings,
      failingGates: gates,
      escalations,
      declinedCandidates: declined,
      openProposals: proposals,
    });

    expect(digest.openFindings.map((f) => f.findingId)).toEqual(["f-0", "f-1", "f-2"]);
    expect(digest.failingGates.map((g) => g.gateId)).toEqual(["g-a", "g-b"]);
    expect(digest.escalations.map((e) => e.escalationId)).toEqual(["e-a", "e-z"]);
    expect(digest.declinedCandidates.map((d) => d.candidateId)).toEqual(["c-1", "c-2"]);
    expect(digest.openProposals.map((p) => p.proposalId)).toEqual(["p-1", "p-2"]);
    expect(digest.totalSignalsCount).toBe(11);
  });

  it("extracts signals from state object", () => {
    const state: Record<string, unknown> = {
      escalations: [{ id: "esc-1", reason: "state escalation", resolved_at: null }],
      tasks: {
        "task-1": {
          status: "changes_requested",
          reason: "Needs more tests",
          last_command_id: "cmd-1",
        },
      },
      gates: [{ id: "gate-1", status: "failed", command: ["bun", "test"], exit_code: 1 }],
      candidates: [
        { id: "prop-1", statement: "add feature", rationale: "needed", status: "proposed" },
        {
          id: "cand-1",
          statement: "proposal cand",
          rationale: "r",
          status: "declined",
          decline_reason: "out of scope",
        },
      ],
    };

    const digest = buildEscalationDigest({ state, runId: "state-run" });
    expect(digest.openFindings.length).toBe(1);
    expect(digest.openFindings[0].findingId).toBe("finding-task-1");
    expect(digest.failingGates.length).toBe(1);
    expect(digest.failingGates[0].gateId).toBe("gate-1");
    expect(digest.escalations.length).toBe(1);
    expect(digest.escalations[0].escalationId).toBe("esc-1");
    expect(digest.declinedCandidates.length).toBe(1);
    expect(digest.declinedCandidates[0].candidateId).toBe("cand-1");
    expect(digest.openProposals.length).toBe(1);
    expect(digest.openProposals[0].proposalId).toBe("prop-1");
  });

  it("extracts signals from liveRuns array with in-memory state and on-disk runRoot", () => {
    const tmp = mkdtempSync(join(tmpdir(), "live-runs-"));
    try {
      const diskCap = createMockCapsule(tmp, "disk-run", {
        gates: [{ id: "disk-gate", status: "failed", command: "bun test" }],
      });
      const corruptedCap = join(tmp, "corrupted-run");
      mkdirSync(corruptedCap, { recursive: true });

      const digest = buildEscalationDigest({
        liveRuns: [
          {
            runId: "mem-run",
            state: {
              escalations: [{ id: "mem-esc", reason: "memory escalation" }],
            },
          },
          {
            runId: "disk-run",
            runRoot: diskCap,
          },
          {
            runId: "corrupt-run",
            runRoot: corruptedCap,
          },
          {
            runId: "nonexistent-run",
            runRoot: join(tmp, "does-not-exist"),
          },
        ],
      });

      expect(digest.escalations.some((e) => e.escalationId === "mem-esc")).toBe(true);
      expect(digest.failingGates.some((g) => g.gateId === "disk-gate")).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("extracts signals from capsulesDir and handles unreadable entries", () => {
    const tmp = mkdtempSync(join(tmpdir(), "capsules-dir-"));
    try {
      createMockCapsule(tmp, "run-alpha", {
        candidates: [
          {
            id: "cand-alpha",
            statement: "alpha prop",
            rationale: "rat",
            kind: "proposal",
            status: "proposed",
          },
        ],
      });
      mkdirSync(join(tmp, ".hidden-dir"), { recursive: true });
      writeFileSync(join(tmp, "some-file.txt"), "hello");
      const corruptDir = join(tmp, "run-corrupt");
      mkdirSync(corruptDir, { recursive: true });
      writeFileSync(join(corruptDir, "manifest.json"), "invalid json");

      const digest = buildEscalationDigest({ capsulesDir: tmp });
      expect(digest.openProposals.some((p) => p.proposalId === "cand-alpha")).toBe(true);

      const nonExistentDigest = buildEscalationDigest({ capsulesDir: join(tmp, "non-existent") });
      expect(nonExistentDigest.openProposals).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("extracts signals and series from mindRunRoot when state is not provided", () => {
    const tmp = mkdtempSync(join(tmpdir(), "mind-root-"));
    try {
      const root = createMockCapsule(tmp, "root-run", {
        escalations: [{ id: "root-esc", reason: "root escalation" }],
      });
      const digest = buildEscalationDigest({ mindRunRoot: root });
      expect(digest.escalations.some((e) => e.escalationId === "root-esc")).toBe(true);
      expect(digest.runId).toBe("root-run");

      const corruptRoot = join(tmp, "corrupt-root");
      mkdirSync(corruptRoot, { recursive: true });
      const corruptDigest = buildEscalationDigest({ mindRunRoot: corruptRoot });
      expect(corruptDigest.escalations).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("handles various trailingValueSeries option formats and fallbacks", () => {
    const prebuilt = generateTrailingValueSeries(
      [{ pulseId: "p1", outcome: "advance", value: 5 }],
      10,
    );
    const dPrebuilt = buildEscalationDigest({ trailingValueSeries: prebuilt });
    expect(dPrebuilt.trailingValueSeries.rawValues).toEqual([5]);

    const dEmptyArr = buildEscalationDigest({ trailingValueSeries: [] });
    expect(dEmptyArr.trailingValueSeries.rawValues).toEqual([]);

    const dNums = buildEscalationDigest({ trailingValueSeries: [3, 0, 4] });
    expect(dNums.trailingValueSeries.rawValues).toEqual([3, 0, 4]);

    const dPoints = buildEscalationDigest({
      trailingValueSeries: [
        { pulseId: "pulse-a", outcome: "advance", value: 8 },
        { pulseId: "pulse-b", outcome: "quiescent", value: 0 },
      ],
    });
    expect(dPoints.trailingValueSeries.rawValues).toEqual([8, 0]);

    const dInvalidObj = buildEscalationDigest({
      trailingValueSeries: { notAValidSeries: true } as unknown as any,
    });
    expect(dInvalidObj.trailingValueSeries.rawValues).toEqual([]);

    const dEvents = buildEscalationDigest({
      events: [
        { event_type: "pulse:completed", data: { pulseId: "p1", outcome: "advance", value: 10 } },
      ],
    });
    expect(dEvents.trailingValueSeries.rawValues).toBeDefined();

    const dState = buildEscalationDigest({
      state: {
        pulse_history: [{ pulse_id: "p-st", outcome: "advance", value: 7 }],
      },
    });
    expect(dState.trailingValueSeries.rawValues).toBeDefined();
  });
});
