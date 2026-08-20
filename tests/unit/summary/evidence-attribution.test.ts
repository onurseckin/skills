import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateGraphDataset } from "../../../orchestrating-long-tasks/scripts/src/summary/graph-generator.ts";
import type { ScreenshotRecord } from "../../../orchestrating-long-tasks/scripts/src/reporting/screenshot-types.ts";
import type { TaskRecord } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { makeCommand, makeState, makeTask } from "./graph-fixtures.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runRootWithScreenshots(records: ScreenshotRecord[]): string {
  const root = mkdtempSync(join(tmpdir(), "screenshot-attribution-"));
  roots.push(root);
  writeFileSync(
    join(root, "captures.json"),
    JSON.stringify({ schema: "harness.captures", version: 1, captures: records }),
    "utf-8",
  );
  return root;
}

function screenshot(name: string, actor: string): ScreenshotRecord {
  return {
    kind: "screenshot",
    name,
    sha256: `${name.replace(/[^a-f0-9]/gu, "0")}`.padEnd(64, "0").slice(0, 64),
    bytes: 11,
    blob_path: `blobs/aa/${name}`,
    path: `evidence/screenshots/${name}`,
    storage: "hardlink",
    original_path: `/repo/test-results/${name}`,
    timestamp: "2026-08-15T19:00:00.000Z",
    task_id: "T-1",
    actor,
  };
}

function reviewedTask(): TaskRecord {
  return makeTask("T-1", {
    status: "done",
    report: { summary: "done", files_changed: ["src/T-1.ts"] },
    lease: {
      agent_id: "impl-7",
      role: "implementer",
      attempt: 1,
      token_digest: "tok",
      issued_at: "2026-08-15T18:00:00.000Z",
      expires_at: "2026-08-15T20:00:00.000Z",
      heartbeat_at: "2026-08-15T18:30:00.000Z",
      duration_seconds: 7200,
      write_scope: ["src/T-1.ts"],
      resource_scope: [],
    },
    validations: [
      {
        validator_id: "reviewer-2",
        domain: "code-quality",
        token_digest: "tok",
        attempt: 1,
        started_at: "2026-08-15T19:00:00.000Z",
        deadline_at: "2026-08-15T19:10:00.000Z",
        verdict: "pass",
      },
    ],
  });
}

function datasetFor(runRoot: string) {
  return generateGraphDataset({
    runId: "run-attribution",
    state: makeState([reviewedTask()]),
    runRoot,
  });
}

function assetUrls(nodeId: string, runRoot: string): string[] {
  const dataset = datasetFor(runRoot);
  return (dataset.nodes.find((node) => node.id === nodeId)?.assets ?? []).map((asset) => asset.url);
}

describe("screenshot attribution follows the recorded agent, not the agent's name", () => {
  test("evidence goes to the node whose recorded agent captured it", () => {
    const runRoot = runRootWithScreenshots([
      screenshot("impl-shot.png", "impl-7"),
      screenshot("review-shot.png", "reviewer-2"),
    ]);

    expect(assetUrls("node-task-T-1", runRoot)).toContain("evidence/screenshots/impl-shot.png");
    expect(assetUrls("node-validator-T-1", runRoot)).toContain(
      "evidence/screenshots/review-shot.png",
    );
  });

  test("an actor the task never named claims neither node, whatever it is called", () => {
    const runRoot = runRootWithScreenshots([screenshot("ghost-shot.png", "val")]);

    expect(assetUrls("node-task-T-1", runRoot)).not.toContain(
      "evidence/screenshots/ghost-shot.png",
    );
    expect(assetUrls("node-validator-T-1", runRoot)).not.toContain(
      "evidence/screenshots/ghost-shot.png",
    );
  });

  test("evidence no node claimed is still in the dataset, marked unattributed", () => {
    const runRoot = runRootWithScreenshots([screenshot("ghost-shot.png", "val")]);
    const dataset = datasetFor(runRoot);
    const terminal = dataset.nodes.find((node) => node.id === "node-terminal-complete");
    const ghost = (terminal?.assets ?? []).find(
      (asset) => asset.url === "evidence/screenshots/ghost-shot.png",
    );

    // Dropping the substring match must not drop the evidence: it is relocated and labelled, so a
    // screenshot the run recorded is never silently absent from the graph.
    expect(ghost).toBeDefined();
    expect(ghost?.metadata?.attribution).toBe("unattributed");
    expect(ghost?.author).toBe("val");
  });
});

describe("command attribution follows the recorded agent, not the agent's name", () => {
  function scriptedCommands(nodeId: string, commands: ReturnType<typeof makeCommand>[]): string[] {
    const dataset = generateGraphDataset({
      runId: "run-command-attribution",
      state: makeState([reviewedTask()], {
        commands: Object.fromEntries(commands.map((command) => [command.id, command])),
      }),
    });
    return (dataset.nodes.find((node) => node.id === nodeId)?.scripts ?? []).map(
      (script) => script.commandId,
    );
  }

  test("an agent called validator is not the task's validator", () => {
    const commands = [
      makeCommand("CMD-IMPOSTER", { task_id: "T-1", actor: "validator" }),
      makeCommand("CMD-REVIEW", { task_id: "T-1", actor: "reviewer-2" }),
    ];

    expect(scriptedCommands("node-task-T-1", commands)).toContain("CMD-IMPOSTER");
    expect(scriptedCommands("node-validator-T-1", commands)).toEqual(["CMD-REVIEW"]);
  });

  test("an agent called critic owns nothing until the run authorises it", () => {
    const commands = [makeCommand("CMD-SELF-STYLED", { actor: "critic" })];
    const dataset = generateGraphDataset({
      runId: "run-critic-attribution",
      state: makeState([reviewedTask()], {
        commands: { "CMD-SELF-STYLED": commands[0] },
      }),
    });
    const critic = dataset.nodes.find((node) => node.kind === "critic");

    expect((critic?.scripts ?? []).map((script) => script.commandId)).not.toContain(
      "CMD-SELF-STYLED",
    );
  });
});
