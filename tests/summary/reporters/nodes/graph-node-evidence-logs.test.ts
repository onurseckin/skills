import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateGraphDataset } from "../../../../olt/scripts/src/summary/graph/index.ts";
import {
  readLog,
  readLogText,
  LOG_READ_CEILING_BYTES,
} from "../../../../olt/scripts/src/summary/markdown/index.ts";
import { makeCommand, makeGrant, makeState, makeTask } from "../dag/graph-fixtures.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

function runRootWithStdout(contents: string): string {
  const root = mkdtempSync(join(tmpdir(), "node-evidence-"));
  roots.push(root);
  mkdirSync(join(root, "commands", "C-1"), { recursive: true });
  writeFileSync(join(root, "commands", "C-1", "stdout.log"), contents);
  return root;
}

describe("node scripts", () => {
  test("reads the real log bytes the runner wrote, whole", () => {
    const body = `${"x".repeat(8192)}TAIL-MARKER`;
    const runRoot = runRootWithStdout(body);
    const command = makeCommand("C-1", {
      task_id: "T-1",
      logs: {
        stdout: { path: "commands/C-1/stdout.log", bytes: 4096, sha256: "a" },
        stderr: { path: "commands/C-1/stderr.log", bytes: 0, sha256: "b" },
      },
    });
    const dataset = generateGraphDataset({
      runId: "run-scripts",
      state: makeState([makeTask("T-1")]),
      commands: { "C-1": command },
      runRoot,
    });

    const script = dataset.nodes.find((node) => node.id === "node-task-T-1")?.scripts?.[0];
    expect(script?.commandId).toBe("C-1");
    expect(script?.argv).toEqual(["bun", "test"]);
    expect(script?.exitCode).toBe(0);
    expect(script?.durationMs).toBe(1000);
    expect(script?.evidence_class).toBe("harness_observed");
    expect(script?.stdoutTail).toBe(body);
    expect(script?.stdoutTruncated).toBeUndefined();
    expect(script?.stdoutBytes).toBe(4096);
    expect(script?.stdoutSha256).toBe("a");
    expect(script?.stderrTail).toBeUndefined();
  });

  test("flags the one case a log is clipped, and never clips silently", () => {
    const runRoot = runRootWithStdout(`HEAD${"x".repeat(200)}TAIL-MARKER`);
    const clipped = readLog("commands/C-1/stdout.log", runRoot, 32);
    expect(clipped?.truncated).toBe(true);
    expect(clipped?.text.endsWith("TAIL-MARKER")).toBe(true);
    expect(clipped?.text.includes("HEAD")).toBe(false);
    const whole = readLog("commands/C-1/stdout.log", runRoot);
    expect(whole?.truncated).toBe(false);
    expect(whole?.text.startsWith("HEAD")).toBe(true);
    expect(LOG_READ_CEILING_BYTES).toBeGreaterThan(1024 * 1024);
  });

  test("leaves the log absent when the file is missing", () => {
    expect(readLog("commands/C-1/stdout.log", "/nonexistent")).toBeUndefined();
    expect(readLog(undefined)).toBeUndefined();
    expect(readLogText(undefined)).toBeUndefined();
  });
});

describe("node tools", () => {
  test("come from the grant ledger with their own evidence class", () => {
    const grants = [
      makeGrant("worker-1", {
        tools_used: [
          {
            name: "Edit",
            evidence_class: "host_reported",
            first_reported_at: "2026-08-14T20:01:00.000Z",
          },
        ],
        tools_granted: {
          value: [{ name: "Edit" }, { name: "Bash", category: "shell" }],
          evidence_class: "agent_reported",
        },
      }),
    ];
    const task = makeTask("T-1", {
      lease: {
        agent_id: "worker-1",
        role: "implementer",
        attempt: 1,
        token_digest: "tok",
        issued_at: "2026-08-14T20:00:00.000Z",
        expires_at: "2026-08-14T21:00:00.000Z",
        heartbeat_at: "2026-08-14T20:00:00.000Z",
        duration_seconds: 3600,
        write_scope: ["src/T-1.ts"],
        resource_scope: [],
      },
    });
    const dataset = generateGraphDataset({
      runId: "run-tools",
      state: makeState([task], { agents: grants }),
    });

    expect(dataset.nodes.find((node) => node.id === "node-task-T-1")?.tools).toEqual([
      {
        name: "Edit",
        evidence_class: "host_reported",
        firstReportedAt: "2026-08-14T20:01:00.000Z",
      },
      { name: "Bash", category: "shell", evidence_class: "agent_reported" },
    ]);
  });

  test("are absent for an agent with no grant", () => {
    const dataset = generateGraphDataset({
      runId: "run-no-tools",
      state: makeState([makeTask("T-1")]),
    });
    expect(dataset.nodes.find((node) => node.id === "node-task-T-1")?.tools).toBeUndefined();
  });
});
