import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as childProcess from "node:child_process";
import { join } from "node:path";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { recordCaptures } from "../../../olt/scripts/src/engine/store/capsule/captures.ts";
import { runDoctor } from "../../../olt/scripts/src/reporting/doctor.ts";

export const doctorDiagnosticsWiringSuiteName =
  "runDoctor wires capsule-root and evidence-location checks";

interface VirtualNode {
  isDir: boolean;
  content?: string;
  mode?: number;
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
    const mode = n.mode ?? (n.isDir ? 0o755 : s.endsWith("prompt.md") ? 0o444 : 0o644);
    return {
      isFile: () => !n.isDir,
      isDirectory: () => n.isDir,
      isSymbolicLink: () => false,
      mode,
      size: n.content ? Buffer.byteLength(n.content) : 0,
      mtimeMs: Date.now(),
    } as fs.Stats;
  });
  const lstatSpy = spyOn(fs, "lstatSync").mockImplementation((p) => {
    const s = String(p);
    const n = vfs.get(s);
    if (!n) throw enoent("lstat", s);
    const mode = n.mode ?? (n.isDir ? 0o755 : s.endsWith("prompt.md") ? 0o444 : 0o644);
    return {
      isFile: () => !n.isDir,
      isDirectory: () => n.isDir,
      isSymbolicLink: () => false,
      mode,
      size: n.content ? Buffer.byteLength(n.content) : 0,
      mtimeMs: Date.now(),
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
    if (!n) throw enoent("open", s);
    const c = n.content ?? "";
    const enc =
      typeof options === "string"
        ? options
        : (options as { encoding?: string } | undefined)?.encoding;
    if (enc === "utf-8" || enc === "utf8") return c;
    return Buffer.from(c) as unknown as string;
  });
  const writeSpy = spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
    const content = typeof data === "string" ? data : new TextDecoder().decode(data as Uint8Array);
    vfs.set(String(p), { content, isDir: false });
  });
  const realpathSpy = spyOn(fs, "realpathSync").mockImplementation((p) => String(p));
  const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation((p) => {
    vfs.set(String(p), { isDir: true });
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
      vfs.set(String(to), { content: n.content, isDir: n.isDir, mode: n.mode });
      vfs.delete(String(from));
    }
  });
  const rmSpy = spyOn(fs, "rmSync").mockImplementation((p) => {
    vfs.delete(String(p));
  });
  const fstatSpy = spyOn(fs, "fstatSync").mockImplementation((fd) => {
    const path = openFds.get(fd as number);
    const n = path ? vfs.get(path) : undefined;
    const size = n?.content ? Buffer.byteLength(n.content) : 0;
    return {
      dev: 1,
      ino: 1,
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
    fstatSpy,
    realpathSpy,
    mkdirSpy,
    spawnSpy,
  );
}

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  openFds.clear();
  fdPositions.clear();
});

function createVirtualRepo(label: string): string {
  const repo = `/virtual/repo-${label}`;
  vfs.set(repo, { isDir: true });
  vfs.set(`${repo}/.git`, { isDir: true });
  return repo;
}

describe(doctorDiagnosticsWiringSuiteName, () => {
  test("a freshly initialised capsule under the canonical .olt/capsules/ layout stays healthy", async () => {
    setupVirtualFs();
    const repo = createVirtualRepo("clean-init");
    const runRoot = initRun(repo, "clean-run", new TextEncoder().encode("Prompt."), "file", true);

    const report = await runDoctor(runRoot);
    expect(report.healthy).toBe(true);
    expect((report.issues as string[]).some((issue) => issue.includes("capsule root"))).toBe(false);
  });

  test("runDoctor flags a misplaced bare capsules/ directory elsewhere in the same repository", async () => {
    setupVirtualFs();
    const repo = createVirtualRepo("bare-capsules-repo");
    const runRoot = initRun(
      repo,
      "run-with-bad-sibling",
      new TextEncoder().encode("Prompt."),
      "file",
      true,
    );
    vfs.set(join(repo, "capsules"), { isDir: true });
    vfs.set(join(repo, "capsules", "stray-run"), { isDir: true });

    const report = await runDoctor(runRoot);
    expect(report.healthy).toBe(false);
    expect(
      (report.issues as string[]).some(
        (issue) => issue.includes("Bare") && issue.includes(join(repo, "capsules")),
      ),
    ).toBe(true);
  });

  test("runDoctor flags a capture recorded at a non-unified evidence path", async () => {
    setupVirtualFs();
    const repo = createVirtualRepo("bad-evidence-path");
    const runRoot = initRun(
      repo,
      "run-with-bad-evidence",
      new TextEncoder().encode("Prompt."),
      "file",
      true,
    );
    recordCaptures(runRoot, [
      {
        kind: "screenshot",
        name: "rogue.png",
        sha256: "d".repeat(64),
        bytes: 1024,
        blob_path: `blobs/${"d".repeat(64)}`,
        path: "screenshots/rogue.png",
        storage: "copy",
        original_path: "/somewhere/orig.png",
      },
    ]);

    const report = await runDoctor(runRoot);
    expect(report.healthy).toBe(false);
    expect(
      (report.issues as string[]).some(
        (issue) => issue.includes("evidence") && issue.includes("screenshots/rogue.png"),
      ),
    ).toBe(true);
  });
});
