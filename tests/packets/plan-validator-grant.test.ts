import { describe, expect, test } from "bun:test";
import { publishPlanValidatorRolePacket } from "../../olt/scripts/src/packets/plan-validator-grant.ts";
import { transact } from "../../olt/scripts/src/engine/store/index.ts";
import { workflowPort } from "../../olt/scripts/src/integration/store-ports.ts";
import { tokenDigest } from "../../olt/scripts/src/workflow/lease/token.ts";
import {
  emptyGrantRun,
  seedRepositoryInspection,
  seedSingleTaskGraph,
} from "./grant-run-fixture.ts";

const TOKEN = "plan-validator-token";

async function fixtureRun(prefix: string) {
  const { run } = await emptyGrantRun(prefix);
  seedSingleTaskGraph(run);
  await seedRepositoryInspection(run, "planner");
  return run;
}

function seedPlanValidation(run: string, overrides: Record<string, unknown> = {}): void {
  transact(run, "test-setup", "assign-plan-validation", {}, (draft) => {
    const assignment = {
      validator_id: "validator-1",
      token_digest: tokenDigest(TOKEN),
      attempt: 1,
      status: "assigned",
      started_at: new Date().toISOString(),
      // Fixed, far-future instant rather than a clock read: publishPlanValidatorRolePacket checks
      // this against the real system clock with no injectable override, so a "now + 60s" value
      // computed once at module load risks having already elapsed by the time a busy parallel
      // run reaches this test. A constant this far out never can.
      deadline_at: "2099-01-01T00:00:00.000Z",
      graph_revision: 1,
      plan_digest: "digest-1",
      ...overrides,
    };
    draft.plan_validation = assignment;
    draft.plan_validation_history = [assignment];
  });
}

describe("publishPlanValidatorRolePacket", () => {
  test("rejects when there is no plan validation authorization for this validator", async () => {
    const run = await fixtureRun("plan-validator-missing-");
    const published = publishPlanValidatorRolePacket({
      runRoot: run,
      port: workflowPort(run),
      validatorId: "validator-1",
      token: TOKEN,
    });
    await expect(published).rejects.toThrow("plan validation authorization is missing");
  });

  test("rejects when the authorized validator id does not match the grant", async () => {
    const run = await fixtureRun("plan-validator-mismatch-");
    seedPlanValidation(run, { validator_id: "someone-else" });
    const published = publishPlanValidatorRolePacket({
      runRoot: run,
      port: workflowPort(run),
      validatorId: "validator-1",
      token: TOKEN,
    });
    await expect(published).rejects.toThrow("plan validation authorization is missing");
  });

  test("publishes a plan-validator packet carrying the plan digest and decomposition questions", async () => {
    const run = await fixtureRun("plan-validator-publish-");
    seedPlanValidation(run);

    const published = await publishPlanValidatorRolePacket({
      runRoot: run,
      port: workflowPort(run),
      validatorId: "validator-1",
      token: TOKEN,
    });

    expect(published.record.status).toBe("published");
    expect(published.packet.metadata.role).toBe("plan-validator");
    expect(published.packet.markdown).toContain("# plan-validator packet");
    expect(published.packet.markdown).toContain("Actionable Task Checklist");
  });
});
