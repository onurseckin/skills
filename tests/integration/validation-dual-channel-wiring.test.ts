import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { cleanupRoots } from "../unit/cli/full-lifecycle-fixture.ts";

/**
 * Proves the Dual-Channel Validator Protocol the skill mandates (SKILL.md, agents/validator.yaml)
 * actually runs where a validator reviews a UI task, rather than sitting compiled and unreachable:
 * `task:review` must feed the analyzer real ingested `visual-report.json` and screenshot evidence,
 * and must refuse a UI pass that lacks it.
 */

interface Audit {
  readonly isUiTask: boolean;
  readonly passed: boolean;
  readonly mode: string;
  readonly proofs: readonly {
    readonly viewport: string;
    readonly status: string;
    readonly screenshotPath?: string;
    readonly screenshotSizeBytes?: number;
    readonly verifiedInvariants: readonly string[];
  }[];
}

const TASK_ID = "task-ui";
const SIBLING_TASK_ID = "task-other";
const VALIDATOR = "val-ui";
const IMPLEMENTER = "worker-ui";
const CHANGED_FILE = "src/components/Button.tsx";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

/**
 * A `visual-report.json` and one PNG per viewport, written the way a real Playwright visual suite
 * would: as a side effect of the gate command's own execution, so the files' mtimes fall inside the
 * run's `[started_at, finished_at]` window and the harness's post-exec ingestion attributes them to
 * the command that produced them (`writtenDuringRun` in `reporting/screenshot-ingestion.ts`).
 * Evidence pre-planted on disk before the gate ran would be ingested unattributed, which is exactly
 * the "did this command actually produce it" distinction the ingestion contract exists to enforce.
 */
const VISUAL_SUITE_SCRIPT = `
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("screenshots", { recursive: true });
writeFileSync("screenshots/mobile.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]));
writeFileSync("screenshots/tablet.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02]));
writeFileSync("screenshots/desktop.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x03]));
writeFileSync("screenshots/visual-report.json", JSON.stringify({
  viewports: {
    mobile: { width: 375, height: 667 },
    tablet: { width: 768, height: 1024 },
    desktop: { width: 1280, height: 800 },
  },
  layoutOverflows: [],
  textClippings: [],
  collisions: [],
}));
console.log("gate-ui");
`;

/** The same three-viewport DOM report, but the desktop capture never lands. */
const PARTIAL_SUITE_SCRIPT = VISUAL_SUITE_SCRIPT.replace(
  /^writeFileSync\("screenshots\/desktop\.png".*$/m,
  "",
);

/**
 * What the ingested `visual-report.json` schema (`reporting/screenshot-types.ts`) can actually
 * support: it carries overflow, clipping and collision arrays and nothing else. Contrast ratios,
 * origin coordinates and a render-cache flag have no field in it at all, so no proof built from real
 * evidence may name them.
 */
const DOM_INVARIANTS_THE_SCHEMA_SUPPORTS = ["no_overflow", "no_clipping", "stacking_order"];

async function setupUiRun(
  name: string,
  options: {
    readonly visualEvidence: "full" | "partial" | "none";
    /** A second task whose own gate runs the visual suite, so its evidence belongs to it. */
    readonly siblingVisualTask?: boolean;
  },
): Promise<{ repo: string; run: string }> {
  const repo = realpathSync(await mkdtemp(join(tmpdir(), `harness-dualchannel-${name}-`)));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Polish the Button component's responsive layout");
  await mkdir(join(repo, "src/components"), { recursive: true });
  await writeFile(join(repo, CHANGED_FILE), "export const Button = () => null;\n");
  const gateScript =
    options.visualEvidence === "full"
      ? VISUAL_SUITE_SCRIPT
      : options.visualEvidence === "partial"
        ? PARTIAL_SUITE_SCRIPT
        : "console.log('gate-ui');\n";
  await writeFile(join(repo, "gate-ui.ts"), gateScript);

  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    name,
    "--prompt-file",
    promptPath,
  ]);
  const run = init.run_root as string;
  await execute([
    "plan:add",
    "--run",
    run,
    "--id",
    TASK_ID,
    "--label",
    "Button responsive polish",
    "--scope",
    "src/components",
    "--gate",
    "bun gate-ui.ts",
    "--actor",
    "planner",
  ]);
  if (options.siblingVisualTask === true) {
    await writeFile(join(repo, "gate-other.ts"), VISUAL_SUITE_SCRIPT);
    await mkdir(join(repo, "src/other"), { recursive: true });
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      SIBLING_TASK_ID,
      "--label",
      "Unrelated work that happens to run the visual suite",
      "--scope",
      "src/other",
      "--gate",
      "bun gate-other.ts",
      "--actor",
      "planner",
    ]);
  }
  await execute([
    "plan:compile",
    "--run",
    run,
    "--actor",
    "planner",
    "--completion-gate",
    "bun test tests",
  ]);
  return { repo, run };
}

