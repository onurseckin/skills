import { spyOn } from "bun:test";
import * as fs from "node:fs";
import { resolve } from "node:path";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  appendGateProof,
  type GateProofRecord,
} from "../../../olt/scripts/src/graph/gate-proof.ts";
import type { AuditTaskInput } from "../../../olt/scripts/src/graph/plan-audit.ts";

export const vfs = new Map<string, string>();
export const vdirs = new Set<string>();
export const openFds = new Map<number, { path: string; content: string }>();
let rootCounter = 0;
let nextFd = 100;
const spies: Array<{ mockRestore: () => void }> = [];

export const norm = (p: fs.PathLike): string => resolve(String(p)).replace(/\/+$/, "");

export function installPlanAuditFsSpies(): void {
  if (spies.length > 0) return;
  const oe = fs.existsSync.bind(fs),
    or = fs.readFileSync.bind(fs),
    ow = fs.writeFileSync.bind(fs);
  const om = fs.mkdirSync.bind(fs),
    orm = fs.rmSync.bind(fs),
    olstat = fs.lstatSync.bind(fs);
  const ostat = fs.statSync.bind(fs),
    oreal = fs.realpathSync.bind(fs),
    oo = fs.openSync.bind(fs);
  const ofstat = fs.fstatSync.bind(fs),
    oc = fs.closeSync.bind(fs),
    orename = fs.renameSync.bind(fs);
  const ochmod = fs.chmodSync.bind(fs),
    owsync = fs.writeSync.bind(fs),
    ofsync = fs.fsyncSync.bind(fs);

  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = norm(p);
      return s.startsWith("/virtual/")
        ? vfs.has(s) || vdirs.has(s) || Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`))
        : oe(p);
    }),
    spyOn(fs, "realpathSync").mockImplementation((p) =>
      norm(p).startsWith("/virtual/") ? norm(p) : oreal(p),
    ),
    spyOn(fs, "lstatSync").mockImplementation((p: fs.PathLike): fs.Stats => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const isFile = vfs.has(s),
          isDir = vdirs.has(s) || Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`));
        if (!isFile && !isDir) throw new Error(`ENOENT: ${s}`);
        return {
          isFile: () => isFile,
          isDirectory: () => isDir,
          isSymbolicLink: () => false,
          size: isFile ? (vfs.get(s)?.length ?? 0) : 0,
          mode: isDir ? 0o755 : 0o600,
          uid: typeof process.getuid === "function" ? process.getuid() : 0,
          nlink: 1,
          dev: 1,
          ino: 1,
        } as unknown as fs.Stats;
      }
      return olstat(p);
    }),
    spyOn(fs, "statSync").mockImplementation((p: fs.PathLike): fs.Stats => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const isFile = vfs.has(s),
          isDir = vdirs.has(s) || Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`));
        if (!isFile && !isDir) throw new Error(`ENOENT: ${s}`);
        return {
          isFile: () => isFile,
          isDirectory: () => isDir,
          isSymbolicLink: () => false,
          size: isFile ? (vfs.get(s)?.length ?? 0) : 0,
          mode: isDir ? 0o755 : 0o600,
          uid: typeof process.getuid === "function" ? process.getuid() : 0,
          nlink: 1,
          dev: 1,
          ino: 1,
        } as unknown as fs.Stats;
      }
      return ostat(p);
    }),
    spyOn(fs, "openSync").mockImplementation((p, f, m) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const fd = ++nextFd;
        openFds.set(fd, { path: s, content: vfs.get(s) ?? "" });
        return fd;
      }
      return oo(p, f, m);
    }),
    spyOn(fs, "fstatSync").mockImplementation((fd) => {
      if (openFds.has(fd)) {
        const f = openFds.get(fd)!;
        return {
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
          uid: typeof process.getuid === "function" ? process.getuid() : 0,
          mode: 0o600,
          nlink: 1,
          dev: 1,
          ino: 1,
          size: f.content.length,
        } as unknown as fs.Stats;
      }
      return ofstat(fd);
    }),
    spyOn(fs, "writeSync").mockImplementation(
      (fd: number, data: string | NodeJS.ArrayBufferView) => {
        const openFile = openFds.get(fd);
        if (openFile) {
          const text =
            typeof data === "string"
              ? data
              : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf-8");
          openFile.content += text;
          vfs.set(openFile.path, openFile.content);
          return typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
        }
        return owsync(fd, data as Parameters<typeof owsync>[1]);
      },
    ),
    spyOn(fs, "fsyncSync").mockImplementation((fd: number) =>
      openFds.has(fd) ? undefined : ofsync(fd),
    ),
    spyOn(fs, "closeSync").mockImplementation((fd) =>
      openFds.has(fd) ? (openFds.delete(fd), undefined) : oc(fd),
    ),
    spyOn(fs, "renameSync").mockImplementation((oldP, newP) => {
      const so = norm(oldP),
        sn = norm(newP);
      if (so.startsWith("/virtual/") || sn.startsWith("/virtual/")) {
        const c = vfs.get(so) ?? "";
        vfs.set(sn, c);
        vfs.delete(so);
        return undefined;
      }
      return orename(oldP, newP);
    }),
    spyOn(fs, "chmodSync").mockImplementation((p, m) =>
      norm(p).startsWith("/virtual/") ? undefined : ochmod(p, m),
    ),
    spyOn(fs, "readFileSync").mockImplementation((p, opt) => {
      if (typeof p === "number" && openFds.has(p)) {
        const c = openFds.get(p)!.content;
        return opt === "utf-8" || opt === "utf8" || (typeof opt === "object" && opt)
          ? c
          : Buffer.from(c, "utf-8");
      }
      const s = norm(String(p));
      if (s.startsWith("/virtual/")) {
        const c = vfs.get(s);
        if (!c) throw new Error(`ENOENT: ${s}`);
        return opt === "utf-8" || opt === "utf8" || (typeof opt === "object" && opt)
          ? c
          : Buffer.from(c, "utf-8");
      }
      return or(p, opt as Parameters<typeof or>[1]);
    }),
    spyOn(fs, "writeFileSync").mockImplementation((p, d) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vfs.set(
          s,
          typeof d === "string"
            ? d
            : Buffer.from(d.buffer, d.byteOffset, d.byteLength).toString("utf-8"),
        );
        return;
      }
      ow(p, d);
    }),
    spyOn(fs, "mkdirSync").mockImplementation((p) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vdirs.add(s);
        return undefined;
      }
      return om(p) as string | undefined;
    }),
    spyOn(fs, "rmSync").mockImplementation((p) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vfs.delete(s);
        vdirs.delete(s);
        for (const k of Array.from(vfs.keys())) if (k.startsWith(`${s}/`)) vfs.delete(k);
        return;
      }
      orm(p, { recursive: true, force: true });
    }),
  );
}

export function clearPlanAuditFs(): void {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  vdirs.clear();
  openFds.clear();
}

export function tempDir(prefix = "plan-audit-"): string {
  rootCounter += 1;
  const root = `/virtual/${prefix}${rootCounter}`;
  vdirs.add(root);
  return root;
}

export function generatePrompt(lineCount: number): string {
  return Array.from(
    { length: lineCount },
    (_, i) => `Requirement ${i + 1}: Detailed actionable obligation`,
  ).join("\n");
}

export function sampleTasks(count: number): AuditTaskInput[] {
  return Array.from({ length: count }, (_, i) => ({
    taskId: `task-${i + 1}`,
    writeScope: [`src/module-${i + 1}.ts`],
    deps: [] as string[],
    gate: `bun test tests/unit/module-${i + 1}.test.ts`,
  }));
}

export function task(overrides: Partial<AuditTaskInput> & { taskId: string }): AuditTaskInput {
  return { writeScope: [], deps: [], gate: "bun test tests/unit", ...overrides };
}

export function fixtureRepo(_roots?: string[]): string {
  return "/virtual/repo/plan-audit-fixture";
}

export function cleanupFixtureRoots(_roots?: readonly string[]): void {
  // Zero-disk implementation
}

export function gateProof(
  overrides: Partial<GateProofRecord> &
    Pick<GateProofRecord, "task_id" | "gate_argv" | "write_scope">,
): GateProofRecord {
  return {
    base: "HEAD",
    falsifiable: true,
    exit_code: 1,
    timed_out: false,
    proved_at: "2026-01-01T00:00:00.000Z",
    actor: "coordinator",
    ...overrides,
  };
}

export function runStateWithProofs(records: readonly GateProofRecord[]): JsonObject {
  const state: JsonObject = {};
  for (const record of records) appendGateProof(state, record);
  return state;
}
