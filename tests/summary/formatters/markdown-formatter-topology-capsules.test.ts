import { afterEach, describe, expect, test } from "bun:test";
import type { CommandRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { TimelineEventRecord } from "../../../olt/scripts/src/summary/metrics/index.ts";
import { cleanupRoots, emptyState, render, task } from "./markdown-fixtures-core.ts";

afterEach(cleanupRoots);

describe("markdown report: evidence travels with every value", () => {
  test("a command with no exit code renders unknown rather than a zero", () => {
    const command: CommandRecord = {
      id: "C-1",
      argv: ["bun", "test"],
      cwd: "/repo",
      cwd_relative: ".",
      repository_root: "/repo",
      status: "running",
      task_id: null,
      gate_id: null,
      started_at: "2026-08-20T00:00:00.000Z",
      finished_at: null,
      exit_code: null,
      signal: null,
      fingerprint: "f",
      attempt_signing_public_key: "k",
      record_path: "commands/C-1/record.json",
      actor: "worker-1",
    };
    const markdown = render(emptyState, { commands: { "C-1": command } });
    expect(markdown).toContain(
      "| `C-1` | `bun test` | `worker-1` | - | - | running | unknown | unknown |",
    );
  });

  test("a probe without a recorded round, and an open defect, both stay honest", () => {
    const markdown = render({
      ...emptyState,
      tasks: {
        "task-1": task({
          id: "task-1",
          label: "First",
          findings: [
            {
              id: "probe-1",
              class: "probe_demand",
              requirement_id: "req-1",
              severity: "minor",
              observation: "Prove it",
              evidence: [],
              remediation: "Answer the demand",
              revalidation: "cite a command",
              status: "open",
            },
            {
              id: "defect-1",
              requirement_id: "req-1",
              severity: "critical",
              observation: "It is broken",
              evidence: [],
              remediation: "Fix it",
              revalidation: "rerun the gate",
              status: "open",
            },
          ],
        }),
      },
    });
    expect(markdown).toContain(
      "| `task-1` | unknown | `probe-1` | Prove it | minor | Answer the demand | cite a command | unknown | open | unknown | open |",
    );
    expect(markdown).toContain("| `task-1` | `defect-1` | critical | It is broken |");
  });

  test("host-reported telemetry keeps its label and an ungranted agent stays unknown", () => {
    const markdown = render({
      ...emptyState,
      agents: [
        {
          id: "worker-1",
          role: "implementer",
          parent_agent_id: null,
          parent_task_id: null,
          host: "claude-code",
          granted_at: "2026-08-20T00:00:00.000Z",
          status: "active",
          model: { value: "test-model", evidence_class: "host_reported" },
          tokens_in: { value: 10, evidence_class: "host_reported" },
          token_extras: { cache_read: { value: 7, evidence_class: "host_reported" } },
          tools_granted: {
            value: [{ name: "Bash", category: "shell" }],
            evidence_class: "agent_reported",
          },
        },
        {
          id: "worker-2",
          role: "implementer",
          parent_agent_id: "worker-1",
          parent_task_id: null,
          host: "claude-code",
          granted_at: "2026-08-20T00:00:01.000Z",
          status: "released",
          released_at: "2026-08-20T00:00:02.000Z",
          release_reason: "done",
        },
      ],
    });
    expect(markdown).toContain("test-model (host_reported)");
    expect(markdown).toContain("| `worker-1` | `cache_read` | 7 (host_reported) |");
    expect(markdown).toContain("`Bash (shell)`");
    expect(markdown).toContain(
      "| `worker-2` | implementer | unknown | unknown | unknown | unknown | unknown | unknown |",
    );
    expect(markdown).toContain("| Tokens in | 1,000 | derived, estimate |");
  });

  test("the critic's unproven requirements and residual risks are reported as recorded", () => {
    const markdown = render({
      ...emptyState,
      completion_critic: {
        critic_id: "critic-1",
        token_digest: "d",
        attempt: 1,
        status: "reviewed",
        started_at: "2026-08-20T00:00:00.000Z",
        deadline_at: "2026-08-20T01:00:00.000Z",
        readiness_sha256: "r",
        repository_binding: {},
      },
      completion_review: {
        critic_id: "critic-1",
        packet_id: "P-1",
        graph_revision: 1,
        readiness_sha256: "r",
        repository_binding: {},
        status: "findings",
        unresolved_finding_ids: ["F-1"],
        findings: [
          {
            id: "F-1",
            requirement_id: "req-1",
            severity: "critical",
            observation: "the drawer never renders",
            evidence: [],
            remediation: "wire the drawer",
            revalidation: "bun test src",
          },
        ],
        requirement_proofs: [
          {
            requirement_id: "req-2",
            status: "unproven",
            evidence: [{ kind: "command", reference: "C-1", observation: "the gate ran" }],
          },
        ],
        residual_risks: [
          {
            id: "R-1",
            severity: "minor",
            description: "the fixture predates the schema",
            disposition: "accepted",
            rationale: "regenerated next wave",
            evidence: [],
          },
        ],
        integrity_evidence: [],
        repository_command_ids: [],
        checks: [],
        reviewed_at: "2026-08-20T00:30:00.000Z",
        review_sha256: "s",
      },
      completion_remediations: [
        {
          actor: "coordinator-1",
          review_sha256: "s",
          resolutions: [{ finding_id: "F-1", method: "verification_passed", command_ids: ["C-1"] }],
          recorded_at: "2026-08-20T00:40:00.000Z",
          remediation_sha256: "m",
        },
      ],
    });
    expect(markdown).toContain("| Verdict | findings |");
    expect(markdown).toContain("| `req-2` | unproven | command C-1 |");
    expect(markdown).toContain("the drawer never renders");
    expect(markdown).toContain("the fixture predates the schema");
    expect(markdown).toContain("| `coordinator-1` | 2026-08-20T00:40:00.000Z | `F-1` |");
    expect(markdown).toContain("| Run completion | unknown |");
  });

  test("an abandoned branch keeps its reason, its recovery and its unmeasured file list", () => {
    const markdown = render({
      ...emptyState,
      tasks: { "task-1": task({ id: "task-1", label: "First" }) },
      branches: [
        {
          id: "B-1",
          parent_task_id: "task-1",
          parent_agent_id: "worker-1",
          reason: "the fix needed a second pair of hands",
          depth: 1,
          status: "abandoned",
          opened_at: "2026-08-20T00:00:00.000Z",
          abandoned_at: "2026-08-20T00:10:00.000Z",
          sub_tasks: [
            {
              id: "S-1",
              label: "Chase the failure",
              write_scope: ["src/one"],
              status: "abandoned",
              agent_id: "sub-1",
              recovery: {
                recovered_at: "2026-08-20T00:05:00.000Z",
                expired_agent_id: "sub-0",
                expired_at: "2026-08-20T00:04:00.000Z",
              },
            },
          ],
          opened_observation: {
            observed_at: "2026-08-20T00:00:00.000Z",
            git_available: false,
            head: null,
            entries: [],
          },
        },
      ],
    });
    expect(markdown).toContain("the fix needed a second pair of hands");
    expect(markdown).toContain("| Files changed | unknown |");
    expect(markdown).toContain("| Worktree at open | the repository could not be observed |");
    expect(markdown).toContain("| Worktree at collect | unknown |");
    expect(markdown).toContain("was reclaimed at 2026-08-20T00:05:00.000Z from sub-0");
    expect(markdown).toContain("\\__ branch B-1 [abandoned]");
  });

  test("requirements recorded as the runtime array are rendered too", () => {
    const markdown = render({
      ...emptyState,
      requirements: [{ id: "req-1", status: "satisfied", evidence: ["task:task-1"] }],
    });
    expect(markdown).toContain("| `req-1` | satisfied | unknown | unknown |");
    expect(markdown).toContain("task:task-1");
  });

  test("a task with no recorded transitions says so", () => {
    const markdown = render({
      ...emptyState,
      tasks: { "task-1": task({ id: "task-1", label: "First" }) },
    });
    expect(markdown).toContain("No transitions were recorded.");
  });

  test("timeline rows carry the round when the event recorded one", () => {
    const timeline: TimelineEventRecord[] = [
      {
        sequence: 1,
        timestamp: "2026-08-20T00:00:00.000Z",
        actor: "validator-1",
        event: "probe-recorded",
        phase: "validation",
        summary: "probe recorded",
        task_id: "task-1",
        round: 2,
      },
    ];
    const markdown = render(emptyState, { timeline });
    expect(markdown).toContain(
      "| 1 | 2026-08-20T00:00:00.000Z | validation | `validator-1` | `probe-recorded` | probe recorded | `task-1` | 2 |",
    );
  });
});
