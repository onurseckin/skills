import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  auditBehavioralHealth,
  formatBehavioralRoleHealthSection,
  isCoordinatorRole,
  isImplementerRole,
  isOrchestratorRole,
  isSubagentRole,
  isValidatorRole,
  summarizeBehavioralHealth,
} from "../../../olt/scripts/src/reporting/behavioral-auditor.ts";
import { runDoctor } from "../../../olt/scripts/src/reporting/doctor.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("behavioral role predicate helpers", () => {
  test("role classification predicates categorize standard roles accurately", () => {
    expect(isCoordinatorRole("coordinator")).toBe(true);
    expect(isCoordinatorRole("coordinator-backend")).toBe(true);
    expect(isCoordinatorRole("orchestrator")).toBe(false);

    expect(isOrchestratorRole("orchestrator")).toBe(true);
    expect(isOrchestratorRole("coordinator")).toBe(false);

    expect(isImplementerRole("implementer")).toBe(true);
    expect(isImplementerRole("repairer")).toBe(true);
    expect(isImplementerRole("sub-implementer")).toBe(true);
    expect(isImplementerRole("worker")).toBe(true);
    expect(isImplementerRole("validator")).toBe(false);

    expect(isValidatorRole("validator")).toBe(true);
    expect(isValidatorRole("sub-validator")).toBe(true);
    expect(isValidatorRole("plan-validator")).toBe(true);
    expect(isValidatorRole("completeness-critic")).toBe(true);
    expect(isValidatorRole("mind-auditor")).toBe(true);
    expect(isValidatorRole("implementer")).toBe(false);

    expect(isSubagentRole("coordinator")).toBe(true);
    expect(isSubagentRole("implementer")).toBe(true);
    expect(isSubagentRole("validator")).toBe(true);
    expect(isSubagentRole("human")).toBe(false);
  });
});

describe("behavioral evidence availability", () => {
  test("reports unavailable evidence for a corrupt claimed capsule instead of trusting caller state", async () => {
    const corruptRoot = await mkdtemp(join(tmpdir(), "harness-corrupt-capsule-"));
    roots.push(corruptRoot);
    const findings = auditBehavioralHealth(corruptRoot, { agents: [], tasks: {}, commands: {} });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.violation_type).toBe("behavioral_evidence_unavailable");
    expect(findings[0]?.severity).toBe("critical");
  });

  test("reports malformed agent authority explicitly", () => {
    const findings = auditBehavioralHealth("", {
      agents: [{ id: 7, role: "coordinator" }],
      tasks: {},
      commands: {},
    });
    expect(
      findings.some((finding) => finding.violation_type === "behavioral_evidence_unavailable"),
    ).toBe(true);
  });

  test("bounds a hostile authority failure without invoking its accessors", () => {
    const hostileError = new Proxy(
      {},
      {
        get: () => {
          throw new Error("hostile getter invoked");
        },
        getOwnPropertyDescriptor: () => {
          throw new Error("hostile descriptor invoked");
        },
      },
    );
    const hostileAgents = new Proxy([{}], {
      get: (_target, property) => {
        if (property === "0") throw hostileError;
        return Reflect.get(_target, property);
      },
    });
    const findings = auditBehavioralHealth("", {
      agents: hostileAgents,
      tasks: {},
      commands: {},
    } as unknown as JsonObject);
    const unavailable = findings.find(
      (finding) => finding.violation_type === "behavioral_evidence_unavailable",
    );
    expect(unavailable?.observation).toContain("unknown error");
  });
});

