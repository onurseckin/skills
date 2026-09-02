import { describe, expect, test } from "bun:test";
import {
  auditCrossTierSpawning,
  auditCoordinatorConfinement,
  auditSupervisorCodeContamination,
} from "../../../olt/scripts/src/reporting/doctor/tier-confinement/audit-supervisor.ts";
import type { TierConfinementFinding } from "../../../olt/scripts/src/reporting/doctor/tier-confinement/types.ts";
import type {
  AgentGrantRecord,
  CommandRecord,
} from "../../../olt/scripts/src/core/contracts/index.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";

describe("auditCrossTierSpawning", () => {
  test("skips grants without parent_agent_id and handles compliant spawning", () => {
    const findings: TierConfinementFinding[] = [];
    const roleMap = new Map<string, string>([
      ["mind-1", "mind"],
      ["orch-1", "orchestrator"],
    ]);
    const grants: AgentGrantRecord[] = [
      {
        id: "orch-1",
        role: "orchestrator",
        parent_agent_id: undefined,
      } as unknown as AgentGrantRecord,
      {
        id: "orch-2",
        role: "orchestrator",
        parent_agent_id: "mind-1",
      } as unknown as AgentGrantRecord,
    ];
    auditCrossTierSpawning(roleMap, grants, findings);
    expect(findings).toHaveLength(0);
  });

  test("flags illegal cross-tier spawning with roleMap lookup or inferred role", () => {
    const findings: TierConfinementFinding[] = [];
    const roleMap = new Map<string, string>([["orch-1", "orchestrator"]]);
    const grants: AgentGrantRecord[] = [
      {
        id: "impl-1",
        role: "implementer",
        parent_agent_id: "orch-1",
      } as unknown as AgentGrantRecord,
      {
        id: "coord-1",
        role: "coordinator",
        parent_agent_id: "mind-root",
      } as unknown as AgentGrantRecord,
    ];
    auditCrossTierSpawning(roleMap, grants, findings);
    expect(findings).toHaveLength(2);
    expect(findings[0]?.violation_type).toBe("cross_tier_spawning_violation");
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.evidence.parent_role).toBe("orchestrator");
    expect(findings[1]?.evidence.parent_role).toBe("mind");
  });
});

describe("auditCoordinatorConfinement", () => {
  test("skips non-coordinator grants and clean coordinators", () => {
    const findings: TierConfinementFinding[] = [];
    const roleMap = new Map<string, string>([["worker-1", "implementer"]]);
    const grants: AgentGrantRecord[] = [
      {
        id: "worker-1",
        role: "implementer",
        tools_used: [{ name: "write_to_file" }],
      } as unknown as AgentGrantRecord,
      {
        id: "coord-1",
        role: "coordinator",
        tools_used: [{ name: "read_file", category: "read-only" }],
        tools_granted: { value: [{ name: "read_file", category: "read-only" }] },
      } as unknown as AgentGrantRecord,
    ];
    auditCoordinatorConfinement(roleMap, grants, [], [], findings);
    expect(findings).toHaveLength(0);
  });

  test("flags coordinator tool usage and unauthorized grants", () => {
    const findings: TierConfinementFinding[] = [];
    const roleMap = new Map<string, string>();
    const grants: AgentGrantRecord[] = [
      {
        id: "coord-1",
        role: "coordinator",
        tools_used: [{ name: "custom_edit", category: "file-edit" }, { name: "write_to_file" }],
        tools_granted: {
          value: [
            { name: "custom_write", category: "file-edit" },
            { name: "replace_file_content" },
          ],
        },
      } as unknown as AgentGrantRecord,
    ];
    auditCoordinatorConfinement(roleMap, grants, [], [], findings);
    expect(findings).toHaveLength(4);
    expect(findings.every((f) => f.violation_type === "coordinator_code_writing")).toBe(true);
  });

  test("flags coordinator command edits, full test runs, and task leases", () => {
    const findings: TierConfinementFinding[] = [];
    const roleMap = new Map<string, string>([
      ["coord-a", "coordinator"],
      ["coord-b", "coordinator"],
      ["agent-c", "coordinator"],
    ]);

    const commands: CommandRecord[] = [
      { id: "cmd-1", actor: "worker-1", argv: ["bun", "test"] } as unknown as CommandRecord,
      { id: "cmd-2", actor: "coord-a", tool: "write_to_file" } as unknown as CommandRecord,
      { id: "cmd-3", actor: "coord-a", tool_category: "file-edit" } as unknown as CommandRecord,
      { id: "cmd-4", actor: "coord-a", argv: ["apply_patch"] } as unknown as CommandRecord,
      { id: "cmd-5", actor: "coord-b", argv: ["bun", "test"] } as unknown as CommandRecord,
      { id: "coord-infer", actor: "coord-infer", tool: "edit_file" } as unknown as CommandRecord,
    ];

    const tasks: TaskRecord[] = [
      { id: "t-1", lease: undefined } as unknown as TaskRecord,
      {
        id: "t-2",
        lease: { agent_id: "agent-x", role: "coordinator", issued_at: "now" },
      } as unknown as TaskRecord,
      {
        id: "t-3",
        lease: { agent_id: "agent-c", role: "worker", issued_at: "now" },
      } as unknown as TaskRecord,
      {
        id: "t-4",
        lease: { agent_id: "impl-1", role: "implementer", issued_at: "now" },
      } as unknown as TaskRecord,
    ];

    auditCoordinatorConfinement(roleMap, [], commands, tasks, findings);
    const testSuiteFindings = findings.filter(
      (f) => f.violation_type === "role_confinement_violation",
    );
    const codeWritingFindings = findings.filter(
      (f) => f.violation_type === "coordinator_code_writing",
    );
    expect(testSuiteFindings).toHaveLength(1);
    expect(codeWritingFindings).toHaveLength(6);
  });
});

