import { describe, expect, test } from "bun:test";
import {
  publishCriticRolePacket,
  repositoryEvidenceCommandIds,
  type CriticRoleGrant,
} from "../../olt/scripts/src/packets/critic-grant.ts";
import { loadRun, transact } from "../../olt/scripts/src/engine/store/index.ts";
import { workflowPort } from "../../olt/scripts/src/integration/store-ports.ts";
import { completionReadinessSnapshot } from "../../olt/scripts/src/workflow/completion/readiness-snapshot.ts";
import { tokenDigest } from "../../olt/scripts/src/workflow/lease/token.ts";
import { TestPort, commandRecord, workflowState } from "../workflow/test-port.ts";
import {
  emptyGrantRun,
  seedRepositoryInspection,
  seedRunGateCommand,
  seedSingleTaskGraph,
} from "./grant-run-fixture.ts";

const TOKEN = "critic-token";

function setCompletionCritic(run: string, overrides: Record<string, unknown> = {}): void {
  transact(run, "test-setup", "assign-critic", {}, (draft) => {
    const authorization = {
      critic_id: "critic-1",
      token_digest: tokenDigest(TOKEN),
      attempt: 1,
      status: "assigned",
      started_at: new Date().toISOString(),
      // Fixed, far-future instant rather than a clock read: publishCriticRolePacket checks this
      // against the real system clock with no injectable override, so a "now + 60s" value
      // computed once at module load risks having already elapsed by the time a busy parallel
      // run reaches this test. A constant this far out never can.
      deadline_at: "2099-01-01T00:00:00.000Z",
      readiness_sha256: "0".repeat(64),
      repository_binding: (draft.current_repository_binding as Record<string, unknown>) ?? {},
      ...overrides,
    };
    draft.completion_critic = authorization;
    draft.completion_critic_history = [authorization];
  });
}

describe("repositoryEvidenceCommandIds", () => {
  test("is empty when no command runs against a run-scoped gate", () => {
    const state = workflowState();
    expect(repositoryEvidenceCommandIds(state)).toEqual([]);
  });
});

describe("publishCriticRolePacket", () => {
  test("rejects when the run has no completeness critic authorization", async () => {
    const { run } = await emptyGrantRun("critic-grant-no-auth-");
    seedSingleTaskGraph(run);
    const grant: CriticRoleGrant = {
      runRoot: run,
      port: workflowPort(run),
      criticId: "critic-1",
      token: TOKEN,
    };
    await expect(publishCriticRolePacket(grant)).rejects.toThrow(
      "completeness critic authorization is missing",
    );
  });

  test("rejects when the raw capsule has no applied plan for planHistory to read", async () => {
    const { run } = await emptyGrantRun("critic-grant-no-plan-");
    await seedRepositoryInspection(run, "critic-1");
    // Deliberately not seeding a graph on the real capsule: an injected port lets the
    // authorization check pass while loadRun(run).state.graph stays undefined, isolating
    // planHistory's own guard from the port's separate, stricter graph validation.
    const port = new TestPort({
      ...workflowState(),
      completion_critic: { critic_id: "critic-1" } as never,
    });
    const grant: CriticRoleGrant = { runRoot: run, port, criticId: "critic-1", token: TOKEN };
    await expect(publishCriticRolePacket(grant)).rejects.toThrow(
      "the critic packet needs an applied plan",
    );
  });

  test("rejects when the run has no authoritative run-gate command as repository evidence", async () => {
    const { run } = await emptyGrantRun("critic-grant-no-evidence-");
    seedSingleTaskGraph(run);
    await seedRepositoryInspection(run, "critic-1");
    setCompletionCritic(run);
    const grant: CriticRoleGrant = {
      runRoot: run,
      port: workflowPort(run),
      criticId: "critic-1",
      token: TOKEN,
    };
    await expect(publishCriticRolePacket(grant)).rejects.toThrow(
      "the critic packet needs at least one authoritative run gate command as repository evidence",
    );
  });

  test("rejects an explicit --repository-command-ids entry that is not authoritative", async () => {
    const { repo, run } = await emptyGrantRun("critic-grant-bad-explicit-");
    seedSingleTaskGraph(run);
    await seedRunGateCommand(repo, run);
    await seedRepositoryInspection(run, "critic-1");
    setCompletionCritic(run);
    const grant: CriticRoleGrant = {
      runRoot: run,
      port: workflowPort(run),
      criticId: "critic-1",
      token: TOKEN,
      repositoryCommandIds: ["C-does-not-exist"],
    };
    await expect(publishCriticRolePacket(grant)).rejects.toThrow(
      "--repository-command-ids names a command that is not authoritative repository evidence: C-does-not-exist",
    );
  });

  test("publishes a completeness-critic packet with discovered repository evidence merged with an explicit id", async () => {
    const { repo, run } = await emptyGrantRun("critic-grant-publish-");
    seedSingleTaskGraph(run);
    const runGateCommandId = await seedRunGateCommand(repo, run);
    await seedRepositoryInspection(run, "critic-1");

    // A second, gate-less authoritative command the critic names explicitly: exercises the
    // "explicit ids merge with discovered ids" path in requiredRepositoryEvidence.
    const extraCommandId = "C-EXTRA-INSPECTION";
    transact(run, "test-setup", "seed-extra-command", {}, (draft) => {
      const commands = draft.commands as Record<string, unknown>;
      commands[extraCommandId] = commandRecord(extraCommandId, {
        task_id: null,
        gate_id: null,
        status: "succeeded",
        exit_code: 0,
        actor: "critic-1",
      });
    });

    const preAuth = workflowPort(run).read();
    const readiness = completionReadinessSnapshot(preAuth, 1, "critic-1");
    setCompletionCritic(run, {
      readiness_sha256: readiness.sha256,
      repository_binding: readiness.repository_binding,
    });

    const grant: CriticRoleGrant = {
      runRoot: run,
      port: workflowPort(run),
      criticId: "critic-1",
      token: TOKEN,
      repositoryCommandIds: [extraCommandId],
    };
    const published = await publishCriticRolePacket(grant);
    expect(published.record.status).toBe("published");
    expect(published.packet.metadata.role).toBe("completeness-critic");
    const commandIds = published.packet.metadata.repository_command_ids as string[];
    expect(commandIds).toContain(runGateCommandId);
    expect(commandIds).toContain(extraCommandId);
  });
});
