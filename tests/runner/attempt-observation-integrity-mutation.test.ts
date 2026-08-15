import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RepositoryBinding } from "../../orchestrating-long-tasks/scripts/src/contracts/repository.ts";
import { createInternalCommandRunner } from "../../orchestrating-long-tasks/scripts/src/runner/internal-command-runner.ts";
import { embeddedCommandIssues } from "../../orchestrating-long-tasks/scripts/src/runner/command-shape.ts";
import type { AttemptResult } from "../../orchestrating-long-tasks/scripts/src/runner/types.ts";

const roots: string[] = [];
const digest = (marker: string): string => marker.repeat(64);

function binding(marker: string): RepositoryBinding {
  return {
    schema: "harness.repository-binding",
    version: 1,
    inspection_sha256: digest(marker),
    git_identity_sha256: digest(marker),
    content_sha256: digest(marker),
    file_count: 1,
    total_bytes: 17,
  };
}

function succeeded(id: string, attempt: number, commandRoot: string): AttemptResult {
  const base = `commands/${id}/attempt-${attempt}`;
  const metadata = (name: string) => ({ path: `${base}/${name}`, bytes: 0, sha256: digest("0") });
  const record = {
    id,
    attempt,
    status: "succeeded" as const,
    started_at: "2026-08-14T00:00:00.000Z",
    finished_at: "2026-08-14T00:00:01.000Z",
    exit_code: 0,
    signal: null,
    signals_sent: [],
    timeout_kind: null,
    failure_class: null,
    activity_path: `${base}/activity.json`,
    activity: metadata("activity.json"),
    logs: { stdout: metadata("stdout.log"), stderr: metadata("stderr.log") },
  };
  return {
    record,
    attempt,
    stdoutPath: join(commandRoot, `attempt-${attempt}`, "stdout.log"),
    stderrPath: join(commandRoot, `attempt-${attempt}`, "stderr.log"),
    activityPath: join(commandRoot, `attempt-${attempt}`, "activity.json"),
    outputTail: "",
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("gate observation aggregate mutations", () => {
  test("rejects an aggregate post-binding different from its final attempt", async () => {
    const root = await mkdtemp(join(tmpdir(), "attempt-binding-mismatch-"));
    roots.push(root);
    const runRoot = join(root, ".capsules");
    await mkdir(join(runRoot, "commands"), { recursive: true });
    await mkdir(join(root, "bin"));
    await writeFile(join(root, "bin", "verify"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });

    const runner = createInternalCommandRunner({
      inspectRepository: () => binding("a"),
      attempt: async (_options, attempt, id, commandRoot) => succeeded(id, attempt, commandRoot),
    });
    const prepared = await runner.prepareCommand({
      argv: ["./bin/verify"],
      cwd: root,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
      gateId: "G-binding-mismatch",
    });
    const result = await runner.executePreparedCommand(prepared);
    for (const value of ["", null, 0]) {
      const forged = structuredClone(result.record) as Record<string, unknown>;
      forged.evidence_error = value;
      expect(embeddedCommandIssues(forged as never)).toContain("command evidence error is invalid");
    }
    for (const [label, mutate] of [
      ["finished_at", (record: typeof result.record) => { record.finished_at = "2026-08-15T00:00:00.000Z"; }],
      ["timeout_kind", (record: typeof result.record) => { record.timeout_kind = "wall"; }],
      ["signals_sent", (record: typeof result.record) => { record.signals_sent = ["SIGTERM"]; }],
    ] as const) {
      const forged = structuredClone(result.record);
      mutate(forged);
      expect(embeddedCommandIssues(forged), label).toContain(
        "aggregate command does not match its final attempt",
      );
    }
    result.record.repository_after = binding("b");
    expect(embeddedCommandIssues(result.record)).toContain(
      "aggregate repository_after does not match its final attempt",
    );
    result.record.attempts![0]!.repository_after = binding("b");
    expect(embeddedCommandIssues(result.record)).toContain(
      "gate repository drift lacks an attempt integrity failure",
    );
  });
});
