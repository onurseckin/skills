import { describe, expect, test } from "bun:test";
import type {
  TaskRecord,
  WorkflowState,
} from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { generateGraphDataset } from "../../../orchestrating-long-tasks/scripts/src/summary/graph-generator.ts";

describe("Round 3: Validator I/O Streams & Edge Traffic Exchanges", () => {
  describe("I/O Stream Serialization Across All 6 Node Archetypes", () => {
    test("populates structured inputs and outputs on prompt, plan, task, gate, critic, and terminal nodes", () => {
      const taskA: TaskRecord = {
        id: "T-core",
        label: "Build Core Engine",
        status: "done",
        requirement_ids: ["REQ-1"],
        write_scope: ["src/core.ts"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
        report: { summary: "Core engine completed", files_changed: ["src/core.ts"] },
      };

      const taskB: TaskRecord = {
        id: "T-api",
        label: "Build API Gateway",
        status: "changes_requested",
        requirement_ids: ["REQ-2"],
        write_scope: ["src/api.ts"],
        dependencies: ["T-core"],
        attempts: [],
        history: [],
        repair_round: 1,
        findings: [
          {
            id: "F-API-1",
            requirement_id: "REQ-2",
            severity: "important",
            observation: "Missing rate limiting headers",
            remediation: "Add X-RateLimit headers to responses",
            revalidation: "Check header middleware test",
            status: "open",
          },
        ],
      };

      const state: WorkflowState = {
        tasks: { "T-core": taskA, "T-api": taskB },
        requirements: [],
        gates: [],
        commands: {},
        orphan_evidence: [],
        completion_review: {
          critic_id: "critic-lead",
          packet_id: "p1",
          packet_sha256: "s1",
          graph_revision: 1,
          readiness_sha256: "r1",
          repository_binding: {
            schema: "harness.repository-binding",
            version: 1,
            inspection_sha256: "i1",
            git_identity_sha256: "g1",
            content_sha256: "c1",
            file_count: 2,
            total_bytes: 500,
          },
          status: "clean",
          unresolved_finding_ids: [],
          findings: [],
          requirement_proofs: [],
          residual_risks: [],
          integrity_evidence: [],
          repository_command_ids: [],
          checks: [],
          reviewed_at: "2026-08-15T19:40:00.000Z",
          review_sha256: "rev1",
        },
        completion_result: {
          status: "complete",
          actor: "coord",
          completed_at: "2026-08-15T19:45:00.000Z",
          graph_revision: 1,
          readiness_sha256: "r1",
          repository_binding: {
            schema: "harness.repository-binding",
            version: 1,
            inspection_sha256: "i1",
            git_identity_sha256: "g1",
            content_sha256: "c1",
            file_count: 2,
            total_bytes: 500,
          },
          critic_review_sha256: "cr1",
          artifact_verification_sha256: "av1",
          mandatory_run_gate_commands: [],
        },
      };

      const dataset = generateGraphDataset({
        runId: "run-io-test",
        state,
        promptText: "Implement core engine and API gateway with complete verification",
      });

      // 1. Input Node
      const inputNode = dataset.nodes.find((n) => n.id === "node-input-prompt");
      expect(inputNode?.kind).toBe("input");
      expect(inputNode?.io?.inputs).toEqual([]);
      expect(inputNode?.io?.outputs).toHaveLength(1);
      expect(inputNode?.io?.outputs?.[0]?.kind).toBe("prompt");

      // 2. Orchestrator Plan Node
      const planNode = dataset.nodes.find((n) => n.id === "node-orchestrator-plan");
      expect(planNode?.kind).toBe("orchestrator");
      expect(planNode?.io?.inputs?.[0]?.node).toBe("node-input-prompt");
      expect(planNode?.io?.outputs?.[0]?.kind).toBe("decision");
      expect(planNode?.io?.outputs?.[0]?.preview).toContain("2 discrete work scopes");

      // 3. Task Node (T-api with dependency and pushback round > 0)
      const taskApiNode = dataset.nodes.find((n) => n.id === "node-task-T-api");
      expect(taskApiNode?.kind).toBe("agent");
      const taskInputs = taskApiNode?.io?.inputs ?? [];
      expect(taskInputs.some((i) => i.node === "node-gate-T-core")).toBe(true);
      expect(taskInputs.some((i) => i.node === "node-orchestrator-plan")).toBe(true);
      expect(taskInputs.some((i) => i.node === "node-gate-T-api")).toBe(true);

      const taskOutputs = taskApiNode?.io?.outputs ?? [];
      expect(taskOutputs.some((o) => o.kind === "summary")).toBe(true);
      expect(taskOutputs.some((o) => o.kind === "file")).toBe(true);
      expect(taskOutputs.some((o) => o.kind === "artifact")).toBe(true);

      // 4. Gate Node (T-api)
      const gateApiNode = dataset.nodes.find((n) => n.id === "node-gate-T-api");
      expect(gateApiNode?.kind).toBe("gate");
      expect(gateApiNode?.io?.inputs).toHaveLength(2);
      expect(gateApiNode?.io?.inputs?.[0]?.node).toBe("node-task-T-api");
      const gateOutputs = gateApiNode?.io?.outputs ?? [];
      expect(gateOutputs.some((o) => o.kind === "decision")).toBe(true);
      expect(
        gateOutputs.some((o) => o.kind === "artifact" && o.label.includes("Validator Findings")),
      ).toBe(true);

      // 5. Critic Node
      const criticNode = dataset.nodes.find((n) => n.id === "node-critic-authority");
      expect(criticNode?.kind).toBe("critic");
      expect(criticNode?.io?.inputs).toHaveLength(2);
      expect(criticNode?.io?.inputs?.map((i) => i.node)).toEqual([
        "node-gate-T-core",
        "node-gate-T-api",
      ]);
      expect(criticNode?.io?.outputs?.[0]?.kind).toBe("decision");
      expect(criticNode?.metadata?.critic_id).toBe("critic-lead");
      expect(criticNode?.metadata?.status).toBe("clean");

      // 6. Terminal Node
      const terminalNode = dataset.nodes.find((n) => n.id === "node-terminal-complete");
      expect(terminalNode?.kind).toBe("terminal");
      expect(terminalNode?.io?.inputs?.[0]?.node).toBe("node-critic-authority");
      expect(terminalNode?.io?.outputs?.[0]?.kind).toBe("summary");
    });
  });

  describe("Rich Edge Traffic Exchanges", () => {
    test("populates detailed EdgeTrafficExchange objects on prompt, spawn, submission, pushback loop, dependency, and join edges", () => {
      const taskA: TaskRecord = {
        id: "T-alpha",
        label: "Alpha Component",
        status: "done",
        requirement_ids: ["R-A"],
        write_scope: ["src/alpha.ts"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
        report: { files_changed: ["src/alpha.ts"] },
      };

      const taskB: TaskRecord = {
        id: "T-beta",
        label: "Beta Component",
        status: "changes_requested",
        requirement_ids: ["R-B"],
        write_scope: ["src/beta.ts"],
        dependencies: ["T-alpha"],
        attempts: [],
        history: [],
        repair_round: 1,
        findings: [
          {
            id: "F-B-1",
            requirement_id: "R-B",
            severity: "critical",
            observation: "Null pointer in Beta handler",
            remediation: "Add null check",
            status: "open",
          },
        ],
      };

      const state: WorkflowState = {
        tasks: { "T-alpha": taskA, "T-beta": taskB },
        requirements: [],
        gates: [],
        commands: {},
        orphan_evidence: [],
      };

      const dataset = generateGraphDataset({
        runId: "run-edges-test",
        state,
        promptText: "Build Alpha and Beta with full edge telemetry",
      });

      // 1. edge-prompt-plan
      const edgePrompt = dataset.edges.find((e) => e.id === "edge-prompt-plan");
      expect(edgePrompt).toBeDefined();
      const exchPrompt = edgePrompt?.traffic?.exchanges?.[0];
      expect(exchPrompt?.direction).toBe("forward");
      expect(exchPrompt?.type).toBe("prompt");
      expect(exchPrompt?.kind).toBe("prompt");
      expect(exchPrompt?.inputGoal).toContain("Build Alpha and Beta");

      // 2. edge-plan-T-alpha (spawn)
      const edgeSpawn = dataset.edges.find((e) => e.id === "edge-plan-T-alpha");
      expect(edgeSpawn).toBeDefined();
      const exchSpawn = edgeSpawn?.traffic?.exchanges?.[0];
      expect(exchSpawn?.direction).toBe("forward");
      expect(exchSpawn?.type).toBe("dispatch");
      expect(exchSpawn?.kind).toBe("prompt");
      expect(exchSpawn?.inputGoal).toContain("Goal: Alpha Component");

      // 3. edge-task-gate-T-alpha (submission)
      const edgeSub = dataset.edges.find((e) => e.id === "edge-task-gate-T-alpha");
      expect(edgeSub).toBeDefined();
      const exchSub = edgeSub?.traffic?.exchanges?.[0];
      expect(exchSub?.direction).toBe("forward");
      expect(exchSub?.type).toBe("submission");
      expect(exchSub?.kind).toBe("file");
      expect(exchSub?.filesTransferred).toBeDefined();
      expect(exchSub?.filesTransferred?.[0]).toEqual({ path: "src/alpha.ts", mode: "write" });

      // 4. edge-repair-T-beta (loop pushback)
      const edgeRepair = dataset.edges.find((e) => e.id === "edge-repair-T-beta");
      expect(edgeRepair).toBeDefined();
      expect(edgeRepair?.isCycle).toBe(true);
      const exchRepair = edgeRepair?.traffic?.exchanges?.[0];
      expect(exchRepair?.direction).toBe("reverse");
      expect(exchRepair?.type).toBe("rejection");
      expect(exchRepair?.kind).toBe("decision");
      expect(exchRepair?.status).toBe("warning");
      expect(exchRepair?.auditFinding).toBeDefined();
      expect(exchRepair?.rejectionObservation).toContain("Null pointer in Beta handler");
      expect(exchRepair?.requiredRemediation).toContain("Add null check");
      expect(exchRepair?.verdict).toBe("FAIL");

      // 5. edge-dep-T-alpha-T-beta (dependency handoff)
      const edgeDep = dataset.edges.find((e) => e.id === "edge-dep-T-alpha-T-beta");
      expect(edgeDep).toBeDefined();
      const exchDep = edgeDep?.traffic?.exchanges?.[0];
      expect(exchDep?.direction).toBe("forward");
      expect(exchDep?.type).toBe("handoff");
      expect(exchDep?.kind).toBe("artifact");

      // 6. edge-join-T-alpha (critic join)
      const edgeJoin = dataset.edges.find((e) => e.id === "edge-join-T-alpha");
      expect(edgeJoin).toBeDefined();
      const exchJoin = edgeJoin?.traffic?.exchanges?.[0];
      expect(exchJoin?.direction).toBe("forward");
      expect(exchJoin?.type).toBe("approval");
      expect(exchJoin?.verdict).toBe("PASS");

      // 7. edge-critic-complete
      const edgeCritic = dataset.edges.find((e) => e.id === "edge-critic-complete");
      expect(edgeCritic).toBeDefined();
      const exchCritic = edgeCritic?.traffic?.exchanges?.[0];
      expect(exchCritic?.direction).toBe("forward");
      expect(exchCritic?.type).toBe("decision");
      expect(exchCritic?.verdict).toBe("PASS");
    });
  });
});