describe("auditSupervisorCodeContamination", () => {
  test("creates new findings array if omitted and skips non-supervisor grants", () => {
    const result = auditSupervisorCodeContamination(new Map(), [], [], []);
    expect(result).toEqual([]);

    const grants: AgentGrantRecord[] = [
      {
        id: "impl-1",
        role: "implementer",
        tools_used: [{ name: "write_to_file" }],
      } as unknown as AgentGrantRecord,
    ];
    const afterGrant = auditSupervisorCodeContamination(new Map(), grants, [], []);
    expect(afterGrant).toHaveLength(0);
  });

  test("detects supervisor tool contamination across mind, orch, and coordinator", () => {
    const existingFindings: TierConfinementFinding[] = [];
    const grants: AgentGrantRecord[] = [
      {
        id: "mind-1",
        role: "mind",
        tools_used: [{ name: "custom_writer", category: "file-edit" }],
      } as unknown as AgentGrantRecord,
      {
        id: "orch-1",
        role: "orchestrator",
        tools_used: [{ name: "replace_file_content" }],
      } as unknown as AgentGrantRecord,
      {
        id: "coord-1",
        role: "coordinator",
        tools_used: [{ name: "edit_file" }],
      } as unknown as AgentGrantRecord,
      {
        id: "orch-clean",
        role: "orchestrator",
        tools_used: [{ name: "read_file", category: "read" }],
      } as unknown as AgentGrantRecord,
    ];

    const findings = auditSupervisorCodeContamination(
      new Map(),
      grants,
      [],
      [],
      undefined,
      existingFindings,
    );
    expect(findings).toBe(existingFindings);
    expect(findings).toHaveLength(3);
    expect(findings[0]?.tier).toBe(0);
    expect(findings[1]?.tier).toBe(1);
    expect(findings[2]?.tier).toBe(2);
  });

  test("detects supervisor commands with edit tools and repository sha mutations", () => {
    const roleMap = new Map<string, string>([
      ["orch-1", "orchestrator"],
      ["impl-1", "implementer"],
    ]);
    const commands = [
      { id: "c-skip", actor: "impl-1", tool: "write_to_file" },
      { id: "c-edit-tool", actor: "orch-1", tool: "write_to_file" },
      {
        id: "c-sha-diff",
        actor: "orch-1",
        repository_before: { content_sha256: "aaaa1111" },
        repository_after: { content_sha256: "bbbb2222" },
      },
    ] as unknown as CommandRecord[];

    const findings = auditSupervisorCodeContamination(roleMap, [], commands, []);
    expect(
      findings.length >= 2 && findings.some((f) => f.evidence.command_id === "c-sha-diff"),
    ).toBe(true);
  });

  test("detects supervisor task leases and git diff modifications", () => {
    const roleMap = new Map<string, string>([
      ["agent-mind", "mind"],
      ["coord-custom", "coordinator"],
      ["impl-worker", "implementer"],
    ]);
    const tasks = [
      { id: "t-mind", lease: { agent_id: "x1", role: "mind" } },
      { id: "t-impl", lease: { agent_id: "x2", role: "implementer" } },
    ] as unknown as TaskRecord[];

    expect(auditSupervisorCodeContamination(roleMap, [], [], tasks)).toHaveLength(1);

    const gitDiffs = [
      { path: "src/worker.ts", actor: "impl-worker" },
      { path: "src/app.ts", actor: "agent-x", role: "orchestrator" },
      { path: "src/module.ts", actor: "coord-custom" },
      { path: "src/brain.ts", actor: "mind-lead" },
    ];
    const diffFindings = auditSupervisorCodeContamination(roleMap, [], [], [], gitDiffs);
    expect(diffFindings).toHaveLength(3);
    expect(diffFindings[0]?.evidence.file_path).toBe("src/app.ts");
  });
});
