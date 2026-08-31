import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSignedEnvelope } from "../../../olt/scripts/src/communication/mailbox/envelope.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { transact } from "../../../olt/scripts/src/engine/store/events/transaction.ts";
import {
  autoHealCapsule,
  quarantineTornTail,
} from "../../../olt/scripts/src/reporting/doctor/auto-heal.ts";
import {
  autoHealMailboxState,
  checkMailboxDiskActivity,
  checkMailboxHealth,
  healCorruptedCursor,
} from "../../../olt/scripts/src/reporting/doctor/mailbox-health-engine.ts";

export const mailboxHealthQuarantineSuiteName = "Mailbox Health Quarantine & Torn-Tail Auto-Repair Suite";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe(mailboxHealthQuarantineSuiteName, () => {
  test("checkMailboxDiskActivity detects quarantine log and corrupt envelopes", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "mb-quarantine-detect-"));
    roots.push(scratch);

    const agentDir = join(scratch, ".olt", "mailboxes", "agent-worker-1");
    mkdirSync(agentDir, { recursive: true });

    writeFileSync(
      join(agentDir, "quarantine.log"),
      "corrupted-payload-entry-1\ncorrupted-payload-entry-2\n",
    );
    writeFileSync(join(agentDir, "inbox.jsonl"), '{"id":"m1","sequence":1}\n{"torn_tail_line\n');
    writeFileSync(
      join(agentDir, "cursor.json"),
      JSON.stringify({
        last_read_sequence: 1,
        last_read_id: "m1",
        seen_ids: ["m1"],
        updated_at: new Date().toISOString(),
      }),
    );

    const res = checkMailboxDiskActivity(scratch);
    expect(res.passed).toBe(false);

    const qFinding = res.findings.find((f) => f.code === "MAILBOX_QUARANTINE_PRESENT");
    expect(qFinding).toBeDefined();
    expect(qFinding?.severity).toBe("WARN");

    const corruptFinding = res.findings.find((f) => f.code === "MAILBOX_DISK_CORRUPT_ENVELOPE");
    expect(corruptFinding).toBeDefined();
    expect(corruptFinding?.severity).toBe("ERROR");
  });

  test("healCorruptedCursor rebuilds cursor from valid inbox envelopes", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "mb-cursor-heal-"));
    roots.push(scratch);

    const agentDir = join(scratch, ".olt", "mailboxes", "agent-rebuild");
    mkdirSync(agentDir, { recursive: true });

    const env1 = createSignedEnvelope({
      sequence: 1,
      senderId: "coordinator",
      recipientId: "agent-rebuild",
      messageType: "NOTIFICATION",
      correlationId: "corr-101",
      payload: { taskId: "task-1" },
    });
    const env2 = createSignedEnvelope({
      sequence: 2,
      senderId: "coordinator",
      recipientId: "agent-rebuild",
      messageType: "NOTIFICATION",
      correlationId: "corr-102",
      payload: { taskId: "task-2" },
    });

    writeFileSync(
      join(agentDir, "inbox.jsonl"),
      `${JSON.stringify(env1)}\n${JSON.stringify(env2)}\n`,
    );
    writeFileSync(join(agentDir, "cursor.json"), "{ invalid-json-cursor-state");

    const cursorPath = join(agentDir, "cursor.json");
    const inboxPath = join(agentDir, "inbox.jsonl");

    const healed = healCorruptedCursor(cursorPath, inboxPath);
    expect(healed).toBe(true);

    const parsedCursor = JSON.parse(readFileSync(cursorPath, "utf8")) as {
      last_read_sequence: number;
      last_read_id: string;
      seen_ids: string[];
    };
    expect(parsedCursor.last_read_sequence).toBe(2);
    expect(parsedCursor.last_read_id).toBe(env2.id);
    expect(parsedCursor.seen_ids).toEqual([env1.id, env2.id]);
  });

  test("autoHealMailboxState repairs corrupt cursors and prunes inactive agents", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "mb-autoheal-state-"));
    roots.push(scratch);

    const mailboxesDir = join(scratch, ".olt", "mailboxes");
    const activeDir = join(mailboxesDir, "agent-active");
    const orphanDir = join(mailboxesDir, "agent-orphan");
    mkdirSync(activeDir, { recursive: true });
    mkdirSync(orphanDir, { recursive: true });

    writeFileSync(join(activeDir, "cursor.json"), "corrupt");
    writeFileSync(join(orphanDir, "cursor.json"), "corrupt");
    writeFileSync(join(orphanDir, "inbox.jsonl"), '{"stale":true}\n');

    const healedLog = autoHealMailboxState({
      repoRoot: scratch,
      activeAgentIds: ["agent-active"],
    });

    expect(
      healedLog.some((msg) => msg.includes("Rebuilt corrupted cursor for mailbox 'agent-active'")),
    ).toBe(true);
    expect(healedLog.some((msg) => msg.includes("Pruned orphaned mailbox 'agent-orphan'"))).toBe(
      true,
    );
  });

  test("quarantineTornTail writes damaged byte sequences with deterministic hash", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "torn-tail-quarantine-"));
    roots.push(scratch);

    const tornData = Buffer.from('{"incomplete_event": true, "bytes": [0x41,', "utf-8");
    const fileName = quarantineTornTail(scratch, tornData);

    expect(fileName).toMatch(/^\d+-torn-tail-[a-f0-9]{12}\.json$/u);
    const quarantinePath = join(scratch, "quarantine", fileName);
    expect(existsSync(quarantinePath)).toBe(true);
    expect(readFileSync(quarantinePath, "utf-8")).toBe(tornData.toString("utf-8"));
  });

  test("autoHealCapsule rescues corrupted state.json and archives torn tail fragments", async () => {
    const repo = await mkdtemp(join(tmpdir(), "capsule-torn-heal-"));
    roots.push(repo);
    mkdirSync(join(repo, ".git"), { recursive: true });

    const runRoot = initRun(
      repo,
      "capsule-torn-run",
      new TextEncoder().encode("Build test system"),
      "file",
      true,
    );

    transact(runRoot, "coord", "task-planned", { taskId: "task-1" }, (draft) => {
      draft.tasks = { "task-1": { id: "task-1", status: "ready" } };
    });

    writeFileSync(join(runRoot, "state.json"), '{"schema":"harness.state","corrupted":true');

    const tornTailBytes = Buffer.from('{"torn_event_tail": true', "utf-8");
    quarantineTornTail(runRoot, tornTailBytes);

    const healResult = autoHealCapsule(runRoot, { repoRoot: repo });
    expect(healResult.projectionRecovered).toBe(true);
    expect(healResult.quarantinedFragments.length).toBeGreaterThan(0);
    expect(healResult.autoHealed.some((msg) => msg.includes("Recovered state projection"))).toBe(
      true,
    );

    const stateContent = JSON.parse(readFileSync(join(runRoot, "state.json"), "utf8")) as {
      event_sequence: number;
      tasks: Record<string, { id: string }>;
    };
    expect(stateContent.event_sequence).toBeGreaterThanOrEqual(1);
    expect(stateContent.tasks["task-1"]?.id).toBe("task-1");
  });

  test("checkMailboxHealth verifies end-to-end clean state after auto-repair", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "mb-clean-after-heal-"));
    roots.push(scratch);

    const agentDir = join(scratch, ".olt", "mailboxes", "agent-good");
    mkdirSync(agentDir, { recursive: true });

    const env = createSignedEnvelope({
      sequence: 1,
      senderId: "coord",
      recipientId: "agent-good",
      messageType: "INFO",
      correlationId: "corr-good",
      payload: { status: "ok" },
    });

    writeFileSync(join(agentDir, "inbox.jsonl"), `${JSON.stringify(env)}\n`);
    writeFileSync(
      join(agentDir, "cursor.json"),
      JSON.stringify({
        last_read_sequence: 1,
        last_read_id: env.id,
        seen_ids: [env.id],
        updated_at: new Date().toISOString(),
      }),
    );

    const checkRes = await checkMailboxHealth({ repoRoot: scratch, autoHeal: true });
    expect(checkRes.passed).toBe(true);
    expect(checkRes.findings).toHaveLength(0);
  });
});
