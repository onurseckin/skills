import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  CommandAttemptRecord,
  CommandRecord,
} from "../../../orchestrating-long-tasks/scripts/src/contracts/commands.ts";
import type { RepositoryBinding } from "../../../orchestrating-long-tasks/scripts/src/contracts/repository.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import { embeddedCommandIssues } from "../../../orchestrating-long-tasks/scripts/src/runner/command-shape.ts";
import { createInternalCommandRunner } from "../../../orchestrating-long-tasks/scripts/src/runner/internal-command-runner.ts";
import type { AttemptResult } from "../../../orchestrating-long-tasks/scripts/src/runner/types.ts";

const roots: string[] = [];
const digest = (value: string): string => value.repeat(64).slice(0, 64);

function binding(marker = "a"): RepositoryBinding {
  return {
    schema: "harness.repository-binding",
    version: 1,
    inspection_sha256: digest(marker),
    git_identity_sha256: digest(marker),
    content_sha256: digest(marker),
    file_count: 2,
    total_bytes: 17,
  };
}

function success(id: string): AttemptResult {
  const empty = { path: "empty", bytes: 0, sha256: digest("e") };
  const record: CommandAttemptRecord = {
    id,
    attempt: 1,
    status: "succeeded",
    started_at: "2026-08-14T00:00:00.000Z",
    finished_at: "2026-08-14T00:00:01.000Z",
    exit_code: 0,
    signal: null,
    signals_sent: [],
    timeout_kind: null,
    failure_class: null,
    activity_path: "empty",
    activity: empty,
    logs: { stdout: empty, stderr: empty },
  };
  return {
    record,
    attempt: 1,
    stdoutPath: "empty",
    stderrPath: "empty",
    activityPath: "empty",
    outputTail: "",
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "trusted-host-observation-"));
  roots.push(root);
  await mkdir(join(root, "bin"));
  await mkdir(join(root, ".capsules", "commands"), { recursive: true });
  await writeFile(join(root, "bin", "verify"), "#!/bin/sh\nexit 0\n");
  await chmod(join(root, "bin", "verify"), 0o700);
  return {
    root,
    input: {
      argv: ["./bin/verify"],
      cwd: root,
      runRoot: join(root, ".capsules"),
      commandDir: join(root, ".capsules", "commands"),
      actor: "validator",
      gateId: "G-observed",
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("trusted-host command observations", () => {
  test("rejects gate artifacts outside the fixed top-level harness exclusion", async () => {
    const { root, input } = await fixture();
    let observed = false;
    const runner = createInternalCommandRunner({
      inspectRepository: () => {
        observed = true;
        return binding();
      },
      attempt: async () => {
        throw new Error("must not run");
      },
    });

    await expect(
      runner.prepareCommand({
        ...input,
        runRoot: root,
        commandDir: join(root, "commands"),
      }),
    ).rejects.toThrow(/gate.*artifact|\.capsules/i);

    expect(observed).toBeFalse();
    expect(existsSync(join(root, "commands"))).toBeFalse();
  });

  test("requires the exact assurance and compact repository intent shape", async () => {
    const { input } = await fixture();
    const before = binding();
    let observed = false;
    const runner = createInternalCommandRunner({
      inspectRepository: () => {
        observed = true;
        return before;
      },
      attempt: async () => {
        throw new Error("must not run");
      },
    });
    const prepared = await runner.prepareCommand(input);
    expect(prepared.record).toMatchObject({
      assurance: "trusted_host_observed_v1",
      repository_before: before,
      repository_after: null,
    });

    for (const corrupt of [
      { assurance: undefined },
      { assurance: "unknown" },
      { repository_before: undefined },
      { repository_before: { ...before, version: 2 } },
      { repository_after: undefined },
    ]) {
      const record = { ...prepared.record, ...corrupt } as CommandRecord;
      expect(embeddedCommandIssues(record).join("\n")).toMatch(/assurance|repository/i);
    }

    observed = false;
    const nonGate = await runner.prepareCommand({ ...input, gateId: undefined });
    expect(observed).toBeFalse();
    expect(nonGate.record.assurance).toBeUndefined();
    expect(nonGate.record.repository_before).toBeUndefined();
    expect(nonGate.record.repository_after).toBeUndefined();
  });

  test("rejects content, mode, index, and ref drift before invoking an attempt", async () => {
    const changes: Array<[string, Partial<RepositoryBinding>]> = [
      ["content", { content_sha256: digest("b"), inspection_sha256: digest("b") }],
      ["mode", { content_sha256: digest("c"), inspection_sha256: digest("c") }],
      ["index", { git_identity_sha256: digest("d"), inspection_sha256: digest("d") }],
      ["ref", { git_identity_sha256: digest("f"), inspection_sha256: digest("f") }],
    ];
    for (const [label, change] of changes) {
      const { input } = await fixture();
      let observed = binding();
      let invoked = false;
      const runner = createInternalCommandRunner({
        inspectRepository: () => observed,
        attempt: async () => {
          invoked = true;
          throw new Error("must not run");
        },
      });
      const prepared = await runner.prepareCommand(input);
      observed = { ...observed, ...change };
      await expect(runner.executePreparedCommand(prepared), label).rejects.toThrow(
        /repository.*changed|observation/i,
      );
      expect(invoked, label).toBeFalse();
    }
  });

  test("rechecks the repository observation before a retry attempt", async () => {
    const { input } = await fixture();
    const before = binding();
    let observations = 0;
    const observer = {
      inspectRepository: () => (++observations < 3 ? before : binding("b")),
    };
    let attempts = 0;
    const runner = createInternalCommandRunner({
      ...observer,
      attempt: async (_options, _attempt, id) => {
        attempts += 1;
        const result = success(id);
        result.record.status = "failed";
        result.record.exit_code = 1;
        result.record.failure_class = "network_transient";
        result.failureClass = "network_transient";
        return result;
      },
    });
    const prepared = await runner.prepareCommand({ ...input, idempotent: true, retries: 1 });
    await expect(runner.executePreparedCommand(prepared)).rejects.toThrow(
      /repository.*changed|observation/i,
    );
    expect(attempts).toBe(1);
    expect(observations).toBe(3);
  });

  test("rejects an oversized observed intent before publishing record.json", async () => {
    const { input } = await fixture();
    const oversized = { ...binding(), padding: "x".repeat(16 * 1024 * 1024) } as RepositoryBinding;
    const runner = createInternalCommandRunner({
      inspectRepository: () => oversized,
      attempt: async () => {
        throw new Error("must not run");
      },
    });
    let error: unknown;
    try {
      await runner.prepareCommand(input);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(HarnessError);
    expect((error as HarnessError).code).toBe("INVALID_STATE");
    expect((error as Error).message).toMatch(/record.*size|size.*limit/i);
    expect(await readdir(input.commandDir)).toEqual([]);
  });
});
