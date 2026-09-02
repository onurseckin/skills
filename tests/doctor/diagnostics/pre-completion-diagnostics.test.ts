import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as cp from "node:child_process";
import { join } from "node:path";
import * as doc from "../../../olt/scripts/src/reporting/doctor.ts";

export const preCompletionDiagnosticsSuiteName = "Pre-Completion Diagnostics & Guidance Engine";

const vfs = new Map<string, { isDir: boolean; content?: string; mtimeMs?: number }>();
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
  const s = typeof p === "number" ? (openFds.get(p) ?? "") : String(p),
    n = vfs.get(s);
  if (!n) throw enoent("stat", s);
  return {
    dev: 1,
    ino: 1,
    nlink: 1,
    isFile: () => !n.isDir,
    isDirectory: () => n.isDir,
    isSymbolicLink: () => false,
    mode: n.isDir ? 0o755 : s.endsWith("prompt.md") ? 0o444 : 0o644,
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
    ? (n.content ?? "")
    : (Buffer.from(n.content ?? "") as unknown as string);
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
  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = String(p).replace(/\/+$/, "");
      return vfs.has(s) || Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`));
    }),
    spyOn(fs, "statSync").mockImplementation(getStats),
    spyOn(fs, "lstatSync").mockImplementation(getStats),
    spyOn(fs, "fstatSync").mockImplementation(getStats),
    spyOn(fs, "realpathSync").mockImplementation((p) => String(p)),
    spyOn(fs, "mkdirSync").mockImplementation((p) => {
      vfs.set(String(p), { isDir: true });
    }),
    spyOn(fs, "fsyncSync").mockImplementation(() => {}),
    spyOn(fs, "chmodSync").mockImplementation((p, m) => {
      const n = vfs.get(String(p));
      if (n) n.mtimeMs = typeof m === "number" ? m : Date.now();
    }),
    spyOn(fs, "renameSync").mockImplementation((f, t) => {
      const n = vfs.get(String(f));
      if (n) {
        vfs.set(String(t), { content: n.content, isDir: n.isDir });
        vfs.delete(String(f));
      }
    }),
    spyOn(fs, "rmSync").mockImplementation((p) => {
      vfs.delete(String(p));
    }),
    spyOn(fs, "unlinkSync").mockImplementation((p) => {
      vfs.delete(String(p));
    }),
    spyOn(fs, "writeFileSync").mockImplementation((p, d) => setF(p, d, false)),
    spyOn(fs, "appendFileSync").mockImplementation((p, d) => setF(p, d, true)),
    spyOn(fs, "openSync").mockImplementation((p) => {
      const fd = ++fdCounter;
      openFds.set(fd, String(p));
      fdPositions.set(fd, 0);
      if (!vfs.has(String(p))) vfs.set(String(p), { content: "", isDir: false });
      return fd;
    }),
    spyOn(fs, "closeSync").mockImplementation((fd) => {
      openFds.delete(fd as number);
      fdPositions.delete(fd as number);
    }),
    spyOn(fs, "writeSync").mockImplementation((fd, d) => {
      const p = openFds.get(fd as number);
      if (p) setF(p, d as string | Uint8Array, true);
      return typeof d === "string" ? d.length : (d as Uint8Array).length;
    }),
    spyOn(fs, "readdirSync").mockImplementation(listDir),
    spyOn(fs, "readFileSync").mockImplementation(readNode),
    spyOn(fs, "readSync").mockImplementation(readBytes),
    spyOn(fs, "rmSync").mockImplementation((p) => {
      vfs.delete(String(p));
    }),
    spyOn(fs, "unlinkSync").mockImplementation((p) => {
      vfs.delete(String(p));
    }),
    spyOn(cp, "spawnSync").mockImplementation(
      () =>
        ({
          status: 0,
          stdout: "",
          stderr: "",
          error: undefined,
        }) as unknown as cp.SpawnSyncReturns<string>,
    ),
  );
}

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  openFds.clear();
  fdPositions.clear();
});

const initCapsule = (r: string, id: string, extra: Record<string, unknown> = {}) => {
  const root = join(r, ".olt", "capsules", id);
  vfs.set(r, { isDir: true });
  vfs.set(root, { isDir: true });
  setF(join(root, "manifest.json"), `{"run_id":"${id}"}`);
  setF(join(root, "state.json"), JSON.stringify({ run_id: id, tasks: {}, ...extra }));
  setF(join(root, "events.jsonl"), '{"sequence":1,"type":"genesis"}\n');
  return { repoRoot: r, runRoot: root };
};

describe(preCompletionDiagnosticsSuiteName, () => {
  test("evaluates clean capsule with no blockers as ready for completion", () => {
    setupVirtualFs();
    const { repoRoot, runRoot } = initCapsule("/v/repo-clean", "clean-run");
    const res = doc.checkPreCompletionDiagnostics({ runRoot, repoRoot, autoHeal: false });
    expect(res.readyForCompletion && res.blockers.length === 0).toBe(true);
  });

  test("flags undispositioned orphan evidence as blocker", () => {
    setupVirtualFs();
    const { repoRoot, runRoot } = initCapsule("/v/repo-orphan", "orphan-run", {
      orphan_evidence: ["abc123sha"],
    });
    vfs.set(join(runRoot, "evidence", "loose-dir"), { isDir: true });
    setF(join(runRoot, "evidence", "loose-dir", "output.txt"), "loose capture");
    const res = doc.checkPreCompletionDiagnostics({ runRoot, repoRoot, autoHeal: false });
    expect(
      !res.readyForCompletion &&
        Boolean(
          res.blockers
            .find((b) => b.code === "ORPHAN_EVIDENCE_UNDISPOSITIONED")
            ?.remedyCommand?.includes("evidence:disposition"),
        ),
    ).toBe(true);
  });

  test("flags pending completeness critic review as blocker", () => {
    setupVirtualFs();
    const state = {
      run_id: "critic-run",
      graph: { nodes: [], edges: [] },
      completion_critic: { critic_id: "critic-1", status: "assigned" },
    };
    const { repoRoot, runRoot } = initCapsule("/v/repo-critic", "critic-run", state);
    const res = doc.checkPreCompletionDiagnostics({ runRoot, repoRoot, state, autoHeal: false });
    expect(
      !res.readyForCompletion &&
        Boolean(
          res.blockers
            .find((b) => b.code === "CRITIC_REVIEW_PENDING")
            ?.remedyCommand?.includes("critic:review"),
        ),
    ).toBe(true);
  });

  test("auto-heals dangling locks during pre-completion check", () => {
    setupVirtualFs();
    const { repoRoot, runRoot } = initCapsule("/v/repo-locks", "lock-run");
    const locksDir = join(repoRoot, ".locks");
    vfs.set(locksDir, { isDir: true });
    setF(
      join(locksDir, "dead-process.lock"),
      JSON.stringify({ pid: 99999999, created_at: new Date().toISOString() }),
    );
    const res = doc.checkPreCompletionDiagnostics({ runRoot, repoRoot, autoHeal: true });
    expect(
      res.autoHealedItems.some((i) => i.includes("Cleared dangling lock")) &&
        !fs.existsSync(join(locksDir, "dead-process.lock")),
    ).toBe(true);
  });

  test("generateRemedialGuidance produces actions and summary", () => {
    const g = doc.generateRemedialGuidance({
      runRoot: "/test/run",
      integrityIssues: [{ code: "STATE_PROJECTION", message: "Projection mismatch" }],
      findings: [
        {
          code: "UNAPPROVED_ROOT_FILE",
          severity: "ERROR",
          engine: "checkRepositoryHygiene",
          message: "Root file unapproved: scratch.ts",
        },
        {
          code: "PUSHBACK_QUOTA_DEFICIT",
          severity: "ERROR",
          engine: "checkPushbackQuotas",
          message: "Task deficit: 2/5 pushbacks",
        },
      ],
      orphanEvidence: ["orphan-sha-999"],
    });
    const keys = [
      "[STATE_PROJECTION]",
      "[UNAPPROVED_ROOT_FILE]",
      "[PUSHBACK_QUOTA_DEFICIT]",
      "[ORPHAN_EVIDENCE]",
    ];
    expect(
      g.remedialActions.length >= 4 &&
        keys.every((k) => g.guidanceSummary.some((s) => s.includes(k))),
    ).toBe(true);
  });

  test("formatDoctorReport renders remedial guidance section", () => {
    const rep = doc.formatDoctorReport({
      runRoot: "/test/run",
      healthy: false,
      bunVersion: "1.2.0",
      bunSupported: true,
      gitignored: true,
      issues: ["STATE_PROJECTION: Mismatch"],
      remedialGuidance: [
        "[STATE_PROJECTION] state.json mismatch -> Run: `bun harness.ts doctor:repair`",
      ],
    });
    expect(
      rep.includes("### Pre-Completion Remedial Guidance:") &&
        rep.includes(
          "[STATE_PROJECTION] state.json mismatch -> Run: `bun harness.ts doctor:repair`",
        ),
    ).toBe(true);
  });

  test("runDoctor returns diagnostics, guidance, and actions", async () => {
    setupVirtualFs();
    const { repoRoot, runRoot } = initCapsule("/v/repo-full", "full-run");
    const rep = await doc.runDoctor(runRoot, { repoRoot, autoHeal: true });
    expect(
      Boolean(
        rep.pre_completion_diagnostics && rep.guidance && Array.isArray(rep.remedial_actions),
      ),
    ).toBe(true);
  });
});
