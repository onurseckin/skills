import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import * as mb from "../../../olt/scripts/src/reporting/doctor/mailbox-health-engine.ts";
import { createSignedEnvelope } from "../../../olt/scripts/src/communication/mailbox/envelope.ts";

export const mailboxHealthSuiteName = "Mailbox Health Engine Diagnostics";

const vfs = new Map<string, { isDir: boolean; content?: string; mtimeMs?: number }>();
const spies: Array<{ mockRestore: () => void }> = [];

function setupVirtualFs(): void {
  vfs.clear();
  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p) => vfs.has(String(p))),
    spyOn(fs, "statSync").mockImplementation((p) => {
      const s = String(p);
      const n = vfs.get(s);
      if (!n) throw new Error(`ENOENT: ${s}`);
      return {
        isFile: () => !n.isDir,
        isDirectory: () => n.isDir,
        isSymbolicLink: () => false,
        mode: n.isDir ? 0o755 : 0o644,
        size: n.content ? Buffer.byteLength(n.content) : 0,
        mtimeMs: n.mtimeMs ?? Date.now(),
      } as fs.Stats;
    }),
    spyOn(fs, "readdirSync").mockImplementation((p) => {
      const pref = `${String(p).replace(/\/+$/, "")}/`;
      const ent = new Set<string>();
      for (const k of vfs.keys())
        if (k.startsWith(pref) && k.length > pref.length) {
          const seg = k.slice(pref.length).split("/")[0];
          if (seg) ent.add(seg);
        }
      return Array.from(ent) as unknown as fs.Dirent[];
    }),
    spyOn(fs, "readFileSync").mockImplementation((p) => {
      const n = vfs.get(String(p));
      if (!n || n.content === undefined) throw new Error(`ENOENT: ${String(p)}`);
      return n.content;
    }),
    spyOn(fs, "writeFileSync").mockImplementation(
      (p, d) => (
        vfs.set(String(p), { content: String(d), isDir: false, mtimeMs: Date.now() }),
        undefined
      ),
    ),
    spyOn(fs, "mkdirSync").mockImplementation(
      (p) => (vfs.set(String(p), { isDir: true, mtimeMs: Date.now() }), undefined),
    ),
    spyOn(fs, "renameSync").mockImplementation((f, t) => {
      const n = vfs.get(String(f));
      if (n) {
        vfs.set(String(t), { content: n.content, isDir: n.isDir, mtimeMs: n.mtimeMs });
        vfs.delete(String(f));
      }
    }),
    spyOn(fs, "unlinkSync").mockImplementation((p) => (vfs.delete(String(p)), undefined)),
    spyOn(fs, "rmdirSync").mockImplementation((p) => (vfs.delete(String(p)), undefined)),
  );
}

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
});

const setupAgent = (scratch: string, agent: string) => {
  const dir = join(scratch, ".olt", "mailboxes", agent);
  vfs.set(scratch, { isDir: true });
  vfs.set(join(scratch, ".olt", "mailboxes"), { isDir: true });
  vfs.set(dir, { isDir: true });
  return dir;
};

const setCursor = (dir: string, seq = 0, id = "", seen: string[] = []) =>
  vfs.set(join(dir, "cursor.json"), {
    content: JSON.stringify({
      last_read_sequence: seq,
      last_read_id: id,
      seen_ids: seen,
      updated_at: new Date().toISOString(),
    }),
    isDir: false,
  });