describe("behavioral health auditor - coordinator violations", () => {
  test("reports clean on compliant coordinator with no code editing or task leases", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "coord-1",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
          tools_used: [
            {
              name: "invoke_subagent",
              category: "shell",
              evidence_class: "agent_reported",
              first_reported_at: "2026-08-21T00:01:00.000Z",
            },
          ],
        },
      ],
      tasks: {},
      commands: {},
    };

    const findings = auditBehavioralHealth("", state);
    expect(findings).toHaveLength(0);
    const summary = summarizeBehavioralHealth(findings);
    expect(summary.healthy).toBe(true);
    expect(summary.violation_count).toBe(0);
  });

  test("detects coordinator writing code via tools_used in grant", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "coord-rogue",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
          tools_used: [
            {
              name: "write_to_file",
              category: "file-edit",
              evidence_class: "agent_reported",
              first_reported_at: "2026-08-21T00:02:00.000Z",
            },
          ],
        },
      ],
      tasks: {},
      commands: {},
    };

    const findings = auditBehavioralHealth("", state);
    expect(findings.length).toBeGreaterThan(0);
    const finding = findings.find((f) => f.violation_type === "coordinator_code_writing");
    expect(finding).toBeDefined();
    expect(finding?.agent_id).toBe("coord-rogue");
    expect(finding?.role).toBe("coordinator");
    expect(finding?.severity).toBe("critical");
    expect(finding?.observation).toContain("recorded usage of code-editing tool");
  });

  test("detects coordinator holding an active task implementation lease", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "coord-leased",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {
        "task-1": {
          id: "task-1",
          status: "leased",
          requirement_ids: ["R-1"],
          write_scope: ["src/foo.ts"],
          dependencies: [],
          attempts: [],
          history: [],
          repair_round: 0,
          lease: {
            agent_id: "coord-leased",
            role: "coordinator",
            attempt: 1,
            token_digest: "tok-1",
            issued_at: "2026-08-21T00:00:00.000Z",
            expires_at: "2026-08-21T01:00:00.000Z",
            heartbeat_at: "2026-08-21T00:00:00.000Z",
            duration_seconds: 3600,
            write_scope: ["src/foo.ts"],
            resource_scope: [],
          },
        },
      },
      commands: {},
    };

    const findings = auditBehavioralHealth("", state);
    const finding = findings.find(
      (f) => f.violation_type === "coordinator_code_writing" && f.agent_id === "coord-leased",
    );
    expect(finding).toBeDefined();
    expect(finding?.observation).toContain("holds direct implementation lease");
  });

  test("detects coordinator executing file-edit commands", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "coord-actor",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {},
      commands: {
        "cmd-1": {
          id: "cmd-1",
          actor: "coord-actor",
          tool: "replace_file_content",
          tool_category: "file-edit",
          argv: ["replace_file_content", "src/foo.ts"],
          status: "succeeded",
          started_at: "2026-08-21T00:00:00.000Z",
          finished_at: "2026-08-21T00:00:01.000Z",
          fingerprint: "fp-1",
        },
      },
    };

    const findings = auditBehavioralHealth("", state);
    const finding = findings.find((f) => f.violation_type === "coordinator_code_writing");
    expect(finding).toBeDefined();
    expect(finding?.observation).toContain("executed file modification");
  });

  test("detects coordinator running full test suite (defect-20260822-20)", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "coord-runner",
          role: "coordinator",
          parent_agent_id: "orch-1",
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {},
      commands: {
        "cmd-full-suite": {
          id: "cmd-full-suite",
          actor: "coord-runner",
          argv: ["bun", "test", "--coverage"],
          status: "succeeded",
          started_at: "2026-08-21T00:00:00.000Z",
          finished_at: "2026-08-21T00:00:01.000Z",
          fingerprint: "fp-c",
        },
      },
    };

    const findings = auditBehavioralHealth("", state);
    const finding = findings.find((f) => f.violation_type === "role_confinement_violation");
    expect(finding).toBeDefined();
    expect(finding?.agent_id).toBe("coord-runner");
    expect(finding?.severity).toBe("critical");
    expect(finding?.observation).toContain("executed prohibited full test suite command");
  });
});

