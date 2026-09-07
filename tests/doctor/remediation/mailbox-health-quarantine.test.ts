import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createSignedEnvelope } from "../../../olt/scripts/src/communication/mailbox/envelope.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { transact } from "../../../olt/scripts/src/engine/store/events/transaction.ts";
import * as ah from "../../../olt/scripts/src/reporting/doctor/auto-heal.ts";
import * as mb from "../../../olt/scripts/src/reporting/doctor/mailbox-health-engine.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const mailboxHealthQuarantineSuiteName =
  "Mailbox Health Quarantine & Torn-Tail Auto-Repair Suite";

let vfs: VirtualMemoryFS;
let session: VirtualFSSession | null = null;

beforeEach(() => {
  vfs = new VirtualMemoryFS();
  vfs.mkdirSync(process.cwd(), { recursive: true });
  vfs.mkdirSync(join(process.cwd(), ".git"), { recursive: true });
  vfs.writeFileSync(join(process.cwd(), "package.json"), "{}");
  session = createVirtualFSSession(vfs);
});

afterEach(() => {
  session?.cleanup();
  session = null;
});

const makeEnv = (s: number, to: string, pl: Record<string, unknown> = {}) =>
  createSignedEnvelope({
    sequence: s,
    senderId: "a0",
    senderRole: "orchestrator",
    recipientId: to,
    messageType: "INFO",
    payload: pl,
  });

const setupAgent = (s: string, id: string) => {
  const ad = join(s, ".olt", "mailboxes", id);
  vfs.mkdirSync(ad, { recursive: true });
  return ad;
};

describe(mailboxHealthQuarantineSuiteName, () => {
  test("mailbox quarantine, cursor healing, auto-heal repair, torn-tail isolation, and state recovery", async () => {
    const ad1 = setupAgent("/v/repo-mb-q", "agent-torn");
    vfs.writeFileSync(join(ad1, "quarantine.log"), "quarantined bytes line 1\n");
    vfs.writeFileSync(join(ad1, "cursor.json"), "{ corrupted cursor json");
    vfs.writeFileSync(join(ad1, "inbox.jsonl"), "{ invalid envelope\n");
    const rep = mb.checkMailboxDiskActivity("/v/repo-mb-q");
    const codes = [
      "MAILBOX_QUARANTINE_PRESENT",
      "MAILBOX_CURSOR_CORRUPTED",
      "MAILBOX_DISK_CORRUPT_ENVELOPE",
    ];
    expect(!rep.passed && codes.every((c) => rep.findings.some((f) => f.code === c))).toBe(true);

    const ad2 = setupAgent("/v/repo-heal-c", "agent-1");
    const curP = join(ad2, "cursor.json");
    const inP = join(ad2, "inbox.jsonl");
    vfs.writeFileSync(curP, "CORRUPTED_JSON_DATA");
    const e1 = makeEnv(1, "agent-1", { x: 1 });
    const e2 = makeEnv(2, "agent-1", { x: 2 });
    vfs.writeFileSync(inP, `${JSON.stringify(e1)}\n${JSON.stringify(e2)}\n`);
    expect(mb.healCorruptedCursor(curP, inP)).toBe(true);
    const cur = JSON.parse(vfs.readFileSync(curP, "utf-8"));
    expect(cur.last_read_sequence === 2 && cur.last_read_id === e2.id).toBe(true);

    const s = "/v/repo-auto-heal-mb";
    const mbDir = join(s, ".olt", "mailboxes");
    vfs.mkdirSync(join(mbDir, "agent-active"), { recursive: true });
    vfs.mkdirSync(join(mbDir, "agent-orphan"), { recursive: true });
    vfs.writeFileSync(join(mbDir, "agent-active", "cursor.json"), "corrupt");
    vfs.writeFileSync(join(mbDir, "agent-orphan", "cursor.json"), "corrupt");
    vfs.writeFileSync(join(mbDir, "agent-orphan", "inbox.jsonl"), '{"stale":true}\n');
    const log = mb.autoHealMailboxState({ repoRoot: s, activeAgentIds: ["agent-active"] });
    expect(
      log.some((m) => m.includes("Rebuilt corrupted cursor for mailbox 'agent-active'")) &&
        log.some((m) => m.includes("Pruned orphaned mailbox 'agent-orphan'")),
    ).toBe(true);

    const sTorn = "/v/repo-quarantine-torn";
    vfs.mkdirSync(sTorn, { recursive: true });
    const tornData = Buffer.from('{"incomplete_event": true, "bytes": [0x41,', "utf-8");
    const fileName = ah.quarantineTornTail(sTorn, tornData);
    expect(/^\d+-torn-tail-[a-f0-9]{12}\.json$/u.test(fileName)).toBe(true);
    const qPath = join(sTorn, "quarantine", fileName);
    expect(
      vfs.existsSync(qPath) && vfs.readFileSync(qPath, "utf-8") === tornData.toString("utf-8"),
    ).toBe(true);

    const repo = "/v/repo-heal-capsule";
    vfs.mkdirSync(join(repo, ".git"), { recursive: true });
    const runRoot = initRun(
      repo,
      "capsule-torn-run",
      new TextEncoder().encode("Build test system"),
      "file",
      true,
    );
    transact(runRoot, "coord", "task-planned", { taskId: "task-1" }, (d) => {
      d.tasks = { "task-1": { id: "task-1", status: "ready" } as never };
    });
    const sp = join(runRoot, "state.json");
    vfs.writeFileSync(sp, '{"schema":"harness.state","corrupted":true');
    ah.quarantineTornTail(runRoot, Buffer.from('{"torn_event_tail": true', "utf-8"));
    const res = ah.autoHealCapsule(runRoot, { repoRoot: repo });
    const sc = JSON.parse(vfs.readFileSync(sp, "utf-8")) as {
      event_sequence: number;
      tasks: Record<string, { id: string }>;
    };
    expect(
      res.projectionRecovered &&
        res.quarantinedFragments.length > 0 &&
        res.autoHealed.some((m) => m.includes("Recovered state projection")) &&
        sc.event_sequence >= 1 &&
        sc.tasks["task-1"]?.id === "task-1",
    ).toBe(true);

    const adGood = setupAgent("/v/repo-e2e-mb", "agent-good");
    const envGood = makeEnv(1, "agent-good", { status: "ok" });
    vfs.writeFileSync(
      join(adGood, "cursor.json"),
      JSON.stringify({
        last_read_sequence: 1,
        last_read_id: envGood.id,
        seen_ids: [envGood.id],
        updated_at: new Date().toISOString(),
      }),
    );
    vfs.writeFileSync(join(adGood, "inbox.jsonl"), `${JSON.stringify(envGood)}\n`);
    const repClean = await mb.checkMailboxHealth({ repoRoot: "/v/repo-e2e-mb", autoHeal: true });
    expect(repClean.passed && repClean.findings.length === 0).toBe(true);
  });
});
