import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { transact, loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { buildPacket } from "../../../olt/scripts/src/packets/render-packet.ts";
import { isolateValidatorContext } from "../../../olt/scripts/src/packets/validator-context.ts";
import { evidenceSchema } from "../../../olt/scripts/src/packets/evidence-schema.ts";
import {
  extractLeaseAgentId,
  extractLeaseRole,
  extractLeaseAttempt,
} from "../../../olt/scripts/src/reporting/lease-agent-extractor.ts";
import type { UnifiedReport } from "../../../olt/scripts/src/reporting/unified.ts";
import { cleanupRoots } from "../cli/full-lifecycle-fixture.ts";
import { inspectionContext } from "../packets/inspection-fixture.ts";
import type { WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function createBaseRun(name: string): Promise<{ repo: string; run: string }> {
  const repo = realpathSync(await mkdtemp(join(tmpdir(), `harness-integration-verify-${name}-`)));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(
    promptPath,
    "Build ultra-lean validator architecture with unified reporting CLI and robust lease extraction.\nEnsure complete AGP protocol and zero-suppression invariants.\n",
  );

  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    name,
    "--prompt-file",
    promptPath,
  ]);
  return { repo, run: init.run_root as string };
}

function adaptWorkflowState(rawState: unknown): WorkflowState {
  const s = rawState as Record<string, unknown>;
  const reqs = Array.isArray(s.requirements)
    ? s.requirements
    : ((s.requirements as { requirements?: unknown[] })?.requirements ?? []);
  return {
    ...s,
    requirements: reqs,
  } as unknown as WorkflowState;
}

