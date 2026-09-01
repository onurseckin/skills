import { describe, expect, it } from "bun:test";
import type {
  AgentGrantRecord,
  AgentToolUse,
  CommandRecord,
} from "../../../olt/scripts/src/core/contracts/index.ts";
import { auditCoordinatorCodeWriting } from "../../../olt/scripts/src/reporting/doctor/rules/index.ts";
import type { BehavioralFinding } from "../../../olt/scripts/src/reporting/behavioral-auditor/index.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/index.ts";

export const behavioralHealthCoreSuiteName =
  "Behavioral Health Auditor - Coordinator Behavioral Invariants";

describe(behavioralHealthCoreSuiteName, () => {
  it("detects coordinator using code-editing tools directly", () => {
    const roleMap = new Map<string, string>([["coord-1", "coordinator"]]);
    const grants: AgentGrantRecord[] = [
      {
        id: "coord-1",
        role: "coordinator",
        model: "claude-3-5",
        status: "active",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        tools_used: [
          {
            name: "replace_file_content",
            category: "file-edit",
            call_count: 3,
            first_reported_at: new Date().toISOString(),
          } as AgentToolUse,
        ],
      },
    ];
    const commands: CommandRecord[] = [];
    const tasks: TaskRecord[] = [];
    const findings: BehavioralFinding[] = [];

    auditCoordinatorCodeWriting(roleMap, grants, commands, tasks, findings);

    expect(findings.length).toBe(1);
    expect(findings[0]?.violation_type).toBe("coordinator_code_writing");
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.agent_id).toBe("coord-1");
  });

  it("detects coordinator holding unauthorized file-editing tool grants", () => {
    const roleMap = new Map<string, string>([["coord-2", "coordinator"]]);
    const grants: AgentGrantRecord[] = [
      {
        id: "coord-2",
        role: "coordinator",
        model: "claude-3-5",
        status: "active",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        tools_granted: {
          value: [
            {
              name: "write_to_file",
              category: "file-edit",
            },
          ],
        },
      },
    ];
    const commands: CommandRecord[] = [];
    const tasks: TaskRecord[] = [];
    const findings: BehavioralFinding[] = [];

    auditCoordinatorCodeWriting(roleMap, grants, commands, tasks, findings);

    expect(findings.length).toBe(1);
    expect(findings[0]?.violation_type).toBe("coordinator_code_writing");
    expect(findings[0]?.observation).toContain("unauthorized grant");
  });

  it("detects coordinator executing file-editing commands or tools", () => {
    const roleMap = new Map<string, string>([["coord-3", "coordinator"]]);
    const grants: AgentGrantRecord[] = [];
    const commands: CommandRecord[] = [
      {
        id: "cmd-edit-1",
        actor: "coord-3",
        tool: "replace_file_content",
        tool_category: "file-edit",
        argv: ["replace_file_content", "src/foo.ts"],
        created_at: new Date().toISOString(),
      } as CommandRecord,
    ];
    const tasks: TaskRecord[] = [];
    const findings: BehavioralFinding[] = [];

    auditCoordinatorCodeWriting(roleMap, grants, commands, tasks, findings);

    expect(findings.length).toBe(1);
    expect(findings[0]?.violation_type).toBe("coordinator_code_writing");
    expect(findings[0]?.evidence?.command_id).toBe("cmd-edit-1");
  });

  it("detects coordinator executing prohibited full test suite commands", () => {
    const roleMap = new Map<string, string>([["coord-4", "coordinator"]]);
    const grants: AgentGrantRecord[] = [];
    const commands: CommandRecord[] = [
      {
        id: "cmd-test-all",
        actor: "coord-4",
        argv: ["bun", "test"],
        created_at: new Date().toISOString(),
      } as CommandRecord,
    ];
    const tasks: TaskRecord[] = [];
    const findings: BehavioralFinding[] = [];

    auditCoordinatorCodeWriting(roleMap, grants, commands, tasks, findings);

    expect(findings.length).toBe(1);
    expect(findings[0]?.violation_type).toBe("role_confinement_violation");
    expect(findings[0]?.observation).toContain("prohibited full test suite");
  });

  it("detects coordinator holding direct implementation task lease", () => {
    const roleMap = new Map<string, string>([["coord-5", "coordinator"]]);
    const grants: AgentGrantRecord[] = [];
    const commands: CommandRecord[] = [];
    const tasks: TaskRecord[] = [
      {
        id: "task-impl-1",
        label: "Implement widget",
        role: "implementer",
        status: "leased",
        lease: {
          agent_id: "coord-5",
          role: "coordinator",
          issued_at: new Date().toISOString(),
          heartbeat_at: new Date().toISOString(),
        },
      } as TaskRecord,
    ];
    const findings: BehavioralFinding[] = [];

    auditCoordinatorCodeWriting(roleMap, grants, commands, tasks, findings);

    expect(findings.length).toBe(1);
    expect(findings[0]?.violation_type).toBe("coordinator_code_writing");
    expect(findings[0]?.observation).toContain("holds direct implementation lease");
  });

  it("passes cleanly when coordinator behaves strictly according to protocol", () => {
    const roleMap = new Map<string, string>([["coord-clean", "coordinator"]]);
    const grants: AgentGrantRecord[] = [
      {
        id: "coord-clean",
        role: "coordinator",
        model: "claude-3-5",
        status: "active",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        tools_granted: {
          value: [
            {
              name: "invoke_subagent",
              category: "agent",
            },
          ],
        },
      },
    ];
    const commands: CommandRecord[] = [
      {
        id: "cmd-clean-1",
        actor: "coord-clean",
        argv: ["olt", "agent:brief"],
        created_at: new Date().toISOString(),
      } as CommandRecord,
    ];
    const tasks: TaskRecord[] = [];
    const findings: BehavioralFinding[] = [];

    auditCoordinatorCodeWriting(roleMap, grants, commands, tasks, findings);

    expect(findings.length).toBe(0);
  });
});