async function claimSubmitValidate(repo: string, run: string): Promise<string> {
  const claim = await execute([
    "task:claim",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--agent",
    IMPLEMENTER,
    "--role",
    "implementer",
  ]);
  const workerCheck = await execute([
    "run:exec",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--actor",
    IMPLEMENTER,
    "--cwd",
    repo,
    "--",
    "bun",
    "gate-ui.ts",
  ]);
  // C4: task:submit refuses a submission whose write scope is byte-identical to its content at
  // claim. setupUiRun already wrote CHANGED_FILE before the task was claimed, so the implementer
  // has to actually change it here, not merely declare it.
  await writeFile(
    join(repo, CHANGED_FILE),
    "export const Button = () => null; // responsive overflow fixed\n",
  );
  await execute([
    "task:submit",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--agent",
    IMPLEMENTER,
    "--token",
    claim.token as string,
    "--files-changed",
    CHANGED_FILE,
    "--evidence",
    workerCheck.command_id as string,
    "--summary",
    "Fixed the button's responsive overflow",
  ]);
  const started = await execute([
    "task:validate-start",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--validator",
    VALIDATOR,
  ]);
  return started.token as string;
}

/** The gate id `plan:compile` derives is `gate-<task-id-without-its-"task-"-prefix>`. */
async function validatorCheck(repo: string, run: string, gateId: string): Promise<string> {
  const executed = await execute([
    "run:exec",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--gate",
    gateId,
    "--actor",
    VALIDATOR,
    "--cwd",
    repo,
    "--",
    "bun",
    "gate-ui.ts",
  ]);
  return executed.command_id as string;
}

async function probeAndResolve(run: string, token: string): Promise<string> {
  const probe = await execute([
    "task:probe",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--validator",
    VALIDATOR,
    "--token",
    token,
    "--demand",
    "Prove the 375/768/1280 viewport matrix has no horizontal overflow",
  ]);
  return (probe.finding_ids as string[])[0]!;
}

function reviewPassArgv(run: string, token: string, evidence: string, resolve: string): string[] {
  return [
    "task:review",
    "--run",
    run,
    "--task",
    TASK_ID,
    "--validator",
    VALIDATOR,
    "--token",
    token,
    "--evidence",
    evidence,
    "--resolve",
    resolve,
    "--status",
    "pass",
    "--summary",
    "DOM metrics and screenshots corroborate across mobile, tablet and desktop",
  ];
}