describe("P52 & P53 End-to-End Integration Verification", () => {
  test("combined flow: plan -> claim -> packet generation -> status -> dag:view -> report", async () => {
    const { repo, run } = await createBaseRun("e2e-combined-flow");

    await mkdir(join(repo, "src/engine"), { recursive: true });
    await mkdir(join(repo, "src/ui"), { recursive: true });
    await writeFile(join(repo, "gate-engine.ts"), "console.log('engine-gate-pass');\n");
    await writeFile(join(repo, "gate-ui.ts"), "console.log('ui-gate-pass');\n");

    // 1. Add tasks with disjoint scopes
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-engine",
      "--label",
      "Core Engine",
      "--scope",
      "src/engine",
      "--gate",
      "bun gate-engine.ts",
      "--requirement-lines",
      "1",
      "--actor",
      "planner",
    ]);

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-ui",
      "--label",
      "UI Layer",
      "--scope",
      "src/ui",
      "--gate",
      "bun gate-ui.ts",
      "--deps",
      "task-engine",
      "--dep-reason",
      "task-engine:UI consumes engine outputs",
      "--requirement-lines",
      "2",
      "--actor",
      "planner",
    ]);

    await execute(["plan:brainstorm", "--run", run, "--actor", "planner"]);

    await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
      "--accept-audit",
      "A4-false-barrier: UI layer builds on top of engine API contract",
    ]);

    // 2. Register Agents across tiers
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "impl-eng-1",
      "--role",
      "implementer",
      "--host",
      "antigravity",
    ]);

    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "val-eng-1",
      "--role",
      "validator",
      "--host",
      "antigravity",
    ]);

    // 3. Claim task-engine
    const claimRes = (await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-engine",
      "--agent",
      "impl-eng-1",
      "--role",
      "implementer",
    ])) as Record<string, unknown>;

    expect(claimRes.token).toBeDefined();

    // 4. Generate Implementer packet and verify lean decoupled structure
    const state = adaptWorkflowState(loadRun(run).state);
    const commonBytes = new TextEncoder().encode("Standard instructions");
    const commonSha256 = createHash("sha256").update(commonBytes).digest("hex");

    const implPacket = buildPacket({
      runId: "e2e-combined-flow",
      graphRevision: 1,
      role: "implementer",
      agentId: "impl-eng-1",
      attempt: 1,
      state,
      task: state.tasks["task-engine"],
      commonInstructions: { bytes: commonBytes, sha256: commonSha256 },
      evidenceSchema: evidenceSchema("implementer"),
      targetedCommands: [["bun", "gate-engine.ts"]],
      leaseToken: claimRes.token as string,
      authoritativeContext: {
        ...inspectionContext(),
        task_contract: { id: "task-engine", write_scope: ["src/engine"] },
        mapped_requirements: [{ id: "R-1", text: "Core engine requirement" }],
      },
    });

    expect(implPacket.markdown).toContain("## Actionable Task Checklist");
    expect(implPacket.markdown).toContain("Direct end-to-end implementation & tests");
    expect(implPacket.markdown).toContain("Strict static invariants");
    expect(implPacket.markdown).toContain("Ultra-lean context & on-demand inspection");
    expect(implPacket.markdown).toContain("report:task");

    // 5. Inspect run:status output and verify lifecycle phase breakdown
    const statusRes = (await execute(["run:status", "--run", run])) as Record<string, unknown>;
    const occupancy = statusRes.occupancy as Record<string, unknown>;
    expect(occupancy.implementers).toBe(1);
    expect(occupancy.standby).toBe(0); // task-ui is blocked on task-engine
    expect(statusRes.markdown as string).toContain("`task-engine`");
    expect(statusRes.markdown as string).toContain("Leased (impl-eng-1 [implementer])");
    expect(statusRes.markdown as string).not.toContain("undefined");

    // 6. Inspect dag:view output
    const dagRes = (await execute(["dag:view", "--run", run])) as Record<string, unknown>;
    expect(dagRes.total_tasks).toBe(2);
    expect(dagRes.markdown as string).toContain("task-engine");
    expect(dagRes.markdown as string).toContain("impl-eng-1");
    expect(dagRes.markdown as string).not.toContain("undefined");

    // 7. Inspect unified report output
    const unifiedRes = (await execute([
      "report",
      "--run",
      run,
      "--detailed",
    ])) as unknown as UnifiedReport;
    expect(unifiedRes.run_id).toBe("e2e-combined-flow");
    expect(unifiedRes.topology.total_tasks).toBe(2);
    expect(unifiedRes.lifecycle.implementers.count).toBe(1);
    expect(unifiedRes.lifecycle.implementers.active[0]?.agentId).toBe("impl-eng-1");
    expect(unifiedRes.lifecycle.implementers.active[0]?.taskId).toBe("task-engine");
    expect(unifiedRes.markdown).toContain("Unified Run Report & Telemetry");
    expect(unifiedRes.markdown).toContain("Distinct Lifecycle Phase Status");
    expect(unifiedRes.markdown).not.toContain("undefined");

    // 8. Simulate task submission & transition to validating state
    transact(run, "coordinator", "task-submitted", {}, (s) => {
      const task = s.tasks["task-engine"];
      if (task) {
        task.status = "validating";
        delete task.lease;
        task.validations = [
          {
            validator_id: "val-eng-1",
            domain: "code-quality",
            token_digest: createHash("sha256").update("val-token-xyz").digest("hex"),
            attempt: 1,
            started_at: new Date().toISOString(),
            deadline_at: new Date(Date.now() + 1200000).toISOString(),
          },
        ];
      }
    });

    // 9. Generate Validator packet and verify context sanitization + AGP criteria
    const updatedState = adaptWorkflowState(loadRun(run).state);
    const contaminatedContext = {
      ...inspectionContext(),
      task_contract: { id: "task-engine", write_scope: ["src/engine"] },
      mapped_requirements: [{ id: "R-1", text: "Core engine requirement" }],
      implementer_report: "I am totally sure this is done.",
      confidence: "0.999",
      decision_narrative: "Skipped tests because code is trivial.",
      raw_errors: ["Error: something failed earlier"],
      error_blobs: { crash: "stack dump" },
      stack_traces: ["at engine.ts:10"],
      hallucinated_completion: true,
    };

    const sanitizedContext = isolateValidatorContext(contaminatedContext);
    expect(sanitizedContext).not.toHaveProperty("implementer_report");
    expect(sanitizedContext).not.toHaveProperty("confidence");
    expect(sanitizedContext).not.toHaveProperty("raw_errors");
    expect(sanitizedContext).not.toHaveProperty("error_blobs");
    expect(sanitizedContext).not.toHaveProperty("stack_traces");
    expect(sanitizedContext).not.toHaveProperty("hallucinated_completion");

    const valPacket = buildPacket({
      runId: "e2e-combined-flow",
      graphRevision: 1,
      role: "validator",
      agentId: "val-eng-1",
      attempt: 1,
      state: updatedState,
      task: updatedState.tasks["task-engine"],
      commonInstructions: { bytes: commonBytes, sha256: commonSha256 },
      evidenceSchema: evidenceSchema("validator"),
      targetedCommands: [["bun", "gate-engine.ts"]],
      leaseToken: "val-token-xyz",
      authoritativeContext: contaminatedContext,
    });

    expect(valPacket.markdown).toContain("Adversarial Gate Proofs (AGP) & falsifiability");
    expect(valPacket.markdown).toContain("Direct end-to-end command verification");
    expect(valPacket.markdown).toContain("Strict quantitative metric floors");
    expect(valPacket.markdown).not.toContain("I am totally sure this is done");
    expect(valPacket.markdown).not.toContain("Skipped tests");
    expect(valPacket.markdown).not.toContain("stack dump");

    // 10. Check unified report reflects validator active lifecycle
    const valReport = (await execute(["report", "--run", run])) as unknown as UnifiedReport;
    expect(valReport.lifecycle.validators.count).toBe(1);
    expect(valReport.lifecycle.validators.active[0]?.validatorId).toBe("val-eng-1");
    expect(valReport.lifecycle.validators.active[0]?.taskId).toBe("task-engine");
    expect(valReport.lifecycle.implementers.count).toBe(0);
    expect(valReport.occupancy.summary).toContain("1 Validator(s) testing/probing");
  });

  test("extractLeaseAgentId handles all edge cases rigorously", () => {
    // Normal cases
    expect(extractLeaseAgentId({ agent_id: "worker-1" })).toBe("worker-1");
    expect(extractLeaseAgentId({ agent: "worker-2" })).toBe("worker-2");
    expect(extractLeaseAgentId({ agent_id: "worker-1", agent: "worker-2" })).toBe("worker-1");

    // Whitespace trimming
    expect(extractLeaseAgentId({ agent_id: "  worker-3  " })).toBe("worker-3");
    expect(extractLeaseAgentId({ agent: "  worker-4  " })).toBe("worker-4");

    // Stringified null/undefined/empty
    expect(extractLeaseAgentId({ agent_id: "undefined" })).toBe("");
    expect(extractLeaseAgentId({ agent_id: "null" })).toBe("");
    expect(extractLeaseAgentId({ agent_id: "" })).toBe("");
    expect(extractLeaseAgentId({ agent: "undefined" })).toBe("");
    expect(extractLeaseAgentId({ agent: "null" })).toBe("");
    expect(extractLeaseAgentId({ agent: "" })).toBe("");

    // Non-object or null input
    expect(extractLeaseAgentId(null)).toBe("");
    expect(extractLeaseAgentId(undefined)).toBe("");
    expect(extractLeaseAgentId("not-an-object")).toBe("");
    expect(extractLeaseAgentId(12345)).toBe("");
    expect(extractLeaseAgentId({})).toBe("");
  });

  test("extractLeaseRole and extractLeaseAttempt parse lease metadata safely", () => {
    expect(extractLeaseRole({ role: "validator" })).toBe("validator");
    expect(extractLeaseRole({ role: "  repairer  " })).toBe("repairer");
    expect(extractLeaseRole({}, "custom-default")).toBe("custom-default");
    expect(extractLeaseRole(null)).toBe("implementer");

    expect(extractLeaseAttempt({ attempt: 3 })).toBe(3);
    expect(extractLeaseAttempt({ attempt: 2.7 })).toBe(2);
    expect(extractLeaseAttempt({ attempt: -1 })).toBe(1);
    expect(extractLeaseAttempt({})).toBe(1);
    expect(extractLeaseAttempt(null)).toBe(1);
  });
});
