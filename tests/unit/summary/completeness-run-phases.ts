import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import {
  cli,
  git,
  PLANTED,
  RUN_GATE,
  TASK_GATE_ALPHA,
  TASK_GATE_BETA,
  text,
} from "./completeness-run-support.ts";
import type { Issue } from "./completeness-run-support.ts";

function openFindingIds(run: string, taskId: string): string[] {
  const state = loadRun(run).state as unknown as {
    tasks: Record<string, { findings?: Array<{ id: string; status: string }> }>;
  };
  return (state.tasks[taskId]?.findings ?? [])
    .filter((finding) => finding.status === "open")
    .map((finding) => finding.id);
}

function resolutions(run: string, taskId: string, commandId: string): string[] {
  return openFindingIds(run, taskId).map((id) => `${id}=${commandId}`);
}

/**
 * C3b (`workflow/review/pass-preconditions.ts` `assertGateProofFalsifiable`): a passing review now
 * requires a recorded falsifiable `gate:prove` proof for the task's compiled task-scope gate. This
 * calls the real CLI — the repository seedRepository built is a real Git repository, so there is no
 * excuse to fabricate the record `gate:prove` would produce; the command actually reverts the
 * task's write scope to its claimed base and reruns the gate there.
 */
async function proveGate(run: string, taskId: string, actor: string): Promise<void> {
  await cli("gate:prove", { "--run": run, "--task": taskId, "--actor": actor });
}

/**
 * C3b: gate:prove reverts a task's write scope back to the sha `task:claim` recorded as its base
 * and reruns the compiled gate there, so `test -f src/alpha/index.ts` can only be genuinely
 * falsifiable if that path is absent at whatever commit the repair round's own claim lands on.
 * `git diff <single-commit>` (file-diff-reader.ts, behind the B15.2 completeness contract) reads
 * only that commit and the current working tree, ignoring everything in between — so retiring the
 * file from the index right here, between the reject and the repair claim, moves the repair
 * attempt's claimed base past a commit that no longer carries it, without disturbing the diff the
 * run's own baseline inspection (fixed back at seedRepository's first commit) produces later.
 */
function retireAlphaBaseline(repo: string): void {
  git(repo, ["rm", "--cached", "-q", "src/alpha/index.ts"]);
  git(repo, ["commit", "-qm", "retire alpha pending repair"]);
}

