import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertGrantedCommand,
  installMetaAuditGrant,
  spec,
} from "../authority/command-authority-fixture.ts";
import { assertGrantedCommand as assertRawGrantedCommand } from "../../../../olt/scripts/src/packets/command-authority.ts";
import { initRun } from "../../../../olt/scripts/src/engine/store/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { emptyGrantRun } from "../../validation/grants/grant-run-fixture.ts";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import { registerSessionGrant } from "../../../../olt/scripts/src/authority/session/index.ts";

describe("assertGrantedCommand hole 1: no --run resolves", () => {
  test("denies a non-allowlisted command with no --run", () => {
    expect(() => assertGrantedCommand(spec("task:heartbeat"), {})).toThrow(
      "not on the grant bootstrap allowlist",
    );
  });

  test("permits mind:init, which structurally never carries --run", () => {
    expect(() => assertGrantedCommand(spec("mind:init"), { actor: "owner" })).not.toThrow();
  });

  test("permits previously-stranded context-free commands that declare no run/run-id flag at all", () => {
    expect(() => assertGrantedCommand(spec("queue:status"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("install"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("report:usage"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("quota:check"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("agent:define"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("coverage:check"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("capture:init"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("capture:eval"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("smart-task:plan"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("smart-task:ingest"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("installation-status"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("mind:audit:live"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("queue:add"), {})).not.toThrow();
    expect(() => assertGrantedCommand(spec("queue:drain"), {})).toThrow("authority-run");
    expect(() => assertGrantedCommand(spec("queue:seal"), {})).toThrow("authority-run");
    expect(() => assertGrantedCommand(spec("queue:clean"), {})).toThrow("authority-run");
  });

  test("denies a command that declares an optional run flag but omits it, distinct from one that declares none", () => {
    expect(() => assertGrantedCommand(spec("shell"), { actor: "someone" })).toThrow(
      "not on the grant bootstrap allowlist",
    );
    expect(() => assertGrantedCommand(spec("scope:expand"), { actor: "someone" })).toThrow(
      "not on the grant bootstrap allowlist",
    );
  });
});

describe("governed mutation authority", () => {
  test("denies every governed mutator without a session using the same fail-closed error", async () => {
    const { run } = await emptyGrantRun("governed-mutator-no-session-");
    const invocations = [
      ["queue:drain", "--authority-run", run],
      ["queue:seal", "--authority-run", run, "--id", "feedback-1", "--resolution", "done"],
      ["queue:clean", "--authority-run", run],
      ["watchdog:cleanup", "--authority-run", run, "--run", run],
      ["watchdog:phase-cleanup", "--authority-run", run, "--run", run, "--phase", "plan"],
    ];
    const messages: string[] = [];
    for (const argv of invocations) {
      try {
        await execute(argv);
      } catch (error) {
        if (!(error instanceof HarnessError)) throw error;
        messages.push(error.message);
      }
    }
    expect(messages).toEqual([
      "governed mutation requires a verified caller session backed by an active authority-run grant; explicit identity flags cannot establish authority",
      "governed mutation requires a verified caller session backed by an active authority-run grant; explicit identity flags cannot establish authority",
      "governed mutation requires a verified caller session backed by an active authority-run grant; explicit identity flags cannot establish authority",
      "governed mutation requires a verified caller session backed by an active authority-run grant; explicit identity flags cannot establish authority",
      "governed mutation requires a verified caller session backed by an active authority-run grant; explicit identity flags cannot establish authority",
    ]);
  });

  test("keeps queue inspection and intake context-free", async () => {
    const { repo } = await emptyGrantRun("queue-context-free-");
    const queueFile = join(repo, ".olt", "context-free-backlog.jsonl");
    await expect(execute(["queue:status", "--queue-file", queueFile])).resolves.toBeDefined();
    await expect(
      execute([
        "queue:add",
        "--title",
        "External intake",
        "--content",
        "Intake remains context-free",
        "--queue-file",
        queueFile,
      ]),
    ).resolves.toMatchObject({
      item: { title: "External intake" },
    });
  });

  test("permits only an active Mind and binds mutation paths to its authority repository", async () => {
    const { repo, run } = await emptyGrantRun("governed-mutator-mind-");
    installMetaAuditGrant(run, "mind", "mind");
    registerSessionGrant({ runRoot: run, agentId: "mind", role: "mind" });

    const queueFile = join(repo, ".olt", "governed-backlog.jsonl");
    const result = await execute([
      "queue:drain",
      "--authority-run",
      run,
      "--actor",
      "mind",
      "--queue-file",
      queueFile,
    ]);
    expect(result.drainedCount).toBe(0);

    const outside = join(repo, "..", "outside-governed-backlog.jsonl");
    await expect(
      execute(["queue:drain", "--authority-run", run, "--actor", "mind", "--queue-file", outside]),
    ).rejects.toMatchObject({ code: "PATH_SAFETY" });
    expect(existsSync(outside)).toBe(false);
  });

  test("rejects the direct-handler completed-file alias before an authorized clean can mutate queue state", async () => {
    const { repo, run } = await emptyGrantRun("governed-clean-unknown-completed-file-");
    installMetaAuditGrant(run, "mind", "mind");
    registerSessionGrant({ runRoot: run, agentId: "mind", role: "mind" });

    const oltDirectory = join(repo, ".olt");
    const queueFile = join(oltDirectory, "backlog.jsonl");
    const archiveFile = join(oltDirectory, "completed-tasks.jsonl");
    const outsideArchive = join(repo, "..", "outside-clean-completed-tasks.jsonl");
    const queueBytes =
      '{"id":"feedback-1","timestamp":"2026-01-01T00:00:00.000Z","priority":"NORMAL","status":"COMPLETED","category":"GENERAL","title":"Completed feedback","content":"must remain queued"}\n';
    const archiveBytes = "canonical archive sentinel\n";
    const outsideBytes = "outside archive sentinel\n";
    await mkdir(oltDirectory, { recursive: true });
    await writeFile(queueFile, queueBytes);
    await writeFile(archiveFile, archiveBytes);
    await writeFile(outsideArchive, outsideBytes);

    await expect(
      execute(["queue:clean", "--authority-run", run, "--completed-file", outsideArchive]),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    await expect(readFile(queueFile, "utf8")).resolves.toBe(queueBytes);
    await expect(readFile(archiveFile, "utf8")).resolves.toBe(archiveBytes);
    await expect(readFile(outsideArchive, "utf8")).resolves.toBe(outsideBytes);
  });

  test("rejects an archive path that traverses an in-repository symlink before clean can mutate outside state", async () => {
    const { repo, run } = await emptyGrantRun("governed-clean-symlink-archive-");
    installMetaAuditGrant(run, "mind", "mind");
    registerSessionGrant({ runRoot: run, agentId: "mind", role: "mind" });

    const oltDirectory = join(repo, ".olt");
    const queueFile = join(oltDirectory, "backlog.jsonl");
    const outsideDirectory = join(repo, "..", "outside-archive");
    const outsideArchive = join(outsideDirectory, "completed-tasks.jsonl");
    const linkedDirectory = join(oltDirectory, "outside-archive-link");
    const linkedArchive = join(linkedDirectory, "completed-tasks.jsonl");
    const queueBytes =
      '{"id":"feedback-1","timestamp":"2026-01-01T00:00:00.000Z","priority":"NORMAL","status":"COMPLETED","category":"GENERAL","title":"Completed feedback","content":"must remain queued"}\n';
    const outsideBytes = "outside archive sentinel\n";
    await mkdir(oltDirectory, { recursive: true });
    await mkdir(outsideDirectory, { recursive: true });
    await writeFile(queueFile, queueBytes);
    await writeFile(outsideArchive, outsideBytes);
    await symlink(outsideDirectory, linkedDirectory);

    let thrown: unknown;
    try {
      await execute([
        "queue:clean",
        "--authority-run",
        run,
        "--actor",
        "mind",
        "--archive-file",
        linkedArchive,
      ]);
    } catch (error) {
      thrown = error;
    }

    await expect(readFile(outsideArchive, "utf8")).resolves.toBe(outsideBytes);
    await expect(readFile(queueFile, "utf8")).resolves.toBe(queueBytes);
    expect(thrown).toMatchObject({ code: "PATH_SAFETY" });
  });

  test("denies non-Mind, released, and mismatched authority-run callers", async () => {
    for (const [id, role, status] of [
      ["implementer", "implementer", "active"],
      ["validator", "validator", "active"],
      ["skill-auditor", "skill-auditor", "active"],
      ["released-mind", "mind", "released"],
    ] as const) {
      const { run } = await emptyGrantRun(`governed-mutator-${id}-`);
      installMetaAuditGrant(run, id, role, status);
      expect(() =>
        assertRawGrantedCommand(
          spec("mind:queue:drain"),
          { "authority-run": run, actor: id },
          { actor: id, role, verified: true },
        ),
      ).toThrow();
    }

    const { repo, run } = await emptyGrantRun("governed-mutator-mismatch-");
    const otherRun = initRun(repo, "second-run", new TextEncoder().encode("prompt"), "file", true);
    installMetaAuditGrant(run, "mind", "mind");
    registerSessionGrant({ runRoot: run, agentId: "mind", role: "mind" });
    await expect(
      execute(["watchdog:cleanup", "--authority-run", otherRun, "--run", run, "--actor", "mind"]),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_FAILURE" });
  });
});
