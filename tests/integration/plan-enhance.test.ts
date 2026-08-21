import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  isJsonObject,
  type JsonObject,
} from "../../orchestrating-long-tasks/scripts/src/contracts/json.ts";
import { loadRun } from "../../orchestrating-long-tasks/scripts/src/store/index.ts";

const PROMPT = "Rebuild the drawer\n\nWire the store\nShip the fixture";

const roots: string[] = [];

function makeWritable(path: string): void {
  chmodSync(path, 0o755);
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const nested = join(path, entry.name);
    if (entry.isDirectory()) makeWritable(nested);
    else chmodSync(nested, 0o644);
  }
}

afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => {
      makeWritable(root);
      return rm(root, { recursive: true, force: true });
    }),
  ),
);

async function initialisedRun(name: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), `harness-${name}-`));
  roots.push(repo);
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, PROMPT);
  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    `${name}-run`,
    "--prompt-file",
    promptPath,
  ]);
  return init.run_root as string;
}

function planningState(run: string): JsonObject {
  const planning = loadRun(run).state.planning;
  if (!isJsonObject(planning) || !isJsonObject(planning.enhanced_plan)) {
    throw new Error("state.planning.enhanced_plan is missing");
  }
  return planning.enhanced_plan;
}

describe("plan:enhance", () => {
  test("initRun creates the planning directory", async () => {
    const run = await initialisedRun("plan-dir");
    expect(statSync(join(run, "planning")).isDirectory()).toBeTrue();
  });

  test("records the agent's reading as a reviewable document and a state digest", async () => {
    const run = await initialisedRun("plan-enhance");

    const result = await execute([
      "plan:enhance",
      "--run",
      run,
      "--actor",
      "planner",
      "--summary",
      "The drawer reads a store that no longer exists.",
      "--observation",
      "GraphGroupingLayer is imported only by its own test.",
      "--observation",
      "detectHostTelemetry ignores its agentId argument.",
      "--todo",
      "Wire the grouping layer to sections.",
      "--todo",
      "Delete the duplicate asset writes.",
      "--risk",
      "The shipped fixture predates the new schema.",
      "--open-question",
      "Does gvui still read metadata.mediaAssets?",
      "--source",
      "src/graph/store.ts",
      "--source",
      "src/graph/layers.ts",
    ]);

    const markdown = await readFile(join(run, "planning", "enhanced-plan.md"), "utf-8");
    expect(markdown).toContain("# Enhanced Plan — plan-enhance-run");
    expect(markdown).toContain("1. Wire the grouping layer to sections.");
    expect(markdown).toContain("2. Delete the duplicate asset writes.");
    expect(markdown).toContain("- GraphGroupingLayer is imported only by its own test.");
    expect(markdown).toContain("- The shipped fixture predates the new schema.");
    expect(markdown).toContain("- Does gvui still read metadata.mediaAssets?");
    expect(markdown).toContain("- `src/graph/store.ts`");
    expect(markdown).toContain("**Derived, not authoritative.**");

    const json = JSON.parse(
      await readFile(join(run, "planning", "enhanced-plan.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(json.schema).toBe("harness.enhanced-plan");
    expect(json.authoritative).toBeFalse();
    expect(json.derived_from).toBe("prompt.md");
    expect(json.summary).toEqual({
      value: "The drawer reads a store that no longer exists.",
      evidence_class: "agent_reported",
    });
    expect(json.todos).toEqual([
      {
        id: "todo-1",
        text: "Wire the grouping layer to sections.",
        evidence_class: "agent_reported",
      },
      {
        id: "todo-2",
        text: "Delete the duplicate asset writes.",
        evidence_class: "agent_reported",
      },
    ]);

    const digest = createHash("sha256").update(Buffer.from(markdown, "utf-8")).digest("hex");
    const recorded = planningState(run);
    expect(recorded.markdown_sha256).toBe(digest);
    expect(recorded.markdown_path).toBe(join("planning", "enhanced-plan.md"));
    expect(recorded.json_path).toBe(join("planning", "enhanced-plan.json"));
    expect(recorded.revision).toBe(1);
    expect(recorded.evidence_class).toBe("agent_reported");
    expect(recorded.counts).toEqual({
      observations: 2,
      todos: 2,
      risks: 1,
      open_questions: 1,
      sources: 2,
    });

    const events = loadRun(run).events.filter((event) => event.kind === "plan-enhanced");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload.markdown_sha256).toBe(digest);
    expect(String(result.markdown)).toContain("### Enhanced Plan Recorded: plan-enhance-run");
    expect(String(result.markdown)).toContain("stays the requirement source");
  });

  test("both artifacts are written read-only", async () => {
    const run = await initialisedRun("plan-mode");
    await execute(["plan:enhance", "--run", run, "--actor", "planner", "--todo", "Read the store"]);

    expect(statSync(join(run, "planning", "enhanced-plan.md")).mode & 0o777).toBe(0o444);
    expect(statSync(join(run, "planning", "enhanced-plan.json")).mode & 0o777).toBe(0o444);
  });

  test("prompt.md keeps its bytes, digest and mode", async () => {
    const run = await initialisedRun("plan-immutable");
    const before = await readFile(join(run, "prompt.md"));
    const manifest = loadRun(run).manifest;

    await execute([
      "plan:enhance",
      "--run",
      run,
      "--actor",
      "planner",
      "--summary",
      "A summary that is not a requirement.",
    ]);

    const after = await readFile(join(run, "prompt.md"));
    expect(Buffer.from(after).equals(Buffer.from(before))).toBeTrue();
    expect(statSync(join(run, "prompt.md")).mode & 0o777).toBe(0o444);
    expect(loadRun(run).manifest.prompt_sha256).toBe(manifest.prompt_sha256);
    expect(planningState(run).prompt_sha256).toBe(manifest.prompt_sha256);
  });

  test("re-enhancing rewrites the read-only artifacts and raises the revision", async () => {
    const run = await initialisedRun("plan-redo");
    await execute(["plan:enhance", "--run", run, "--actor", "planner", "--todo", "First pass"]);
    const first = planningState(run);

    await execute([
      "plan:enhance",
      "--run",
      run,
      "--actor",
      "planner",
      "--todo",
      "Second pass, now that the repo has been read properly",
    ]);

    const second = planningState(run);
    expect(second.revision).toBe(2);
    expect(second.markdown_sha256).not.toBe(first.markdown_sha256);
    expect(await readFile(join(run, "planning", "enhanced-plan.md"), "utf-8")).toContain(
      "1. Second pass, now that the repo has been read properly",
    );
  });

  test("refuses to mint a document out of nothing", async () => {
    const run = await initialisedRun("plan-empty");

    await expect(
      execute(["plan:enhance", "--run", run, "--actor", "planner", "--source", "src/only.ts"]),
    ).rejects.toThrow(
      "plan:enhance needs at least one of --summary, --observation, --todo, --risk or --open-question",
    );
    expect(loadRun(run).state.planning).toBeUndefined();
  });

  test("an empty section says so rather than being dropped", async () => {
    const run = await initialisedRun("plan-sparse");
    await execute(["plan:enhance", "--run", run, "--actor", "planner", "--todo", "Only a to-do"]);

    const markdown = await readFile(join(run, "planning", "enhanced-plan.md"), "utf-8");
    expect(markdown).toContain("## Risks\n\n_Nothing reported._");
    expect(markdown).toContain("## Brief\n\n_Nothing reported._");
  });
});