/** A rejection with a real defect, then a repair round, then a probe answered on the way to pass. */
export async function runAlpha(repo: string, run: string, issue: Issue): Promise<void> {
  const claim = await cli("task:claim", {
    "--run": run,
    "--task": "task-alpha",
    "--agent": "worker-alpha",
    "--role": "implementer",
  });
  const work = await cli(
    "run:exec",
    { "--run": run, "--task": "task-alpha", "--actor": "worker-alpha", "--cwd": repo },
    ["echo", "alpha-implementation"],
  );
  // C4: task:submit refuses a submission whose write scope is byte-identical to its content at
  // claim; seedRepository wrote this file before the task was even planned, let alone claimed.
  writeFileSync(join(repo, "src", "alpha", "index.ts"), "export const alpha = 2;\n");
  await cli("task:submit", {
    "--run": run,
    "--task": "task-alpha",
    "--agent": "worker-alpha",
    "--token": issue(claim.token),
    "--summary": "Alpha parser rewritten against the new grammar",
    "--files-changed": "src/alpha/index.ts",
    "--evidence": text(work.command_id),
  });

  const firstReview = await cli("task:validate-start", {
    "--run": run,
    "--task": "task-alpha",
    "--validator": "val-alpha",
  });
  const firstGate = await cli(
    "run:exec",
    {
      "--run": run,
      "--task": "task-alpha",
      "--gate": "gate-alpha",
      "--actor": "val-alpha",
      "--cwd": repo,
    },
    TASK_GATE_ALPHA,
  );
  await cli("task:reject", {
    "--run": run,
    "--task": "task-alpha",
    "--validator": "val-alpha",
    "--token": issue(firstReview.token),
    "--evidence": text(firstGate.command_id),
    "--reason": PLANTED.rejectReason,
    "--severity": "important",
    "--remediation": PLANTED.rejectRemediation,
  });
  retireAlphaBaseline(repo);

  const repair = await cli("task:claim", {
    "--run": run,
    "--task": "task-alpha",
    "--agent": "worker-alpha",
    "--role": "repairer",
  });
  const repairWork = await cli(
    "run:exec",
    { "--run": run, "--task": "task-alpha", "--actor": "worker-alpha", "--cwd": repo },
    ["echo", "alpha-repair"],
  );
  // C4: the repair claim's baseline is round 1's already-changed content, so the repair needs its
  // own further change to avoid a byte-identical resubmission.
  writeFileSync(
    join(repo, "src", "alpha", "index.ts"),
    "export const alpha = 2;\nexport const alphaFixture = true;\n",
  );
  // Restores the path to the index (still uncommitted) with the repair's own content, so a later
  // `git diff <baseline-commit>` reads it as a genuine modification of the file that commit carries
  // rather than as the deletion `retireAlphaBaseline` just staged — see that function's comment.
  git(repo, ["add", "src/alpha/index.ts"]);
  await cli("task:submit", {
    "--run": run,
    "--task": "task-alpha",
    "--agent": "worker-alpha",
    "--token": issue(repair.token),
    "--summary": PLANTED.repairSummary,
    "--files-changed": "src/alpha/index.ts",
    "--evidence": text(repairWork.command_id),
  });

  // A second round needs a second validator: the harness refuses one that already reviewed the task.
  const secondReview = await cli("task:validate-start", {
    "--run": run,
    "--task": "task-alpha",
    "--validator": "val-alpha-2",
  });
  const reviewToken = issue(secondReview.token);
  const secondGate = await cli(
    "run:exec",
    {
      "--run": run,
      "--task": "task-alpha",
      "--gate": "gate-alpha",
      "--actor": "val-alpha-2",
      "--cwd": repo,
    },
    TASK_GATE_ALPHA,
  );
  await cli("task:probe", {
    "--run": run,
    "--task": "task-alpha",
    "--validator": "val-alpha-2",
    "--token": reviewToken,
    "--demand": PLANTED.probeAlpha,
  });
  await proveGate(run, "task-alpha", "coordinator-1");
  await cli("task:review", {
    "--run": run,
    "--task": "task-alpha",
    "--validator": "val-alpha-2",
    "--token": reviewToken,
    "--status": "pass",
    "--evidence": text(secondGate.command_id),
    "--resolve": resolutions(run, "task-alpha", text(secondGate.command_id)),
    "--summary": "Alpha verified after the repair round",
  });
}

