import { describe, expect, test } from "bun:test";
import { readAgentLedgerView } from "../../../../olt/scripts/src/summary/metrics/index.ts";
import {
  AssetRegistry,
  buildGateNode,
  mapGateStatus,
  prepareTaskContext,
  projectFindingsForNode,
} from "../../../../olt/scripts/src/summary/graph/index.ts";
import type { FindingDetail, MediaAsset } from "../../../../olt/scripts/src/summary/graph/index.ts";
import type { TaskRecord } from "../../../../olt/scripts/src/workflow/types.ts";
import { makeTask } from "../dag/graph-fixtures.ts";

function asset(id: string, url: string): MediaAsset {
  return { id, type: "image", url };
}

function finding(id: string, screenshots?: MediaAsset[]): FindingDetail {
  return {
    id,
    severity: "important",
    observation: `finding ${id}`,
    status: "open",
    screenshots,
  };
}

function contextFor(task: TaskRecord) {
  return prepareTaskContext({
    task,
    taskStep: 2,
    taskWave: 1,
    commands: [],
    ledger: readAgentLedgerView({}),
    registry: new AssetRegistry(),
  });
}

describe("AssetRegistry.claim", () => {
  test("registers a new url and reports it as newly owned", () => {
    const registry = new AssetRegistry();
    const owned = registry.claim([asset("a1", "https://x/1.png")]);
    expect(owned).toEqual([asset("a1", "https://x/1.png")]);
    expect(registry.idFor("https://x/1.png")).toBe("a1");
  });

  test("skips a later candidate whose url an earlier claim already owns", () => {
    const registry = new AssetRegistry();
    registry.claim([asset("a1", "https://x/1.png")]);
    const owned = registry.claim([asset("a2", "https://x/1.png")]);
    expect(owned).toEqual([]);
    expect(registry.idFor("https://x/1.png")).toBe("a1");
  });

  test("skips candidates with an empty url without registering them", () => {
    const registry = new AssetRegistry();
    const owned = registry.claim([asset("a1", "")]);
    expect(owned).toEqual([]);
    expect(registry.idFor("")).toBeUndefined();
  });
});

describe("AssetRegistry.idFor", () => {
  test("returns undefined for a url nothing has claimed", () => {
    const registry = new AssetRegistry();
    expect(registry.idFor("https://unclaimed")).toBeUndefined();
  });
});

describe("projectFindingsForNode", () => {
  test("drops the screenshots array and adds no screenshotAssetIds when a finding has none", () => {
    const registry = new AssetRegistry();
    const [result] = projectFindingsForNode([finding("F-1")], registry);
    expect(result?.screenshots).toBeUndefined();
    expect(result?.screenshotAssetIds).toBeUndefined();
  });

  test("maps a finding's screenshot urls to the ids the registry already owns", () => {
    const registry = new AssetRegistry();
    registry.claim([asset("shot-1", "https://x/a.png")]);
    const [result] = projectFindingsForNode(
      [finding("F-1", [asset("shot-1", "https://x/a.png")])],
      registry,
    );
    expect(result?.screenshotAssetIds).toEqual(["shot-1"]);
    expect(result?.screenshots).toBeUndefined();
  });

  test("drops a screenshot the registry never claimed instead of surfacing an undefined id", () => {
    const registry = new AssetRegistry();
    const [result] = projectFindingsForNode(
      [finding("F-1", [asset("shot-x", "https://x/unclaimed.png")])],
      registry,
    );
    expect(result?.screenshotAssetIds).toBeUndefined();
  });

  test("keeps only the claimed ids when a finding mixes claimed and unclaimed screenshots", () => {
    const registry = new AssetRegistry();
    registry.claim([asset("shot-1", "https://x/a.png")]);
    const [result] = projectFindingsForNode(
      [finding("F-1", [asset("shot-1", "https://x/a.png"), asset("shot-2", "https://x/b.png")])],
      registry,
    );
    expect(result?.screenshotAssetIds).toEqual(["shot-1"]);
  });
});

describe("gate node", () => {
  test("maps gate status across the task lifecycle", () => {
    const statuses: Array<[TaskRecord["status"], string]> = [
      ["done", "success"],
      ["validated", "success"],
      ["changes_requested", "warning"],
      ["cancelled", "error"],
      ["escalated", "error"],
      ["validating", "running"],
      ["gating", "running"],
      ["proposed", "pending"],
      ["ready", "pending"],
    ];
    for (const [status, expected] of statuses) {
      expect(mapGateStatus(makeTask("T", { status }))).toBe(expected);
    }
    expect(
      mapGateStatus(
        makeTask("T", {
          status: "leased",
          validations: [
            {
              validator_id: "val-1",
              domain: "code-quality",
              token_digest: "tok",
              attempt: 1,
              started_at: "2026-08-14T20:00:00.000Z",
              deadline_at: "2026-08-14T20:10:00.000Z",
            },
          ],
        }),
      ),
    ).toBe("running");
  });

  test("records gate results and references findings instead of copying them", () => {
    const task = makeTask("T-pushback", {
      status: "changes_requested",
      repair_round: 2,
      write_scope: ["src/feature.ts"],
      gate_results: [{ gate_id: "gate-1", command_id: "C-9", status: "passed" }],
      validations: [
        {
          validator_id: "validator-alpha",
          domain: "code-quality",
          token_digest: "tok1",
          attempt: 1,
          started_at: "2026-08-14T20:00:00.000Z",
          deadline_at: "2026-08-14T20:10:00.000Z",
          verdict: "reject",
        },
      ],
      findings: [
        {
          id: "F-101",
          requirement_id: "REQ-T-pushback",
          severity: "critical",
          observation: "Coverage below threshold",
          remediation: "Add unit tests",
          revalidation: "Run coverage gate",
          status: "open",
          evidence: [],
        },
      ],
    });

    const gateNode = buildGateNode(contextFor(task));

    expect(gateNode.status).toBe("warning");
    expect(gateNode.badge?.text).toBe("Pushback: 1 Finding");
    expect(gateNode.metadata?.gateResults).toEqual([
      { gateId: "gate-1", commandId: "C-9", status: "passed" },
    ]);
    expect(gateNode.metadata?.openFindingIds).toEqual(["F-101"]);
    expect(gateNode.metadata?.validatorNodeId).toBe("node-validator-T-pushback");
    expect(gateNode.metadata?.findings).toBeUndefined();
    expect(gateNode.assets).toBeUndefined();
    expect(gateNode.scripts).toBeUndefined();
  });

  test("keeps the findings when there is no validator node to own them", () => {
    const task = makeTask("T-no-validator", {
      status: "changes_requested",
      repair_round: 1,
      findings: [
        {
          id: "F-orphan",
          requirement_id: "REQ-T-no-validator",
          severity: "important",
          observation: "No validator recorded",
          remediation: "n/a",
          revalidation: "n/a",
          status: "open",
          evidence: [],
        },
      ],
    });

    const gateNode = buildGateNode(contextFor(task));
    expect(gateNode.metadata?.validatorNodeId).toBeUndefined();
    expect(gateNode.metadata?.findings).toHaveLength(1);
  });
});
