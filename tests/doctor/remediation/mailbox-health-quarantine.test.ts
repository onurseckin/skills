import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as cp from "node:child_process";
import { join } from "node:path";
import { createSignedEnvelope } from "../../../olt/scripts/src/communication/mailbox/envelope.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { transact } from "../../../olt/scripts/src/engine/store/events/transaction.ts";
import * as ah from "../../../olt/scripts/src/reporting/doctor/auto-heal.ts";
import * as mb from "../../../olt/scripts/src/reporting/doctor/mailbox-health-engine.ts";

export const mailboxHealthQuarantineSuiteName =
  "Mailbox Health Quarantine & Torn-Tail Auto-Repair Suite";

type VNode = { isDir: boolean; content?: string; mode?: number; mtimeMs?: number };
const vfs = new Map<string, VNode>();
const openFds = new Map<number, string>();
const fdPositions = new Map<number, number>();
let fdCounter = 100;
const spies: Array<{ mockRestore: () => void }> = [];

const enoent = (op: string, p: string) =>
  Object.assign(new Error(`ENOENT: ${op} '${p}'`), { code: "ENOENT" });
const setF = (p: fs.PathLike, d: string | Uint8Array, a = false) => {
  const s = String(p),
    str = typeof d === "string" ? d : new TextDecoder().decode(d);
  vfs.set(s, { content: a ? (vfs.get(s)?.content ?? "") + str : str, isDir: false });
};
const getStats = (p: fs.PathLike): fs.Stats => {
  const s = typeof p === "number" ? (openFds.get(p) ?? "") : String(p).replace(/\/+$/, "");
  const n =
    vfs.get(s) ??
    (Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`)) ? { isDir: true } : undefined);
  if (!n) throw enoent("stat", s);
  return {
    dev: 1,
    ino: 1,
    nlink: 1,
    isFile: () => !n.isDir,
    isDirectory: () => n.isDir,
    isSymbolicLink: () => false,
    mode: n.mode ?? (n.isDir ? 0o755 : s.endsWith("prompt.md") ? 0o444 : 0o644),
    size: n.content ? Buffer.byteLength(n.content) : 0,
    mtimeMs: n.mtimeMs ?? Date.now(),
  } as fs.Stats;
};
const readNode = (p: fs.PathLike, opt?: unknown) => {
  const s = typeof p === "number" ? (openFds.get(p) ?? "") : String(p),
    n = vfs.get(s);
  if (!n || n.content === undefined) throw enoent("open", s);
  const enc = typeof opt === "string" ? opt : (opt as { encoding?: string } | undefined)?.encoding;
  return enc === "utf-8" || enc === "utf8"
    ? n.content
    : (Buffer.from(n.content) as unknown as string);
};
const readBytes = (
  fd: unknown,
  buf: NodeJS.ArrayBufferView,
  off: number,
  len: number,
  pos?: number | null,
) => {
  const path = openFds.get(fd as number);
  if (!path) return 0;
  const b = Buffer.from(vfs.get(path)?.content ?? ""),
    cur = typeof pos === "number" ? pos : (fdPositions.get(fd as number) ?? 0),
    tr = Math.min(len, Math.max(0, b.length - cur));
  if (tr <= 0) return 0;
  b.copy(buf as Buffer, off, cur, cur + tr);
  if (pos === null || pos === undefined) fdPositions.set(fd as number, cur + tr);
  return tr;
};
const listDir = (p: fs.PathLike, opt?: unknown) => {
  const pref = `${String(p).replace(/\/+$/, "")}/`,
    ent = new Map<string, boolean>();
  for (const [k, v] of vfs.entries())
    if (k.startsWith(pref) && k.length > pref.length) {
      const seg = k.slice(pref.length).split("/")[0];
      if (seg && !ent.has(seg)) ent.set(seg, k.slice(pref.length).includes("/") || v.isDir);
    }
  const wt = typeof opt === "object" && opt !== null && "withFileTypes" in opt;
  return (wt
    ? Array.from(ent.entries()).map(([n, d]) => ({
        name: n,
        isDirectory: () => d,
        isFile: () => !d,
        isSymbolicLink: () => false,
      }))
    : Array.from(ent.keys())) as unknown as fs.Dirent[];
};

function setupVirtualFs(): void {
  vfs.clear();
  openFds.clear();
  fdPositions.clear();
  fdCounter = 100;
  vfs.set(process.cwd(), { isDir: true });
  vfs.set(join(process.cwd(), ".git"), { isDir: true });
  vfs.set(join(process.cwd(), "package.json"), { content: "{}", isDir: false });
  const m = <T extends object, K extends keyof T>(t: T, k: K, fn: T[K]) =>
    spies.push(spyOn(t, k as never).mockImplementation(fn as never));
  m(
    fs,
    "existsSync",
    (p: fs.PathLike) =>
      vfs.has(String(p).replace(/\/+$/, "")) ||
      Array.from(vfs.keys()).some((k) => k.startsWith(`${String(p).replace(/\/+$/, "")}/`)),
  );
  m(fs, "statSync", getStats);
  m(fs, "lstatSync", getStats);
  m(fs, "fstatSync", getStats);
  m(fs, "realpathSync", (p: fs.PathLike) => String(p));
  m(fs, "mkdirSync", (p: fs.PathLike) => {
    vfs.set(String(p), { isDir: true });
    return undefined;
  });
  m(fs, "fsyncSync", () => undefined);
  m(fs, "chmodSync", (p: fs.PathLike, m: unknown) => {
    const n = vfs.get(String(p));
    if (n) n.mode = typeof m === "number" ? m : 0o644;
  });
  m(fs, "renameSync", (f: fs.PathLike, t: fs.PathLike) => {
    const n = vfs.get(String(f));
    if (n) {
      vfs.set(String(t), { ...n });
      vfs.delete(String(f));
    }
  });
  m(fs, "unlinkSync", (p: fs.PathLike) => {
    vfs.delete(String(p));
    return undefined;
  });
  m(fs, "writeFileSync", (p: fs.PathLike, d: string | NodeJS.ArrayBufferView) =>
    setF(p, d as string, false),
  );
  m(fs, "appendFileSync", (p: fs.PathLike, d: string | NodeJS.ArrayBufferView) =>
    setF(p, d as string, true),
  );
  m(fs, "openSync", (p: fs.PathLike) => {
    const fd = ++fdCounter;
    openFds.set(fd, String(p));
    fdPositions.set(fd, 0);
    if (!vfs.has(String(p))) vfs.set(String(p), { content: "", isDir: false });
    return fd;
  });
  m(fs, "closeSync", (fd: unknown) => {
    openFds.delete(fd as number);
    fdPositions.delete(fd as number);
    return undefined;
  });
  m(fs, "writeSync", (fd: unknown, d: string | NodeJS.ArrayBufferView) => {
    const p = openFds.get(fd as number);
    if (p) setF(p, d as string, true);
    return typeof d === "string" ? d.length : (d as Uint8Array).length;
  });
  m(fs, "readdirSync", listDir);
  m(fs, "readFileSync", readNode);
  m(fs, "readSync", readBytes);
  m(
    cp,
    "spawnSync",
    () =>
      ({
        status: 0,
        stdout: "",
        stderr: "",
        error: undefined,
      }) as unknown as cp.SpawnSyncReturns<string>,
  );
}

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  openFds.clear();
  fdPositions.clear();
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
  vfs.set(s, { isDir: true });
  vfs.set(join(s, ".olt", "mailboxes"), { isDir: true });
  vfs.set(ad, { isDir: true });
  return ad;
};

describe(mailboxHealthQuarantineSuiteName, () => {
  test("mailbox quarantine, cursor healing, auto-heal repair, torn-tail isolation, and state recovery", async () => {
    setupVirtualFs();
    const ad1 = setupAgent("/v/repo-mb-q", "agent-torn");
    setF(join(ad1, "quarantine.log"), "quarantined bytes line 1\n");
    setF(join(ad1, "cursor.json"), "{ corrupted cursor json");
    setF(join(ad1, "inbox.jsonl"), "{ invalid envelope\n");
    const rep = mb.checkMailboxDiskActivity("/v/repo-mb-q");
    const codes = [
      "MAILBOX_QUARANTINE_PRESENT",
      "MAILBOX_CURSOR_CORRUPTED",
      "MAILBOX_DISK_CORRUPT_ENVELOPE",
    ];
    expect(!rep.passed && codes.every((c) => rep.findings.some((f) => f.code === c))).toBe(true);

    const ad2 = setupAgent("/v/repo-heal-c", "agent-1"),
      curP = join(ad2, "cursor.json"),
      inP = join(ad2, "inbox.jsonl");
    setF(curP, "CORRUPTED_JSON_DATA");
    const e1 = makeEnv(1, "agent-1", { x: 1 }),
      e2 = makeEnv(2, "agent-1", { x: 2 });
    setF(inP, `${JSON.stringify(e1)}\n${JSON.stringify(e2)}\n`);
    expect(mb.healCorruptedCursor(curP, inP)).toBe(true);
    const cur = JSON.parse(fs.readFileSync(curP, "utf8"));
    expect(cur.last_read_sequence === 2 && cur.last_read_id === e2.id).toBe(true);

    const s = "/v/repo-auto-heal-mb",
      mbDir = join(s, ".olt", "mailboxes");
    vfs.set(s, { isDir: true });
    vfs.set(mbDir, { isDir: true });
    vfs.set(join(mbDir, "agent-active"), { isDir: true });
    vfs.set(join(mbDir, "agent-orphan"), { isDir: true });
    setF(join(mbDir, "agent-active", "cursor.json"), "corrupt");
    setF(join(mbDir, "agent-orphan", "cursor.json"), "corrupt");
    setF(join(mbDir, "agent-orphan", "inbox.jsonl"), '{"stale":true}\n');
    const log = mb.autoHealMailboxState({ repoRoot: s, activeAgentIds: ["agent-active"] });
    expect(
      log.some((m) => m.includes("Rebuilt corrupted cursor for mailbox 'agent-active'")) &&
        log.some((m) => m.includes("Pruned orphaned mailbox 'agent-orphan'")),
    ).toBe(true);

    const sTorn = "/v/repo-quarantine-torn";
    vfs.set(sTorn, { isDir: true });
    const tornData = Buffer.from('{"incomplete_event": true, "bytes": [0x41,', "utf-8");
    const fileName = ah.quarantineTornTail(sTorn, tornData);
    expect(/^\d+-torn-tail-[a-f0-9]{12}\.json$/u.test(fileName)).toBe(true);
    const qPath = join(sTorn, "quarantine", fileName);
    expect(
      fs.existsSync(qPath) && fs.readFileSync(qPath, "utf-8") === tornData.toString("utf-8"),
    ).toBe(true);

    const repo = "/v/repo-heal-capsule";
    vfs.set(repo, { isDir: true });
    vfs.set(`${repo}/.git`, { isDir: true });
    const runRoot = initRun(
      repo,
      "capsule-torn-run",
      new TextEncoder().encode("Build test system"),
      "file",
      true,
    );
    transact(runRoot, "coord", "task-planned", { taskId: "task-1" }, (d) => {
      d.tasks = { "task-1": { id: "task-1", status: "ready" } };
    });
    const sp = join(runRoot, "state.json");
    setF(sp, '{"schema":"harness.state","corrupted":true');
    ah.quarantineTornTail(runRoot, Buffer.from('{"torn_event_tail": true', "utf-8"));
    const res = ah.autoHealCapsule(runRoot, { repoRoot: repo });
    const sc = JSON.parse(fs.readFileSync(sp, "utf8"));
    expect(
      res.projectionRecovered &&
        res.quarantinedFragments.length > 0 &&
        res.autoHealed.some((m) => m.includes("Recovered state projection")) &&
        sc.event_sequence >= 1 &&
        sc.tasks["task-1"]?.id === "task-1",
    ).toBe(true);

    const adGood = setupAgent("/v/repo-e2e-mb", "agent-good"),
      envGood = makeEnv(1, "agent-good", { status: "ok" });
    setF(
      join(adGood, "cursor.json"),
      JSON.stringify({
        last_read_sequence: 1,
        last_read_id: envGood.id,
        seen_ids: [envGood.id],
        updated_at: new Date().toISOString(),
      }),
    );
    setF(join(adGood, "inbox.jsonl"), `${JSON.stringify(envGood)}\n`);
    const repClean = await mb.checkMailboxHealth({ repoRoot: "/v/repo-e2e-mb", autoHeal: true });
    expect(repClean.passed && repClean.findings.length === 0).toBe(true);
  });
});
