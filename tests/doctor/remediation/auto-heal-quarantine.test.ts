import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as childProcess from "node:child_process";
import { join } from "node:path";
import {
  autoHealCapsule,
  quarantineTornTail,
} from "../../../olt/scripts/src/reporting/doctor/auto-heal.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { transact } from "../../../olt/scripts/src/engine/store/events/transaction.ts";

export const autoHealQuarantineSuiteName =
  "Wave 1 - Task 1.1: Capsule Auto-Healer & Quarantine Pipeline";

interface VirtualNode {
  isDir: boolean;
  content?: string;
  mode?: number;
  mtimeMs?: number;
}

function enoent(op: string, path: string): Error & { code: string } {
  const err = new Error(`ENOENT: no such file or directory, ${op} '${path}'`) as Error & {
    code: string;
  };
  err.code = "ENOENT";
  return err;
}

const vfs = new Map<string, VirtualNode>();
const openFds = new Map<number, string>();
const fdPositions = new Map<number, number>();
let fdCounter = 100;
const spies: Array<{ mockRestore: () => void }> = [];

function setupVirtualFs(): void {
  vfs.clear();
  openFds.clear();
  fdPositions.clear();
  fdCounter = 100;

  vfs.set(process.cwd(), { isDir: true });
  vfs.set(join(process.cwd(), ".git"), { isDir: true });
  vfs.set(join(process.cwd(), "package.json"), { content: "{}", isDir: false });

  const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => vfs.has(String(p)));
  const statSpy = spyOn(fs, "statSync").mockImplementation((p) => {
    const s = String(p);
    const n = vfs.get(s);
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
  });
  const lstatSpy = spyOn(fs, "lstatSync").mockImplementation((p) => {
    const s = String(p);
    const n = vfs.get(s);
    if (!n) throw enoent("lstat", s);
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
  });
  const readdirSpy = spyOn(fs, "readdirSync").mockImplementation((p, options) => {
    const dir = String(p).replace(/\/+$/, "");
    const prefix = `${dir}/`;
    const entries = new Map<string, boolean>();
    for (const [k, v] of vfs.entries()) {
      if (k.startsWith(prefix) && k.length > prefix.length) {
        const rest = k.slice(prefix.length);
        const segment = rest.split("/")[0];
        if (segment && !entries.has(segment)) entries.set(segment, rest.includes("/") || v.isDir);
      }
    }
    const withTypes = typeof options === "object" && options !== null && "withFileTypes" in options;
    if (withTypes) {
      return Array.from(entries.entries()).map(([name, isDir]) => ({
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
        isSymbolicLink: () => false,
      })) as unknown as fs.Dirent[];
    }
    return Array.from(entries.keys()) as unknown as fs.Dirent[];
  });
  const readSpy = spyOn(fs, "readFileSync").mockImplementation((p, options) => {
    const s = typeof p === "number" ? (openFds.get(p) ?? "") : String(p);
    const n = vfs.get(s);
    if (!n || n.content === undefined) throw enoent("open", s);
    const c = n.content;
    const enc =
      typeof options === "string"
        ? options
        : (options as { encoding?: string } | undefined)?.encoding;
    if (enc === "utf-8" || enc === "utf8") return c;
    return Buffer.from(c) as unknown as string;
  });
  const writeSpy = spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
    const content = typeof data === "string" ? data : new TextDecoder().decode(data as Uint8Array);
    vfs.set(String(p), { content, isDir: false, mtimeMs: Date.now() });
  });
  const realpathSpy = spyOn(fs, "realpathSync").mockImplementation((p) => String(p));
  const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation((p) => {
    vfs.set(String(p), { isDir: true, mtimeMs: Date.now() });
    return undefined;
  });
  const appendSpy = spyOn(fs, "appendFileSync").mockImplementation((p, data) => {
    const str = typeof data === "string" ? data : new TextDecoder().decode(data as Uint8Array);
    const existing = vfs.get(String(p))?.content ?? "";
    vfs.set(String(p), { content: existing + str, isDir: false });
  });
  const openSpy = spyOn(fs, "openSync").mockImplementation((p) => {
    const fd = ++fdCounter;
    openFds.set(fd, String(p));
    fdPositions.set(fd, 0);
    if (!vfs.has(String(p))) vfs.set(String(p), { content: "", isDir: false });
    return fd;
  });
  const writeSyncSpy = spyOn(fs, "writeSync").mockImplementation((fd, data) => {
    const path = openFds.get(fd as number);
    if (path) {
      const str = typeof data === "string" ? data : new TextDecoder().decode(data as Uint8Array);
      const existing = vfs.get(path)?.content ?? "";
      vfs.set(path, { content: existing + str, isDir: false });
    }
    return typeof data === "string" ? data.length : (data as Uint8Array).length;
  });
  const readSyncSpy = spyOn(fs, "readSync").mockImplementation((fd, buf, offset, length, pos) => {
    const num = fd as number;
    const path = openFds.get(num);
    if (!path) return 0;
    const content = vfs.get(path)?.content ?? "";
    const b = Buffer.from(content);
    const cur = typeof pos === "number" ? pos : (fdPositions.get(num) ?? 0);
    const toRead = Math.min(length, Math.max(0, b.length - cur));
    if (toRead <= 0) return 0;
    b.copy(buf as Buffer, offset, cur, cur + toRead);
    if (pos === null || pos === undefined) fdPositions.set(num, cur + toRead);
    return toRead;
  });
  const closeSpy = spyOn(fs, "closeSync").mockImplementation((fd) => {
    openFds.delete(fd as number);
    fdPositions.delete(fd as number);
  });
  const fsyncSpy = spyOn(fs, "fsyncSync").mockImplementation(() => {});
  const chmodSpy = spyOn(fs, "chmodSync").mockImplementation((p, m) => {
    const n = vfs.get(String(p));
    if (n) n.mode = typeof m === "number" ? m : 0o644;
  });
  const renameSpy = spyOn(fs, "renameSync").mockImplementation((from, to) => {
    const n = vfs.get(String(from));
    if (n) {
      vfs.set(String(to), { content: n.content, isDir: n.isDir, mode: n.mode, mtimeMs: n.mtimeMs });
      vfs.delete(String(from));
    }
  });
  const rmSpy = spyOn(fs, "rmSync").mockImplementation((p) => {
    const prefix = `${String(p).replace(/\/+$/, "")}/`;
    for (const k of Array.from(vfs.keys())) {
      if (k === String(p) || k.startsWith(prefix)) vfs.delete(k);
    }
  });
  const unlinkSpy = spyOn(fs, "unlinkSync").mockImplementation((p) => {
    vfs.delete(String(p));
  });
  const fstatSpy = spyOn(fs, "fstatSync").mockImplementation((fd) => {
    const path = openFds.get(fd as number);
    const n = path ? vfs.get(path) : undefined;
    const size = n?.content ? Buffer.byteLength(n.content) : 0;
    return {
      dev: 1,
      ino: 1,
      nlink: 1,
      size,
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
      mode: 0o444,
    } as fs.Stats;
  });
  const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(
    () =>
      ({
        status: 0,
        stdout: "",
        stderr: "",
        error: undefined,
      }) as unknown as childProcess.SpawnSyncReturns<string>,
  );

  spies.push(
    existsSpy,
    statSpy,
    lstatSpy,
    readdirSpy,
    readSpy,
    writeSpy,
    appendSpy,
    openSpy,
    writeSyncSpy,
    readSyncSpy,
    closeSpy,
    fsyncSpy,
    chmodSpy,
    renameSpy,
    rmSpy,
    unlinkSpy,
    fstatSpy,
    realpathSpy,
    mkdirSpy,
    spawnSpy,
  );
}

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
});