describe("Dual-Channel Validator Protocol wiring", () => {
  test("a UI task pass runs the analyzer against real evidence and corroborates it", async () => {
    const { repo, run } = await setupUiRun("evidence", { visualEvidence: "full" });
    const token = await claimSubmitValidate(repo, run);
    const evidence = await validatorCheck(repo, run, "gate-ui");
    const findingId = await probeAndResolve(run, token);

    const result = await execute(reviewPassArgv(run, token, evidence, `${findingId}=${evidence}`));

    expect(result.verdict).toBe("pass");
    const audit = result.dual_channel_audit as Audit;
    expect(audit.isUiTask).toBe(true);
    expect(audit.passed).toBe(true);
    expect(audit.mode).toBe("dual_channel_corroborated");
    expect(audit.proofs.map((p) => p.viewport).sort()).toEqual(["desktop", "mobile", "tablet"]);
    expect(audit.proofs.every((p) => p.status === "corroborated")).toBe(true);
    // The proof names only what this evidence let the audit inspect. A fixed list that also claimed
    // `wcag_contrast`, `no_origin_orphans` and `render_cache_clean` signed off on three checks the
    // ingested schema has no field to support.
    for (const proof of audit.proofs) {
      expect(proof.verifiedInvariants).toEqual([
        ...DOM_INVARIANTS_THE_SCHEMA_SUPPORTS,
        "screenshot_non_empty",
      ]);
      expect(proof.screenshotPath).toContain(proof.viewport);
    }
  });

  test("a viewport whose capture never landed is proven by the DOM channel alone", async () => {
    const { repo, run } = await setupUiRun("partial", { visualEvidence: "partial" });
    const token = await claimSubmitValidate(repo, run);
    const evidence = await validatorCheck(repo, run, "gate-ui");
    const findingId = await probeAndResolve(run, token);

    const result = await execute(reviewPassArgv(run, token, evidence, `${findingId}=${evidence}`));

    const audit = result.dual_channel_audit as Audit;
    expect(audit.passed).toBe(true);
    const desktop = audit.proofs.find((p) => p.viewport === "desktop")!;
    // No desktop capture exists, so the proof borrows none: it carries no path, no byte count, and
    // does not claim the screenshot channel corroborated this viewport.
    expect(desktop.status).toBe("dom_only_gap_filled");
    expect(desktop.screenshotPath).toBeUndefined();
    expect(desktop.screenshotSizeBytes).toBeUndefined();
    expect(desktop.verifiedInvariants).toEqual(DOM_INVARIANTS_THE_SCHEMA_SUPPORTS);
    expect(audit.proofs.find((p) => p.viewport === "mobile")!.status).toBe("corroborated");
  });

  test("a UI task pass is refused when neither DOM metrics nor screenshots were captured", async () => {
    const { repo, run } = await setupUiRun("missing", { visualEvidence: "none" });
    const token = await claimSubmitValidate(repo, run);
    const evidence = await validatorCheck(repo, run, "gate-ui");
    const findingId = await probeAndResolve(run, token);

    await expect(
      execute(reviewPassArgv(run, token, evidence, `${findingId}=${evidence}`)),
    ).rejects.toThrow(/dual-channel|missing_channel/i);
  });

  test("a sibling task's visual evidence does not satisfy this task's mandate", async () => {
    const { repo, run } = await setupUiRun("foreign", {
      visualEvidence: "none",
      siblingVisualTask: true,
    });
    // Produced inside task-other's own command window, so the ledger credits it to task-other.
    await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      SIBLING_TASK_ID,
      "--actor",
      IMPLEMENTER,
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-other.ts",
    ]);

    const token = await claimSubmitValidate(repo, run);
    const evidence = await validatorCheck(repo, run, "gate-ui");
    const findingId = await probeAndResolve(run, token);

    await expect(
      execute(reviewPassArgv(run, token, evidence, `${findingId}=${evidence}`)),
    ).rejects.toThrow(/dual-channel|missing_channel/i);
  });

  test("a non-UI task pass is not gated by the dual-channel mandate", async () => {
    const repo = realpathSync(await mkdtemp(join(tmpdir(), "harness-dualchannel-nonui-")));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Fix the retry backoff in the queue worker");
    await mkdir(join(repo, "src/backend"), { recursive: true });
    await writeFile(join(repo, "src/backend/queue.ts"), "export const retries = 3;\n");
    await writeFile(join(repo, "gate-backend.ts"), "console.log('gate-backend');\n");

    const init = await execute([
      "plan:init",
      "--repo",
      repo,
      "--run",
      "nonui",
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      TASK_ID,
      "--label",
      "Queue retry backoff",
      "--scope",
      "src/backend",
      "--gate",
      "bun gate-backend.ts",
      "--actor",
      "planner",
    ]);
    await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      IMPLEMENTER,
      "--role",
      "implementer",
    ]);
    const workerCheck = await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--actor",
      IMPLEMENTER,
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-backend.ts",
    ]);
    // C4: task:submit refuses a submission whose write scope is byte-identical to its content at
    // claim; the file above was written during setup, before the task was even claimed.
    await writeFile(join(repo, "src/backend/queue.ts"), "export const retries = 5;\n");
    await execute([
      "task:submit",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      IMPLEMENTER,
      "--token",
      claim.token as string,
      "--files-changed",
      "src/backend/queue.ts",
      "--evidence",
      workerCheck.command_id as string,
      "--summary",
      "Bounded the retry backoff",
    ]);
    const started = await execute([
      "task:validate-start",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--validator",
      VALIDATOR,
    ]);
    const token = started.token as string;
    const validatorExec = await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--gate",
      "gate-ui",
      "--actor",
      VALIDATOR,
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-backend.ts",
    ]);
    const evidence = validatorExec.command_id as string;
    const findingId = await probeAndResolve(run, token);

    const result = await execute(reviewPassArgv(run, token, evidence, `${findingId}=${evidence}`));

    expect(result.verdict).toBe("pass");
    const audit = result.dual_channel_audit as Audit;
    expect(audit.isUiTask).toBe(false);
    expect(audit.mode).toBe("non_ui_skipped");
  });
});