describe("behavioral health auditor - orchestrator violations", () => {
  test("detects orchestrator executing task-level command directly", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "orch-1",
          role: "orchestrator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {},
      commands: {
        "cmd-orch-task": {
          id: "cmd-orch-task",
          actor: "orch-1",
          task_id: "task-backend-core",
          argv: ["bun", "test", "src/core.test.ts"],
          status: "succeeded",
          started_at: "2026-08-21T00:00:00.000Z",
          finished_at: "2026-08-21T00:00:01.000Z",
          fingerprint: "fp-orch",
        },
      },
    };

    const findings = auditBehavioralHealth("", state);
    const finding = findings.find((f) => f.violation_type === "orchestrator_direct_implementation");
    expect(finding).toBeDefined();
    expect(finding?.agent_id).toBe("orch-1");
    expect(finding?.observation).toContain("directly executed command");
    expect(finding?.observation).toContain("task-backend-core");
  });

  test("detects orchestrator directly mutating graph planning via plan:compile", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "orch-planner",
          role: "orchestrator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {},
      commands: {
        "cmd-orch-plan": {
          id: "cmd-orch-plan",
          actor: "orch-planner",
          argv: ["bun", "harness.ts", "plan:compile", "--run", "/tmp/run"],
          status: "succeeded",
          started_at: "2026-08-21T00:00:00.000Z",
          finished_at: "2026-08-21T00:00:01.000Z",
          fingerprint: "fp-plan",
        },
      },
    };

    const findings = auditBehavioralHealth("", state);
    const finding = findings.find((f) => f.violation_type === "orchestrator_direct_implementation");
    expect(finding).toBeDefined();
    expect(finding?.observation).toContain("attempted direct task graph planning/mutation");
  });

  test("detects orchestrator holding a task lease", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "orch-leased",
          role: "orchestrator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {
        "task-orch-1": {
          id: "task-orch-1",
          status: "leased",
          requirement_ids: ["R-1"],
          write_scope: ["src/**"],
          dependencies: [],
          attempts: [],
          history: [],
          repair_round: 0,
          lease: {
            agent_id: "orch-leased",
            role: "orchestrator",
            attempt: 1,
            token_digest: "tok-o",
            issued_at: "2026-08-21T00:00:00.000Z",
            expires_at: "2026-08-21T01:00:00.000Z",
            heartbeat_at: "2026-08-21T00:00:00.000Z",
            duration_seconds: 3600,
            write_scope: ["src/**"],
            resource_scope: [],
          },
        },
      },
      commands: {},
    };

    const findings = auditBehavioralHealth("", state);
    const finding = findings.find((f) => f.violation_type === "orchestrator_direct_implementation");
    expect(finding).toBeDefined();
    expect(finding?.observation).toContain("holds task lease for task");
  });

  test("detects orchestrator running full test suite (defect-20260822-20)", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "orch-runner",
          role: "orchestrator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {},
      commands: {
        "cmd-orch-suite": {
          id: "cmd-orch-suite",
          actor: "orch-runner",
          argv: ["bun", "test"],
          status: "succeeded",
          started_at: "2026-08-21T00:00:00.000Z",
          finished_at: "2026-08-21T00:00:01.000Z",
          fingerprint: "fp-o",
        },
      },
    };

    const findings = auditBehavioralHealth("", state);
    const finding = findings.find((f) => f.violation_type === "role_confinement_violation");
    expect(finding).toBeDefined();
    expect(finding?.agent_id).toBe("orch-runner");
    expect(finding?.severity).toBe("critical");
    expect(finding?.observation).toContain("executed prohibited full test suite command");
  });
});

describe("behavioral health auditor - implementer self-grading and topology mutations", () => {
  test("detects implementer grading own work via validation review record", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "impl-1",
          role: "implementer",
          parent_agent_id: "coord-1",
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {
        "task-self-grade": {
          id: "task-self-grade",
          status: "validated",
          requirement_ids: ["R-1"],
          write_scope: ["src/feature.ts"],
          dependencies: [],
          original_implementer: "impl-1",
          attempts: [
            {
              agent_id: "impl-1",
              role: "implementer",
              kind: "implementation",
              attempt: 1,
            },
          ],
          history: [],
          repair_round: 0,
          validations: [
            {
              validator_id: "impl-1",
              domain: "code-quality",
              token_digest: "v-token",
              attempt: 1,
              started_at: "2026-08-21T00:05:00.000Z",
              deadline_at: "2026-08-21T00:15:00.000Z",
              verdict: "pass",
            },
          ],
        },
      },
      commands: {},
    };

    const findings = auditBehavioralHealth("", state);
    const finding = findings.find((f) => f.violation_type === "implementer_self_grading");
    expect(finding).toBeDefined();
    expect(finding?.agent_id).toBe("impl-1");
    expect(finding?.observation).toContain("performed validation review for task");
  });

  test("detects implementer executing validation command task:review", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "impl-auditor",
          role: "implementer",
          parent_agent_id: "coord-1",
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {},
      commands: {
        "cmd-val-run": {
          id: "cmd-val-run",
          actor: "impl-auditor",
          argv: ["bun", "harness.ts", "task:review", "--task", "task-1", "--verdict", "pass"],
          status: "succeeded",
          started_at: "2026-08-21T00:00:00.000Z",
          finished_at: "2026-08-21T00:00:01.000Z",
          fingerprint: "fp-v",
        },
      },
    };

    const findings = auditBehavioralHealth("", state);
    const finding = findings.find((f) => f.violation_type === "implementer_self_grading");
    expect(finding).toBeDefined();
    expect(finding?.observation).toContain("executed validation/grading command");
  });

  test("detects implementer attempting to mutate graph topology via plan:add", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "impl-planner",
          role: "implementer",
          parent_agent_id: "coord-1",
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {},
      commands: {
        "cmd-graph-mutation": {
          id: "cmd-graph-mutation",
          actor: "impl-planner",
          argv: ["bun", "harness.ts", "plan:add", "--task", "task-rogue"],
          status: "succeeded",
          started_at: "2026-08-21T00:00:00.000Z",
          finished_at: "2026-08-21T00:00:01.000Z",
          fingerprint: "fp-mut",
        },
      },
    };

    const findings = auditBehavioralHealth("", state);
    const finding = findings.find((f) => f.violation_type === "implementer_graph_mutation");
    expect(finding).toBeDefined();
    expect(finding?.observation).toContain("attempted to mutate graph topology");
  });
});

