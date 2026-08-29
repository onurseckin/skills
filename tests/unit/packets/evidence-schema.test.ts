import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { AgentRole } from "../../../olt/scripts/src/core/contracts/index.ts";
import { evidenceSchema } from "../../../olt/scripts/src/packets/evidence-schema.ts";

const expectedGateEvidence = {
  assurance: "trusted_host_observed_v1",
  sandboxed: false,
  trusted_boundary: "local OS user, host-selected toolchain and transitive processes",
};

const expectedGateLimitations = [
  "The host or coding application may add a sandbox; the harness neither configures nor attests it.",
  "Same-user mutate, execute, and restore between observations is outside this assurance.",
  "Process ownership signaling remains independently fail-closed.",
];

const ALL_AGENT_ROLES: readonly AgentRole[] = [
  "completeness-critic",
  "coordinator",
  "implementer",
  "mind",
  "mind-auditor",
  "skill-auditor",
  "orchestrator",
  "plan-validator",
  "planner",
  "repairer",
  "sub-implementer",
  "sub-investigator",
  "sub-validator",
  "validator",
  "mechanic-validator",
];

describe("packet evidence-schema validation and boundary parsing", () => {
  describe("trusted host boundary and envelope", () => {
    test("every agent role includes standard gate evidence and limitations", () => {
      for (const role of ALL_AGENT_ROLES) {
        const schema = evidenceSchema(role);
        expect(schema.gate_evidence).toEqual(expectedGateEvidence);
        expect(schema.gate_evidence_limitations).toEqual(expectedGateLimitations);
      }
    });

    test("schema cloning guarantees immutability across calls", () => {
      const first = evidenceSchema("implementer");
      const second = evidenceSchema("implementer");
      expect(first).toEqual(second);
      expect(first).not.toBe(second);
      (first as Record<string, unknown>).summary = "mutated";
      expect(evidenceSchema("implementer").summary).toBe("<nonempty summary>");
    });

    test("schema serializations produce stable reproducible SHA256 digests", () => {
      for (const role of ALL_AGENT_ROLES) {
        const json1 = JSON.stringify(evidenceSchema(role));
        const json2 = JSON.stringify(evidenceSchema(role));
        const digest1 = createHash("sha256").update(json1).digest("hex");
        const digest2 = createHash("sha256").update(json2).digest("hex");
        expect(digest1).toHaveLength(64);
        expect(digest1).toBe(digest2);
      }
    });
  });

  describe("task execution roles (implementer, repairer, sub-implementer)", () => {
    test("task execution roles share identical submission schema contracts", () => {
      const impl = evidenceSchema("implementer");
      const rep = evidenceSchema("repairer");
      const subImpl = evidenceSchema("sub-implementer");

      expect(impl).toEqual(rep);
      expect(impl).toEqual(subImpl);
      expect(impl.summary).toBe("<nonempty summary>");
      expect(impl.requirement_ids).toEqual(["<every mapped requirement id exactly once>"]);
      expect(impl.files_changed).toEqual(["<repository-relative path within write scope>"]);
      expect(impl.checks).toEqual([{ command_id: "<authoritative command id>" }]);
      expect(impl.evidence).toEqual([{ path: "<durable evidence path>" }]);
    });
  });

  describe("validation roles (validator, sub-validator, mechanic-validator)", () => {
    test("validator and sub-validator share review schema contract without token field", () => {
      const val = evidenceSchema("validator");
      const subVal = evidenceSchema("sub-validator");

      expect(val).toEqual(subVal);
      expect(val.verdict).toBe("pass|reject");
      expect(val.requirement_ids).toEqual(["<every task requirement id exactly once>"]);
      expect(val.checks).toEqual([{ command_id: "<independent validator command id>" }]);
      expect(val.findings).toBeArray();
      expect(val.resolved_findings).toBeArray();
      expect(JSON.stringify(val)).not.toContain("token");
    });

    test("mechanic-validator schema includes gate receipts array and gate command checks", () => {
      const mech = evidenceSchema("mechanic-validator");

      expect(mech.verdict).toBe("pass|reject");
      expect(mech.requirement_ids).toEqual(["<every task requirement id exactly once>"]);
      expect(mech.checks).toEqual([{ command_id: "<mechanic-validator gate command id>" }]);
      expect(mech.gate_receipts).toEqual([
        {
          gate_id: "<gate id>",
          command_id: "<executed command id>",
          exit_code: 0,
          duration_ms: "<duration ms>",
          status: "passed|failed",
        },
      ]);
      expect(mech.findings).toBeArray();
    });
  });

  describe("investigation, coordination and orchestration roles", () => {
    test("sub-investigator schema focuses on read sources and reproduction", () => {
      const inv = evidenceSchema("sub-investigator");

      expect(inv).not.toHaveProperty("files_changed");
      expect(inv.sources).toEqual(["<repository-relative path actually read>"]);
      expect(inv.reproduction).toBe(
        "<the exact command or steps that reproduce the behaviour, or an explicit unknown>",
      );
      expect(inv.checks).toEqual([{ command_id: "<read-only diagnostic command id>" }]);
      expect(inv.findings).toBeArray();
      expect(inv.evidence).toEqual([{ path: "<durable evidence path>" }]);
    });

    test("coordinator schema requires dispatched agents and wave topology", () => {
      const coord = evidenceSchema("coordinator");

      expect(coord).not.toHaveProperty("files_changed");
      expect(coord.dispatched_agents).toEqual(["<agent id registered through agent:register>"]);
      expect(coord.waves).toEqual([
        { wave: "<recorded topology wave>", task_ids: ["<task id dispatched in that wave>"] },
      ]);
      expect(coord.checks).toEqual([
        { command_id: "<mandatory gate command id the coordinator executed>" },
      ]);
    });

    test("orchestrator schema requires dispatched coordinators and round convergence lineage", () => {
      const orch = evidenceSchema("orchestrator");

      expect(orch).not.toHaveProperty("files_changed");
      expect(orch).not.toHaveProperty("waves");
      expect(orch.dispatched_coordinators).toEqual([
        "<coordinator agent id registered through agent:register>",
      ]);
      expect(orch.rounds).toEqual([
        {
          round: "<round number>",
          run_id: "<that round's own capsule run id>",
          outcome: "clean_convergence|escalated",
        },
      ]);
      expect(orch.checks).toEqual([{ command_id: "<run:status or doctor command id inspected>" }]);
    });
  });

  describe("planning and plan validation roles", () => {
    test("planner schema defines requirement and graph paths with runtime validation", () => {
      const planner = evidenceSchema("planner");

      expect(planner.requirements_path).toBe("<validated requirements JSON path>");
      expect(planner.graph_path).toBe("<validated graph JSON path>");
      expect(planner.validation).toEqual([
        { command: ["bun", "<pinned-runtime>", "validate"], status: "passed" },
      ]);
    });

    test("plan-validator schema enforces 4-question answers, reviewed edges, and gate ids", () => {
      const pv = evidenceSchema("plan-validator");

      expect(pv.validator_token).toBe("<host-delivered>");
      expect(pv.graph_revision).toBe("<this packet graph revision>");
      expect(pv.plan_digest).toBe("<this packet plan digest>");
      expect(pv.status).toBe("approved|changes_requested");
      expect(pv.decomposition_answer).toBeString();
      expect(pv.dependency_answer).toBeString();
      expect(pv.gate_answer).toBeString();
      expect(pv.straggler_answer).toBeString();
      expect(pv.dependency_edges_reviewed).toEqual([
        {
          from: "<depending task id — exactly every edge the compiled plan declares, or empty if none>",
          to: "<dependency task id>",
        },
      ]);
      expect(pv.gate_ids_reviewed).toEqual([
        "<exactly every per-task gate id the compiled plan declares>",
      ]);
      expect(pv.findings).toBeArray();
    });
  });

  describe("mind, mind-auditor, and skill-auditor roles", () => {
    test("mind schema enforces pulse lifecycle status and candidates", () => {
      const mind = evidenceSchema("mind");

      expect(mind.pulse_id).toBe("<pulse id>");
      expect(mind.started_at).toBe("<iso-8601>");
      expect(mind.closed_at).toBe("<iso-8601>");
      expect(mind.outcome).toBe("nominal|quiescent|paused|escalated|halted");
      expect(mind.candidates).toEqual([{ id: "<candidate id>" }]);
    });

    test("mind-auditor schema tracks window verdicts and structured question answers", () => {
      const ma = evidenceSchema("mind-auditor");

      expect(ma.audit_id).toBe("<audit id>");
      expect(ma.window).toBe("<window start iso-8601>");
      expect(ma.verdict).toBe("approved|changes_requested|halt");
      expect(ma.answers).toEqual([
        { question_id: "<q1-q8>", command_id: "<command id>", verdict: "pass|fail|finding|clean" },
      ]);
    });

    test("skill-auditor schema requires heuristics detection and remediation proposals", () => {
      const sa = evidenceSchema("skill-auditor");

      expect(sa.audit_id).toBe("<audit id>");
      expect(sa.run).toBe("<run slug>");
      expect(sa.wave_index).toBe("<wave index or all>");
      expect(sa.efficiency_score).toBe(100.0);
      expect(sa.heuristics).toEqual([
        {
          heuristic:
            "TOKEN_BURNING|FALSE_SERIALIZATION|ROLE_BOUNDARY_DEVIATION|POLLING_WASTE|CONTEXT_OVERFLOW|GHOST_LEASE|STRAGGLER",
          detected: true,
          severity: "low|medium|high|critical",
          details: "<heuristic findings>",
        },
      ]);
      expect(sa.remediation_proposals).toEqual([
        { id: "<proposal id>", title: "<title>", priority: "MEDIUM" },
      ]);
    });
  });

  describe("completeness-critic role", () => {
    test("completeness-critic schema binds repository inspection hashes and requirement proofs", () => {
      const cc = evidenceSchema("completeness-critic");

      expect(cc.packet_id).toBe("<this packet id>");
      expect(cc.critic_token).toBe("<host-delivered>");
      expect(cc.packet_sha256).toBe("<this packet sha256>");
      expect(cc.readiness_sha256).toBe("<this packet readiness sha256>");
      expect(cc.repository_binding).toEqual({
        schema: "harness.repository-binding",
        version: 1,
        inspection_sha256: "<this packet repository inspection sha256>",
        git_identity_sha256: "<this packet repository Git identity sha256>",
        content_sha256: "<this packet repository content sha256>",
        file_count: "<this packet repository file count>",
        total_bytes: "<this packet repository total bytes>",
      });
      expect(cc.status).toBe("clean|findings");
      expect(cc.unresolved_finding_ids).toEqual(["<exactly every findings[].id>"]);
      expect(cc.requirement_proofs).toBeArray();
      expect(cc.findings).toBeArray();
      expect(cc.residual_risks).toBeArray();
    });
  });
});