/** A branch excursion that collects, then a probe answered on the way to pass. */
export async function runBeta(repo: string, run: string, issue: Issue): Promise<string> {
  const claim = await cli("task:claim", {
    "--run": run,
    "--task": "task-beta",
    "--agent": "worker-beta",
    "--role": "implementer",
  });
  const parentToken = issue(claim.token);
  const branch = await cli("branch:open", {
    "--run": run,
    "--parent-task": "task-beta",
    "--agent": "worker-beta",
    "--token": parentToken,
    "--reason": PLANTED.branchReason,
    "--sub-task": "S-1",
    "--sub-label": `S-1=${PLANTED.subTaskLabel}`,
    "--sub-scope": "S-1=src/beta/index.ts",
    "--repo": repo,
  });
  const branchId = text(branch.branch_id);
  await cli("agent:register", {
    "--run": run,
    "--agent": "sub-beta-1",
    "--role": "sub-investigator",
    "--host": "fixture-host",
    "--parent-agent": "worker-beta",
    "--parent-task": "S-1",
  });
  const subClaim = await cli("branch:claim", {
    "--run": run,
    "--branch": branchId,
    "--sub-task": "S-1",
    "--agent": "sub-beta-1",
    "--role": "sub-investigator",
    "--repo": repo,
  });
  await cli("run:exec", { "--run": run, "--task": "S-1", "--actor": "sub-beta-1", "--cwd": repo }, [
    "echo",
    "flush-investigation",
  ]);
  // A real edit inside the branch window, so the collect-time Git reading has something to observe.
  writeFileSync(join(repo, "src", "beta", "index.ts"), "export const beta = 2;\n");
  await cli("branch:submit", {
    "--run": run,
    "--branch": branchId,
    "--sub-task": "S-1",
    "--agent": "sub-beta-1",
    "--token": issue(subClaim.token),
    "--summary": PLANTED.subTaskSummary,
  });
  await cli("branch:collect", {
    "--run": run,
    "--branch": branchId,
    "--agent": "worker-beta",
    "--token": parentToken,
    "--summary": PLANTED.collectSummary,
    "--repo": repo,
  });
  await cli("agent:release", {
    "--run": run,
    "--agent": "sub-beta-1",
    "--reason": "S-1 submitted",
  });

  const work = await cli(
    "run:exec",
    { "--run": run, "--task": "task-beta", "--actor": "worker-beta", "--cwd": repo },
    ["echo", "beta-implementation"],
  );
  await cli("task:submit", {
    "--run": run,
    "--task": "task-beta",
    "--agent": "worker-beta",
    "--token": parentToken,
    "--summary": "Beta writer hardened against partial flushes",
    "--files-changed": "src/beta/index.ts",
    "--evidence": text(work.command_id),
  });
  const review = await cli("task:validate-start", {
    "--run": run,
    "--task": "task-beta",
    "--validator": "val-beta",
  });
  const reviewToken = issue(review.token);
  const gate = await cli(
    "run:exec",
    {
      "--run": run,
      "--task": "task-beta",
      "--gate": "gate-beta",
      "--actor": "val-beta",
      "--cwd": repo,
    },
    TASK_GATE_BETA,
  );
  await cli("task:probe", {
    "--run": run,
    "--task": "task-beta",
    "--validator": "val-beta",
    "--token": reviewToken,
    "--demand": PLANTED.probeBeta,
  });
  await proveGate(run, "task-beta", "coordinator-1");
  await cli("task:review", {
    "--run": run,
    "--task": "task-beta",
    "--validator": "val-beta",
    "--token": reviewToken,
    "--status": "pass",
    "--evidence": text(gate.command_id),
    "--resolve": resolutions(run, "task-beta", text(gate.command_id)),
    "--summary": "Beta verified",
  });
  return branchId;
}

/** The whole-run gate, the critic's sign-off over every requirement, and the seal. */
export async function sealRun(repo: string, run: string, issue: Issue): Promise<void> {
  await cli(
    "run:exec",
    { "--run": run, "--gate": "gate-run-completion", "--actor": "coordinator-1", "--cwd": repo },
    RUN_GATE,
  );
  await cli("agent:register", {
    "--run": run,
    "--agent": "critic-1",
    "--role": "completeness-critic",
    "--host": "fixture-host",
    "--parent-agent": "coordinator-1",
  });
  const inspect = await cli("run:exec", { "--run": run, "--actor": "critic-1", "--cwd": repo }, [
    "echo",
    "critic-inspection",
  ]);
  const start = await cli("critic:start", {
    "--run": run,
    "--critic": "critic-1",
    "--repository-command-ids": text(inspect.command_id),
  });
  const requirementIds = (
    loadRun(run).state as unknown as { requirements: { requirements: Array<{ id: string }> } }
  ).requirements.requirements.map((requirement) => requirement.id);
  const criticToken = issue(start.token);
  await cli("critic:review", {
    "--run": run,
    "--critic": "critic-1",
    "--token": criticToken,
    "--decision": "approve",
    "--summary": PLANTED.criticSummary,
    "--proofs": JSON.stringify(
      requirementIds.map((id) => ({
        requirement_id: id,
        status: "satisfied",
        evidence: [
          {
            kind: "command",
            reference: text(inspect.command_id),
            observation: "the completion gate passed",
          },
        ],
      })),
    ),
  });
  await cli("agent:release", {
    "--run": run,
    "--agent": "coordinator-1",
    "--reason": "run complete",
  });
  // The completion critic's own token now doubles as run:complete's --auth-token (complete-run.ts
  // checks it against the same completion_critic assignment record critic:review just verified).
  await cli("run:complete", {
    "--run": run,
    "--actor": "coordinator-1",
    "--auth-token": criticToken,
  });
}