describe("behavioral health auditor - subagent pulse and scheduler termination", () => {
  test("detects subagent executing mind:pulse-close with terminal arguments", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "coord-closer",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {},
      commands: {
        "cmd-close-pulse": {
          id: "cmd-close-pulse",
          actor: "coord-closer",
          argv: [
            "bun",
            "harness.ts",
            "mind:pulse-close",
            "--run",
            "/tmp/run",
            "--outcome",
            "halted",
            "--terminal-reason",
            "done for today",
          ],
          status: "succeeded",
          started_at: "2026-08-21T00:00:00.000Z",
          finished_at: "2026-08-21T00:00:01.000Z",
          fingerprint: "fp-close",
        },
      },
    };

    const findings = auditBehavioralHealth("", state);
    const finding = findings.find((f) => f.violation_type === "subagent_pulse_termination");
    expect(finding).toBeDefined();
    expect(finding?.agent_id).toBe("coord-closer");
    expect(finding?.observation).toContain("executed mind:pulse-close with terminal arguments");
  });

  test("detects subagent attempting to kill pulse or scheduler process", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "impl-killer",
          role: "implementer",
          parent_agent_id: "coord-1",
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {},
      commands: {
        "cmd-kill-proc": {
          id: "cmd-kill-proc",
          actor: "impl-killer",
          argv: ["pkill", "-f", "pulse.sh"],
          status: "succeeded",
          started_at: "2026-08-21T00:00:00.000Z",
          finished_at: "2026-08-21T00:00:01.000Z",
          fingerprint: "fp-kill",
        },
      },
    };

    const findings = auditBehavioralHealth("", state);
    const finding = findings.find((f) => f.violation_type === "subagent_pulse_termination");
    expect(finding).toBeDefined();
    expect(finding?.observation).toContain("attempting to terminate scheduler/daemon process");
  });

  test("detects pulse closed with terminal outcome in state.pulse.last", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "sub-agent-1",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
        },
      ],
      pulse: {
        last: {
          pulse_id: "pulse-99",
          actor: "sub-agent-1",
          outcome: "halted",
          terminal_reason: "premature stop",
        },
      },
      tasks: {},
      commands: {},
    };

    const findings = auditBehavioralHealth("", state);
    const finding = findings.find((f) => f.violation_type === "subagent_pulse_termination");
    expect(finding).toBeDefined();
    expect(finding?.observation).toContain("terminated mind pulse loop with outcome");
  });
});

