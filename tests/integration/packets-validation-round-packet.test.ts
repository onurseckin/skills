import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { CHANGED_FILE, setupRun, TASK_ID } from "../unit/cli/probe-fixture.ts";
import { disposableRoots, publishedFor } from "../unit/packets/grant-fixture.ts";

const roots = disposableRoots();
const DEFECT = "the empty payload path is unhandled";
const REMEDIATION = "handle the empty payload before the insert";
const REPAIRED = "export const repaired = true;\n";

/** A committed repository, so the packet's diffs have a recorded commit to anchor to. */
function commitRepository(repo: string): void {
  writeFileSync(join(repo, ".gitignore"), ".capsules/\n");
  for (const argv of [
    ["init", "--quiet"],
    ["add", "-A"],
    [
      "-c",
      "user.email=fixture@example.com",
      "-c",
      "user.name=fixture",
      "commit",
      "-q",
      "-m",
      "base",
    ],
  ]) {
    const result = spawnSync("git", ["-C", repo, ...argv], { encoding: "utf-8" });
    if (result.status !== 0) throw new Error(`git ${argv.join(" ")} failed: ${result.stderr}`);
  }
}

async function work(
  run: string,
  repo: string,
  agent: string,
  role: string,
  content: string,
): Promise<void> {
  const claim = await execute([
    "task:claim",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--agent",
    agent,
    "--role",
    role,
  ]);
  // C4: task:submit refuses a submission whose write scope is byte-identical to its content at
  // claim, so the change has to land here — between the claim above and the submit below, not
  // before either round starts — for the claim-time digest to differ from the submit-time one.
  writeFileSync(join(repo, CHANGED_FILE), content);
  const check = await execute([
    "run:exec",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--actor",
    agent,
    "--cwd",
    repo,
    "--",
    "bun",
    "gate-core.ts",
  ]);
  await execute([
    "task:submit",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--agent",
    agent,
    "--token",
    claim.token as string,
    "--files-changed",
    CHANGED_FILE,
    "--evidence",
    check.command_id as string,
    "--summary",
    "Implemented the task under test",
  ]);
}

async function validate(run: string, validator: string): Promise<string> {
  const started = await execute([
    "task:validate-start",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--validator",
    validator,
  ]);
  return started.token as string;
}

async function gateRun(run: string, repo: string, actor: string): Promise<string> {
  const executed = await execute([
    "run:exec",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--gate",
    "gate-core",
    "--actor",
    actor,
    "--cwd",
    repo,
    "--",
    "bun",
    "gate-core.ts",
  ]);
  return executed.command_id as string;
}

describe("a later round's validator packet carries the run's own record", () => {
  test("round 1 is unchanged and round 2 arrives oriented", async () => {
    const { repo, run } = await setupRun("packet-round-two", roots);
    commitRepository(repo);
    await work(run, repo, "worker-core", "implementer", "export const implemented = true;\n");
    const firstToken = await validate(run, "val-1");
    expect(publishedFor(run, "val-1").markdown).not.toContain("## Round ");

    const checked = await gateRun(run, repo, "val-1");
    const rejected = await execute([
      "task:reject",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--validator",
      "val-1",
      "--token",
      firstToken,
      "--severity",
      "critical",
      "--evidence",
      checked,
      "--reason",
      DEFECT,
      "--remediation",
      REMEDIATION,
    ]);
    // The repair the second round has to judge.
    await work(run, repo, "worker-core", "repairer", REPAIRED);
    await validate(run, "val-2");

    const { markdown, record } = publishedFor(run, "val-2");
    const metadata = JSON.parse(readFileSync(join(run, record.metadata_path), "utf-8")) as {
      excluded_fields: string[];
    };
    // The packet names what it withheld rather than leaving the absence to be discovered.
    expect(metadata.excluded_fields).toContain("observation");
    expect(metadata.excluded_fields).toContain("verdict");

    expect(markdown).toContain("## Round 2 — the record this run already holds");
    expect(markdown).toContain("### Prove these hold");
    // The demand the rejection left, named by its id and carrying the check it asked for.
    expect(markdown).toContain(`- \`${rejected.finding_id as string}\``);
    expect(markdown).toContain(`- Prove: Run gate tests for ${TASK_ID}`);
    // Every command the run recorded against the task, with the bytes its own log holds.
    expect(markdown).toContain(checked);
    expect(markdown).toContain("gate-core\n");
    expect(markdown).toContain(`"gate_id": "gate-core"`);
    // The repair itself, measured against the commit the run recorded before it started.
    expect(markdown).toContain("### Repository delta");
    expect(markdown).toContain(`+++ b/${CHANGED_FILE}`);
    expect(markdown).toContain("+export const repaired = true;");
    // The task contract hands over the demand in place of the finding that raised it.
    expect(markdown).toContain(`"demand_id": "${rejected.finding_id as string}"`);
    // Round 1's diagnosis and the remediation it prescribed are nowhere in the packet.
    for (const anchoring of [DEFECT, REMEDIATION]) expect(markdown).not.toContain(anchoring);
    // The sections built from what round 1 recorded carry no conclusion-bearing field at all. The
    // evidence schema is excluded on purpose: it is this validator's own reporting template.
    const contract = markdown.slice(
      markdown.indexOf("## Task contract"),
      markdown.indexOf("## Mapped requirements"),
    );
    const roundRecord = markdown.slice(
      markdown.indexOf("## Round 2"),
      markdown.indexOf("## Common instructions"),
    );
    for (const section of [contract, roundRecord]) {
      for (const anchoring of ["severity", "verdict", "observation", "validation_history"]) {
        expect(section).not.toContain(anchoring);
      }
    }
  }, 120_000);
});