describe(mailboxHealthSuiteName, () => {
  test("checkMailboxDiskActivity returns passed when mailboxes dir does not exist", () => {
    setupVirtualFs();
    const res = mb.checkMailboxDiskActivity("/non-existent-dir-for-doctor");
    expect(
      res.engine === "checkMailboxDiskActivity" && res.passed && res.findings.length === 0,
    ).toBe(true);
  });

  test("checkMailboxDiskActivity detects quarantine, corrupt cursor, and malformed envelopes", () => {
    setupVirtualFs();
    const dir = setupAgent("/virtual/mb-disk-activity", "agent-bad");
    vfs.set(join(dir, "quarantine.log"), {
      content: "corrupt data 1\ncorrupt data 2\n",
      isDir: false,
    });
    vfs.set(join(dir, "cursor.json"), { content: "invalid json", isDir: false });
    vfs.set(join(dir, "inbox.jsonl"), { content: "{ malformed line\n", isDir: false });

    const res = mb.checkMailboxDiskActivity("/virtual/mb-disk-activity");
    expect(res.engine === "checkMailboxDiskActivity" && !res.passed).toBe(true);
    expect(res.findings.some((f) => f.code === "MAILBOX_QUARANTINE_PRESENT")).toBe(true);
    expect(res.findings.some((f) => f.code === "MAILBOX_CURSOR_CORRUPTED")).toBe(true);
    expect(res.findings.some((f) => f.code === "MAILBOX_DISK_CORRUPT_ENVELOPE")).toBe(true);
  });

  test("checkMailboxHealth passes on clean empty mailboxes", async () => {
    setupVirtualFs();
    const scratch = "/virtual/mb-clean";
    vfs.set(scratch, { isDir: true });
    vfs.set(join(scratch, ".olt", "mailboxes"), { isDir: true });
    const res = await mb.checkMailboxHealth({ repoRoot: scratch });
    expect(res.engine === "checkMailboxHealth" && res.passed && res.findings.length === 0).toBe(
      true,
    );
  });

  test("checkMailboxHealth detects HMAC signature mismatch and malformed envelopes", async () => {
    setupVirtualFs();
    const dir = setupAgent("/virtual/mb-hmac", "agent-hmac");
    setCursor(dir);
    const badEnv = {
      id: "msg-1",
      sequence: 1,
      sender_id: "sender",
      recipient_id: "agent-hmac",
      message_type: "INFO",
      timestamp: new Date().toISOString(),
      correlation_id: "c-1",
      hmac_signature: "bad-sig-123",
      payload: {},
    };
    vfs.set(join(dir, "inbox.jsonl"), { content: JSON.stringify(badEnv) + "\n", isDir: false });

    const res = await mb.checkMailboxHealth({ repoRoot: "/virtual/mb-hmac" });
    expect(
      !res.passed && res.findings.some((f) => f.code === "MAILBOX_HMAC_INTEGRITY_FAILURES"),
    ).toBe(true);
  });

  test("checkMailboxHealth detects SLA exceeded and message starvation on unread messages", async () => {
    setupVirtualFs();
    const dir = setupAgent("/virtual/mb-sla", "agent-sla");
    setCursor(dir);
    const oldTimestamp = new Date(Date.now() - 400 * 1000).toISOString();
    const signedEnv = {
      ...createSignedEnvelope({
        senderId: "sender",
        senderRole: "implementer",
        recipientId: "agent-sla",
        messageType: "VALIDATION_REQUEST",
        payload: {},
      }),
      timestamp: oldTimestamp,
    };
    vfs.set(join(dir, "inbox.jsonl"), { content: JSON.stringify(signedEnv) + "\n", isDir: false });

    const res = await mb.checkMailboxHealth({
      repoRoot: "/virtual/mb-sla",
      slaThresholdSeconds: 60,
    });
    expect(res.findings.some((f) => f.code === "MAILBOX_UNREAD_SLA_EXCEEDED")).toBe(true);
    expect(res.findings.some((f) => f.code === "MAILBOX_MESSAGE_STARVATION")).toBe(true);
  });

  test("checkMailboxHealth detects broken loops when VALIDATION_REQUEST is unresponded", async () => {
    setupVirtualFs();
    const dir = setupAgent("/virtual/mb-loop", "agent-loop");
    const oldTimestamp = new Date(Date.now() - 150 * 1000).toISOString();
    const oldReqEnv = {
      ...createSignedEnvelope({
        senderId: "agent-loop",
        senderRole: "implementer",
        recipientId: "validator-1",
        messageType: "VALIDATION_REQUEST",
        payload: { test: true },
      }),
      timestamp: oldTimestamp,
    };

    setCursor(dir, oldReqEnv.sequence, oldReqEnv.id, [oldReqEnv.id]);
    vfs.set(join(dir, "outbox.jsonl"), { content: JSON.stringify(oldReqEnv) + "\n", isDir: false });

    const res = await mb.checkMailboxHealth({
      repoRoot: "/virtual/mb-loop",
      slaThresholdSeconds: 60,
    });
    const loopFinding = res.findings.find((f) => f.code === "MAILBOX_BROKEN_COMMUNICATION_LOOP");
    expect(loopFinding !== undefined && loopFinding.severity === "WARN").toBe(true);
  });

  test("checkMailboxHealth does not report broken loop when VALIDATION_VERDICT is present", async () => {
    setupVirtualFs();
    const dir = setupAgent("/virtual/mb-loop-ok", "agent-ok");
    const reqEnv = createSignedEnvelope({
      senderId: "agent-ok",
      senderRole: "implementer",
      recipientId: "validator-1",
      messageType: "VALIDATION_REQUEST",
      payload: {},
    });
    const verdictEnv = createSignedEnvelope({
      senderId: "validator-1",
      senderRole: "validator",
      recipientId: "agent-ok",
      messageType: "VALIDATION_VERDICT",
      correlationId: reqEnv.correlation_id,
      payload: { verdict: "ACCEPTED" },
    });

    setCursor(dir, verdictEnv.sequence, verdictEnv.id, [verdictEnv.id]);
    vfs.set(join(dir, "outbox.jsonl"), { content: JSON.stringify(reqEnv) + "\n", isDir: false });
    vfs.set(join(dir, "inbox.jsonl"), { content: JSON.stringify(verdictEnv) + "\n", isDir: false });

    const res = await mb.checkMailboxHealth({
      repoRoot: "/virtual/mb-loop-ok",
      slaThresholdSeconds: 60,
    });
    expect(res.findings.some((f) => f.code === "MAILBOX_BROKEN_COMMUNICATION_LOOP")).toBe(false);
  });

  test("autoHeal repairs corrupted cursor and reports in autoHealed list", async () => {
    setupVirtualFs();
    const dir = setupAgent("/virtual/mb-heal", "agent-heal");
    vfs.set(join(dir, "cursor.json"), { content: "invalid json content", isDir: false });
    const env = createSignedEnvelope({
      senderId: "sender-1",
      senderRole: "orchestrator",
      recipientId: "agent-heal",
      messageType: "INFO",
      payload: { data: "test" },
    });
    vfs.set(join(dir, "inbox.jsonl"), { content: JSON.stringify(env) + "\n", isDir: false });

    const res = await mb.checkMailboxHealth({ repoRoot: "/virtual/mb-heal", autoHeal: true });
    expect(
      Boolean(
        res.autoHealed &&
        res.autoHealed.length > 0 &&
        res.autoHealed[0]?.includes("Rebuilt corrupted cursor for mailbox 'agent-heal'"),
      ),
    ).toBe(true);
    expect(mb.healCorruptedCursor(join(dir, "cursor.json"), join(dir, "inbox.jsonl"))).toBe(true);
    expect(
      mb.pruneOrphanedMailboxes({ repoRoot: "/virtual/mb-heal", activeAgentIds: ["agent-heal"] }),
    ).toHaveLength(0);
    expect(mb.autoHealMailboxState({ repoRoot: "/virtual/mb-heal" })).toHaveLength(0);
  });
});
