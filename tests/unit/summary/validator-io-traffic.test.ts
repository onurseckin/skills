import { describe, expect, test } from "bun:test";
import { generateGraphDataset } from "../../../olt/scripts/src/summary/graph/index.ts";
import { makeCommand, makeState, makeTask } from "./graph-fixtures.ts";

function pipelineDataset() {
  const core = makeTask("T-core", {
    label: "Build Core Engine",
    status: "done",
    report: { summary: "Core engine completed", files_changed: ["src/core.ts"] },
    validations: [
      {
        validator_id: "val-core",
        domain: "code-quality",
        token_digest: "tok",
        attempt: 1,
        started_at: "2026-08-15T19:30:00.000Z",
        deadline_at: "2026-08-15T19:40:00.000Z",
        verdict: "pass",
      },
    ],
  });
  const api = makeTask("T-api", {
    label: "Build API Gateway",
    status: "changes_requested",
    dependencies: ["T-core"],
    repair_round: 1,
    validations: [
      {
        validator_id: "val-api",
        domain: "code-quality",
        token_digest: "tok",
        attempt: 1,
        started_at: "2026-08-15T19:35:00.000Z",
        deadline_at: "2026-08-15T19:45:00.000Z",
        verdict: "reject",
      },
    ],
    findings: [
      {
        id: "F-API-1",
        requirement_id: "REQ-T-api",
        severity: "important",
        observation: "Missing rate limiting headers",
        remediation: "Add X-RateLimit headers to responses",
        revalidation: "Check header middleware test",
        status: "open",
        evidence: [],
      },
    ],
  });
  const gateCommand = makeCommand("C-gate-core", {
    task_id: "T-core",
    gate_id: "gate-core",
    actor: "val-core",
    logs: {
      stdout: { path: "commands/C-gate-core/stdout.log", bytes: 120, sha256: "a" },
      stderr: { path: "commands/C-gate-core/stderr.log", bytes: 0, sha256: "b" },
    },
  });

  return generateGraphDataset({
    runId: "run-io-test",
    state: makeState([core, api]),
    promptText: "Implement core engine and API gateway",
    commands: { "C-gate-core": gateCommand },
  });
}

describe("node io ports", () => {
  test("serializes inputs and outputs for every archetype", () => {
    const dataset = pipelineDataset();
    const node = (id: string) => dataset.nodes.find((entry) => entry.id === id);

    expect(node("node-input-prompt")?.io?.inputs).toEqual([]);
    expect(node("node-input-prompt")?.io?.outputs?.[0]?.kind).toBe("prompt");

    expect(node("node-orchestrator-plan")?.io?.inputs?.[0]?.node).toBe("node-input-prompt");
    expect(node("node-orchestrator-plan")?.io?.outputs?.[0]?.preview).toContain(
      "2 discrete work scopes",
    );

    const api = node("node-task-T-api");
    const apiInputs = api?.io?.inputs ?? [];
    expect(apiInputs.some((port) => port.node === "node-gate-T-core")).toBe(true);
    expect(apiInputs.some((port) => port.node === "node-orchestrator-plan")).toBe(true);
    expect(apiInputs.some((port) => port.node === "node-gate-T-api")).toBe(true);
    expect((api?.io?.outputs ?? []).map((port) => port.kind).sort()).toEqual([
      "artifact",
      "file",
      "summary",
    ]);

    const validator = node("node-validator-T-api");
    expect(validator?.io?.inputs?.[0]?.node).toBe("node-task-T-api");
    expect(validator?.io?.outputs?.[0]?.preview).toBe("Recorded verdict: reject");

    expect(node("node-gate-T-api")?.io?.inputs?.[0]?.node).toBe("node-validator-T-api");
    expect(node("node-critic-authority")?.io?.inputs?.map((port) => port.node)).toEqual([
      "node-gate-T-core",
      "node-gate-T-api",
    ]);
    expect(node("node-terminal-complete")?.io?.inputs?.[0]?.node).toBe("node-critic-authority");
  });
});

describe("edge traffic is measured or absent", () => {
  test("reports observed bytes on the prompt edge", () => {
    const dataset = pipelineDataset();
    const edge = dataset.edges.find((entry) => entry.id === "edge-prompt-plan");

    expect(edge?.traffic?.evidence_class).toBe("harness_observed");
    expect(edge?.traffic?.bytes).toBe("Implement core engine and API gateway".length);
    expect(edge?.traffic?.messagesCount).toBe(1);
  });

  test("reports the recorded gate command bytes and duration on the validation edge", () => {
    const dataset = pipelineDataset();
    const edge = dataset.edges.find((entry) => entry.id === "edge-validation-T-core");

    expect(edge?.traffic?.bytes).toBe(120);
    expect(edge?.traffic?.durationMs).toBe(1000);
    expect(edge?.exchanges?.[0]?.verdict).toBe("PASS");
  });

  test("omits the traffic block for an edge the run measured nothing on", () => {
    const dataset = pipelineDataset();
    const dependency = dataset.edges.find((entry) => entry.id === "edge-dep-T-core-T-api");

    expect(dependency).toBeDefined();
    expect(dependency?.traffic).toBeUndefined();
    expect(dependency?.exchanges).toBeUndefined();
  });

  test("never emits a token count on an edge", () => {
    const serialized = JSON.stringify(pipelineDataset().edges);
    expect(serialized).not.toContain('"tokens"');
    expect(serialized).not.toContain('"tokensIn"');
    expect(serialized).not.toContain('"tokensOut"');
    expect(serialized).not.toContain('"ratePerSec"');
    expect(serialized).not.toContain('"latencyMs"');
  });

  test("carries a per-edge accent instead of borrowing the source node colour", () => {
    const dataset = pipelineDataset();
    const accents = new Map(dataset.edges.map((edge) => [edge.kind, edge.accent]));
    expect(accents.get("dispatch")).toBe("#3b82f6");
    expect(accents.get("pushback")).toBe("#f43f5e");
    expect(accents.get("dependency")).toBe("#06b6d4");
  });
});
