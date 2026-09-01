import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { generateGraphDataset } from "../../../olt/scripts/src/summary/graph/index.ts";
import type { ScreenshotRecord } from "../../../olt/scripts/src/reporting/screenshot-types.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";
import { makeCommand, makeState, makeTask } from "../reporters/dag/graph-fixtures.ts";

const vfs = new Map<string, string>();
let rootCounter = 0;
const spies: Array<{ mockRestore: () => void }> = [];

const origExists = fs.existsSync.bind(fs);
const origRead = fs.readFileSync.bind(fs);

beforeEach(() => {
  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike): boolean => {
      const s = String(p);
      if (s.startsWith("/virtual/")) {
        return vfs.has(s);
      }
      return origExists(p);
    }),
    spyOn(fs, "readFileSync").mockImplementation(
      (p: fs.PathLike, opt?: unknown): string | Buffer => {
        const s = String(p);
        if (s.startsWith("/virtual/")) {
          const content = vfs.get(s);
          if (content === undefined) {
            throw new Error(`ENOENT: no such file or directory, open '${s}'`);
          }
          if (opt === "utf-8" || opt === "utf8" || (typeof opt === "object" && opt !== null)) {
            return content;
          }
          return Buffer.from(content, "utf-8");
        }
        return origRead(p, opt as Parameters<typeof origRead>[1]) as string | Buffer;
      },
    ),
  );
});

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
});

function runRootWithScreenshots(records: ScreenshotRecord[]): string {
  rootCounter += 1;
  const root = `/virtual/screenshot-attribution-${rootCounter}`;
  vfs.set(
    join(root, "captures.json"),
    JSON.stringify({ schema: "harness.captures", version: 1, captures: records }),
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
    const cmd = makeCommand("CMD-SELF-STYLED", { actor: "critic" });
    const dataset = generateGraphDataset({
      runId: "run-critic-attribution",
      state: makeState([reviewedTask()], {
        commands: { "CMD-SELF-STYLED": cmd },
      }),
    });
    const critic = dataset.nodes.find((node) => node.kind === "critic");

    expect((critic?.scripts ?? []).map((script) => script.commandId)).not.toContain(
      "CMD-SELF-STYLED",
    );
  });
});
