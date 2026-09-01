import { spyOn } from "bun:test";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import type { GateProofRecord, GateSpawn } from "../../../olt/scripts/src/graph/gate-proof.ts";
import type {
  RepositoryGitCommand,
  RepositoryGitResult,
} from "../../../olt/scripts/src/packets/repository-git-command.ts";

export const vfs = new Map<string, string | Buffer>();
export const vdirs = new Set<string>();
export const vmodes = new Map<string, number>();
let repoCounter = 0,
  scratchCounter = 0;
const spies: Array<{ mockRestore: () => void }> = [];

const norm = (p: fs.PathLike): string => resolve(String(p)).replace(/\/+$/, "");

const enoent = (s: string) => {
  const err = new Error(`ENOENT: no such file or directory, stat '${s}'`) as NodeJS.ErrnoException;
  err.code = "ENOENT";
  return err;
};

export function installGateProofSpies(): void {
  if (spies.length > 0) return;
  const oe = fs.existsSync.bind(fs),
    or = fs.readFileSync.bind(fs),
    ow = fs.writeFileSync.bind(fs);
  const om = fs.mkdirSync.bind(fs),
    orm = fs.rmSync.bind(fs),
    olstat = fs.lstatSync.bind(fs);
  const ostat = fs.statSync.bind(fs),
    oreal = fs.realpathSync.bind(fs),
    omkdtemp = fs.mkdtempSync.bind(fs);
  const ocopy = fs.copyFileSync.bind(fs),
    ochmod = fs.chmodSync.bind(fs),
    oreaddir = fs.readdirSync.bind(fs);
  const ounlink = fs.unlinkSync.bind(fs);

  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = norm(p);
      return s.startsWith("/virtual/")
        ? vfs.has(s) ||
            vdirs.has(s) ||
            Array.from(vdirs).some((k) => k.startsWith(`${s}/`)) ||
            Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`))
        : oe(p);
    }),
    spyOn(fs, "realpathSync").mockImplementation((p) =>
      norm(p).startsWith("/virtual/") ? norm(p) : oreal(p),
    ),
    spyOn(fs, "lstatSync").mockImplementation((p: fs.PathLike): fs.Stats => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const isFile = vfs.has(s),
          isDir =
            vdirs.has(s) ||
            Array.from(vdirs).some((k) => k.startsWith(`${s}/`)) ||
            Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`));
        if (!isFile && !isDir) throw enoent(s);
        const c = vfs.get(s);
        const size = Buffer.isBuffer(c)
          ? c.length
          : typeof c === "string"
            ? Buffer.byteLength(c)
            : 0;
        return {
          isFile: () => isFile,
          isDirectory: () => isDir,
          isSymbolicLink: () => false,
          size,
          mode: vmodes.get(s) ?? (isDir ? 0o755 : 0o644),
        } as unknown as fs.Stats;
      }
      return olstat(p);
    }),
    spyOn(fs, "statSync").mockImplementation((p: fs.PathLike): fs.Stats => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const isFile = vfs.has(s),
          isDir =
            vdirs.has(s) ||
            Array.from(vdirs).some((k) => k.startsWith(`${s}/`)) ||
            Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`));
        if (!isFile && !isDir) throw enoent(s);
        const c = vfs.get(s);
        const size = Buffer.isBuffer(c)
          ? c.length
          : typeof c === "string"
            ? Buffer.byteLength(c)
            : 0;
        return {
          isFile: () => isFile,
          isDirectory: () => isDir,
          isSymbolicLink: () => false,
          size,
          mode: vmodes.get(s) ?? (isDir ? 0o755 : 0o644),
        } as unknown as fs.Stats;
      }
      return ostat(p);
    }),
    spyOn(fs, "mkdtempSync").mockImplementation((prefix: string) => {
      scratchCounter += 1;
      const root = `/virtual/scratch/gate-prove-${scratchCounter}`;
      vdirs.add(root);
      return root;
    }),
    spyOn(fs, "copyFileSync").mockImplementation((src, dst) => {
      const so = norm(src),
        sd = norm(dst);
      if (so.startsWith("/virtual/") || sd.startsWith("/virtual/")) {
        const c = vfs.get(so);
        if (c !== undefined) vfs.set(sd, Buffer.isBuffer(c) ? Buffer.from(c) : c);
        return;
      }
      ocopy(src, dst);
    }),
    spyOn(fs, "chmodSync").mockImplementation((p, mode) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vmodes.set(s, typeof mode === "number" ? mode : Number.parseInt(String(mode), 8));
        return;
      }
      ochmod(p, mode);
    }),
    spyOn(fs, "readFileSync").mockImplementation((p, opt) => {
      const s = norm(String(p));
      if (s.startsWith("/virtual/")) {
        const c = vfs.get(s);
        if (c === undefined) throw new Error(`ENOENT: ${s}`);
        const str = Buffer.isBuffer(c) ? c.toString("utf-8") : c;
        return opt === "utf-8" || opt === "utf8" || (typeof opt === "object" && opt)
          ? str
          : Buffer.from(str, "utf-8");
      }
      return or(p, opt as Parameters<typeof or>[1]);
    }),
    spyOn(fs, "writeFileSync").mockImplementation((p, d) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vfs.set(s, typeof d === "string" ? d : Buffer.from(d.buffer, d.byteOffset, d.byteLength));
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
        vmodes.delete(s);
        for (const k of Array.from(vfs.keys())) if (k.startsWith(`${s}/`)) vfs.delete(k);
        for (const d of Array.from(vdirs)) if (d.startsWith(`${s}/`)) vdirs.delete(d);
        return;
      }
      orm(p, { recursive: true, force: true });
    }),
    spyOn(fs, "unlinkSync").mockImplementation((p) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vfs.delete(s);
        return;
      }
      ounlink(p);
    }),
    spyOn(fs, "readdirSync").mockImplementation((p: fs.PathLike, opt?: unknown): unknown => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const prefix = `${s}/`;
        const entries = new Map<string, boolean>();
        for (const k of vfs.keys()) {
          if (k.startsWith(prefix) && k.length > prefix.length) {
            const rel = k.slice(prefix.length);
            const firstSeg = rel.split("/")[0]!;
            entries.set(firstSeg, rel.includes("/"));
          }
        }
        for (const d of vdirs) {
          if (d.startsWith(prefix) && d.length > prefix.length) {
            const rel = d.slice(prefix.length);
            entries.set(rel.split("/")[0]!, true);
          }
        }
        const withTypes =
          typeof opt === "object" &&
          opt !== null &&
          "withFileTypes" in opt &&
          Boolean((opt as { withFileTypes?: boolean }).withFileTypes);
        if (withTypes) {
          return Array.from(entries.entries()).map(([name, isDir]) => ({
            name,
            isDirectory: () => isDir,
            isFile: () => !isDir,
            isSymbolicLink: () => false,
          })) as unknown as fs.Dirent[];
        }
        return Array.from(entries.keys());
      }
      return oreaddir(p, opt as Parameters<typeof oreaddir>[1]);
    }),
  );
}

export function repoWithoutRealGit(label?: string): string {
  installGateProofSpies();
  repoCounter += 1;
  const repo = `/virtual/repo/gate-proof-fixture-${label ?? repoCounter}`;
  vdirs.add(repo);
  vdirs.add(join(repo, ".git"));
  return repo;
}

export function cleanupProofRepos(): void {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  vdirs.clear();
  vmodes.clear();
}

export function setupVirtualGraphFS(): void {
  installGateProofSpies();
}

/** Scripts `repositoryGit` by argv[0] (ls-files / ls-tree / show). */
export function fakeGit(script: Record<string, RepositoryGitResult>): RepositoryGitCommand {
  return (_repo: string, argv: readonly string[]): RepositoryGitResult => {
    const verb = argv[0] ?? "";
    const scripted = script[verb];
    if (!scripted) throw new Error(`fakeGit: no script for ${argv.join(" ")}`);
    return scripted;
  };
}

export const noopSpawn: GateSpawn = () => ({
  status: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
});

/** Stands in for the real gate subprocess: reads the scratch-copy filesystem and checks conditions. */
export function fsCheckSpawn(check: (cwd: string) => boolean): GateSpawn {
  return (_argv: readonly string[], cwd: string) => ({
    status: check(cwd) ? 0 : 1,
    stdout: "",
    stderr: "",
    timedOut: false,
  });
}

export function record(overrides: Partial<GateProofRecord> = {}): GateProofRecord {
  return {
    task_id: "task-1",
    gate_argv: ["bun", "test", "tests/db.test.ts"],
    write_scope: ["src/db"],
    base: "HEAD",
    falsifiable: true,
    exit_code: 1,
    timed_out: false,
    proved_at: "2026-08-20T00:00:00.000Z",
    actor: "coordinator",
    ...overrides,
  };
}