describe(autoHealQuarantineSuiteName, () => {
  test("quarantineTornTail writes torn bytes to quarantine directory with timestamp and hash", () => {
    setupVirtualFs();
    const tempDir = "/virtual/quarantine-test";
    vfs.set(tempDir, { isDir: true });

    const tornContent = Buffer.from('{"incomplete": "json', "utf-8");
    const fileName = quarantineTornTail(tempDir, tornContent);

    expect(fileName).toMatch(/^\d+-torn-tail-[a-f0-9]{12}\.json$/u);
    expect(vfs.has(join(tempDir, "quarantine", fileName))).toBe(true);
  });

  test("autoHealCapsule recovers torn state projection and populates full DoctorAutoHealResult", () => {
    setupVirtualFs();
    const repo = "/virtual/autoheal-repo";
    vfs.set(repo, { isDir: true });
    vfs.set(`${repo}/.git`, { isDir: true });

    const runRoot = initRun(
      repo,
      "autoheal-run-1",
      new TextEncoder().encode("Prompt"),
      "file",
      true,
    );

    transact(runRoot, "coord-1", "plan-brainstormed", { plan_id: "p1" }, (state) => {
      state.tasks = { t1: { id: "t1", status: "open" } };
    });

    // Simulate corrupted state.json
    vfs.set(join(runRoot, "state.json"), {
      content: JSON.stringify({ schema: "harness.state", event_sequence: 9999, corrupted: true }),
      isDir: false,
    });

    const result = autoHealCapsule(runRoot, { repoRoot: repo });
    expect(result.projectionRecovered).toBe(true);
    expect(result.autoHealed.length).toBeGreaterThan(0);
    expect(Array.isArray(result.recoveredLeases)).toBe(true);
    expect(Array.isArray(result.quarantinedFragments)).toBe(true);
    expect(Array.isArray(result.danglingLocksCleared)).toBe(true);
    expect(Array.isArray(result.migratedLedgers)).toBe(true);
    expect(typeof result.gitIndexHealed).toBe("boolean");
    expect(Array.isArray(result.gitArtifactsStaged)).toBe(true);
  });
});