describe("doctor integration and markdown rendering", () => {
  test("formatBehavioralRoleHealthSection produces clean output when zero violations", () => {
    const md = formatBehavioralRoleHealthSection([]);
    expect(md).toContain("### Behavioral Role Health");
    expect(md).toContain("- **Status**: clean (0 violations)");
    expect(md).toContain("- **Role Segregation**: verified");
  });

  test("formatBehavioralRoleHealthSection lists all findings with remediation", () => {
    const md = formatBehavioralRoleHealthSection([
      {
        agent_id: "coord-bad",
        role: "coordinator",
        violation_type: "coordinator_code_writing",
        severity: "critical",
        observation: "Coordinator wrote code directly",
        remediation: "Delegate to implementers",
      },
    ]);
    expect(md).toContain("### Behavioral Role Health");
    expect(md).toContain("- **Status**: violations detected (1)");
    expect(md).toContain("[critical]");
    expect(md).toContain("coord-bad");
    expect(md).toContain("Coordinator wrote code directly");
    expect(md).toContain("Delegate to implementers");
  });

  test("runDoctor integrates behavioral health findings into healthy flag and markdown report", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-doctor-behav-"));
    roots.push(repo);
    const runRoot = initRun(
      repo,
      "behav-doctor-run",
      new TextEncoder().encode("Behavioral test prompt"),
      "file",
      true,
    );

    // Record a compliant state
    transact(runRoot, "coord-1", "agent-registered", {}, (draft) => {
      draft.agents = [
        {
          id: "coord-1",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
        },
      ];
    });

    const cleanReport = await runDoctor(runRoot);
    expect(cleanReport.healthy).toBe(true);
    expect(cleanReport.behavioral_findings).toEqual([]);
    expect(cleanReport.behavioral_issues).toEqual([]);
    expect(typeof cleanReport.markdown).toBe("string");
    expect(cleanReport.markdown as string).toContain("### Behavioral Role Health");
    expect(cleanReport.markdown as string).toContain("clean (0 violations)");

    // Inject a behavioral violation
    transact(runRoot, "coord-1", "agent-reported", {}, (draft) => {
      const workingDraft = draft as unknown as {
        agents: {
          id: string;
          role: string;
          tools_used: {
            name: string;
            category: string;
            evidence_class: string;
            first_reported_at: string;
          }[];
        }[];
      };
      if (workingDraft.agents[0]) {
        workingDraft.agents[0].tools_used = [
          {
            name: "write_to_file",
            category: "file-edit",
            evidence_class: "agent_reported",
            first_reported_at: "2026-08-21T00:01:00.000Z",
          },
        ];
      }
    });

    const dirtyReport = await runDoctor(runRoot);
    expect(dirtyReport.healthy).toBe(false);
    expect(Array.isArray(dirtyReport.behavioral_findings)).toBe(true);
    expect((dirtyReport.behavioral_findings as unknown[]).length).toBeGreaterThan(0);
    expect(
      (dirtyReport.issues as string[]).some(
        (issue) =>
          issue.includes("coordinator_code_writing") ||
          issue.includes("recorded usage of code-editing tool"),
      ),
    ).toBe(true);
    expect(dirtyReport.markdown as string).toContain("violations detected");
  });

  test("auditBehavioralHealth loads state from disk capsuleRoot when state is omitted", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-doctor-load-"));
    roots.push(repo);
    const runRoot = initRun(
      repo,
      "behav-load-run",
      new TextEncoder().encode("Behavioral load test prompt"),
      "file",
      true,
    );

    transact(runRoot, "coord-1", "plan-compiled", { task_id: "t1" }, (draft) => {
      draft.agents = [
        {
          id: "coord-1",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
        },
      ];
    });

    const findings = auditBehavioralHealth(runRoot);
    expect(findings).toEqual([]);
  });

  test("inferRole correctly infers role from packets, tasks, attempts, and regex prefixes", () => {
    const state: JsonObject = {
      packets: {
        "p-1": { agent_id: "custom-packet-agent", role: "implementer" },
      },
      tasks: {
        "t-1": {
          id: "t-1",
          lease: { agent_id: "custom-lease-agent", role: "validator" },
          attempts: [{ agent_id: "custom-attempt-agent", role: "implementer" }],
        },
      },
      commands: {
        "cmd-kill-sub": {
          id: "cmd-kill-sub",
          actor: "custom-packet-agent",
          argv: ["kill", "pulse.sh"],
          status: "succeeded",
          started_at: "2026-08-21T00:00:00.000Z",
          finished_at: "2026-08-21T00:00:01.000Z",
        },
      },
    };

    const findings = auditBehavioralHealth("", state);
    expect(findings.length).toBeGreaterThan(0);
  });

  test("detects coordinator with unauthorized code-editing tool in tools_granted", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "coord-granted",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
          tools_granted: {
            evidence_class: "harness_observed",
            value: [{ name: "write_to_file", category: "file-edit" }],
          },
        },
      ],
      tasks: {},
      commands: {},
    };

    const findings = auditBehavioralHealth("", state);
    const finding = findings.find((f) => f.agent_id === "coord-granted");
    expect(finding).toBeDefined();
    expect(finding?.observation).toContain("holds unauthorized grant for code-editing tool");
  });

  test("detects orchestrator tool usage and command executions editing files", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "orch-edit",
          role: "orchestrator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
          tools_used: [
            {
              name: "replace_file_content",
              category: "file-edit",
              evidence_class: "agent_reported",
              first_reported_at: "2026-08-21T00:00:00.000Z",
            },
          ],
        },
      ],
      tasks: {},
      commands: {
        "cmd-orch-edit": {
          id: "cmd-orch-edit",
          actor: "orch-edit",
          tool: "replace_file_content",
          tool_category: "file-edit",
          argv: ["replace_file_content", "src/code.ts"],
          status: "succeeded",
          started_at: "2026-08-21T00:00:00.000Z",
          finished_at: "2026-08-21T00:00:01.000Z",
        },
      },
    };

    const findings = auditBehavioralHealth("", state);
    expect(findings.some((f) => f.violation_type === "orchestrator_direct_implementation")).toBe(
      true,
    );
  });

  test("detects implementer self-grading via history and graph mutation events", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "impl-hist",
          role: "implementer",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {
        "t-hist": {
          id: "t-hist",
          history: [{ from: "ready", to: "submitted", actor: "impl-hist" }],
          validations: [{ validator_id: "impl-hist", verdict: "pass" }],
        },
      },
      commands: {},
    };

    const findings = auditBehavioralHealth("", state);
    expect(findings.some((f) => f.violation_type === "implementer_self_grading")).toBe(true);
  });

  test("detects implementer emitting graph topology mutation events", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-events-test-"));
    roots.push(repo);
    const runRoot = initRun(
      repo,
      "event-audit-run",
      new TextEncoder().encode("Event prompt"),
      "file",
      true,
    );

    transact(runRoot, "impl-event", "agent-registered", {}, (draft) => {
      draft.agents = [
        {
          id: "impl-event",
          role: "implementer",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
        },
      ];
    });

    transact(runRoot, "impl-event", "plan-compiled", { plan_id: "plan-1" }, () => {});
    transact(runRoot, "impl-event", "plan-applied", { plan_id: "plan-1" }, () => {});
    transact(runRoot, "impl-event", "plan-enhanced", { plan_id: "plan-1" }, () => {});
    transact(runRoot, "impl-event", "plan-replan-requested", { plan_id: "plan-1" }, () => {});
    transact(runRoot, "impl-event", "mind-candidate-recorded", { candidate_id: "c-1" }, () => {});

    const findings = auditBehavioralHealth(runRoot);
    const graphFindings = findings.filter((f) => f.violation_type === "implementer_graph_mutation");
    expect(graphFindings.length).toBeGreaterThan(0);
  });

  test("detects subagent command attempting to kill or stop scheduler or daemon", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "subagent-killer",
          role: "coordinator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-21T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {},
      commands: {
        "cmd-stop-service": {
          id: "cmd-stop-service",
          actor: "subagent-killer",
          argv: ["systemctl", "stop", "mind.service"],
          status: "succeeded",
          started_at: "2026-08-21T00:00:00.000Z",
          finished_at: "2026-08-21T00:00:01.000Z",
        },
      },
    };

    const findings = auditBehavioralHealth("", state);
    expect(findings.some((f) => f.violation_type === "subagent_pulse_termination")).toBe(true);
  });

  test("infers role from packets, leases, attempts, and regex names during pulse audit", () => {
    const state: JsonObject = {
      agents: [],
      packets: {
        "p-1": { agent_id: "unreg-packet-actor", role: "coordinator" },
      },
      tasks: {
        "t-1": {
          lease: { agent_id: "unreg-lease-actor", role: "implementer" },
          attempts: [{ agent_id: "unreg-attempt-actor", role: "validator" }],
        },
      },
      commands: {
        "cmd-1": {
          id: "cmd-1",
          actor: "unreg-packet-actor",
          argv: ["kill", "pulse.sh"],
          status: "succeeded",
        },
        "cmd-2": {
          id: "cmd-2",
          actor: "unreg-lease-actor",
          argv: ["kill", "pulse.sh"],
          status: "succeeded",
        },
        "cmd-3": {
          id: "cmd-3",
          actor: "unreg-attempt-actor",
          argv: ["kill", "pulse.sh"],
          status: "succeeded",
        },
        "cmd-4": {
          id: "cmd-4",
          actor: "worker-99",
          argv: ["kill", "pulse.sh"],
          status: "succeeded",
        },
      },
    };

    const findings = auditBehavioralHealth("", state);
    const pulseFindings = findings.filter((f) => f.violation_type === "subagent_pulse_termination");
    expect(pulseFindings.length).toBe(4);
  });
});
