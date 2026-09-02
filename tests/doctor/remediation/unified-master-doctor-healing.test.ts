import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as cp from "node:child_process";
import { join } from "node:path";
import {
  runDoctor,
  formatDoctorReport,
  autoHealCapsule,
} from "../../../olt/scripts/src/reporting/doctor.ts";
import { formatDoctorBrief } from "../../../olt/scripts/src/cli/commands/diagnostics-ops.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { transact } from "../../../olt/scripts/src/engine/store/events/transaction.ts";

export const unifiedMasterDoctorHealingSuiteName =
  "Unified Master Doctor - Auto-Healing and Severity-Tiered Reporting";

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
  const s = typeof p === "number" ? (openFds.get(p) ?? "") : String(p).replace(/\/+$/, ""),
    n = vfs.get(s);
  if (n)
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
  if (Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`)))
    return {
      dev: 1,
      ino: 1,
      nlink: 1,
      isFile: () => false,
      isDirectory: () => true,
      isSymbolicLink: () => false,
      mode: 0o755,
      size: 0,
      mtimeMs: Date.now(),
    } as fs.Stats;
  throw enoent("stat", s);
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
      if (n) n.mode = typeof m === "number" ? m : 0o644;
    }),
    spyOn(fs, "renameSync").mockImplementation((f, t) => {
      const n = vfs.get(String(f));
      if (n) {
        vfs.set(String(t), { content: n.content, isDir: n.isDir, mode: n.mode });
        vfs.delete(String(f));
      }
    }),
    spyOn(fs, "unlinkSync").mockImplementation((p) => {
      vfs.delete(String(p));
    }),
    spyOn(fs, "rmSync").mockImplementation((p) => {
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

describe(unifiedMasterDoctorHealingSuiteName, () => {
  describe("Auto-Healing Engine", () => {
    test("autoHealCapsule recovers torn state projection and records auto_healed", async () => {
      setupVirtualFs();
      const repo = "/virtual/repo-autoheal";
      vfs.set(repo, { isDir: true });
      vfs.set(`${repo}/.git`, { isDir: true });
      const runRoot = initRun(
        repo,
        "autoheal-run",
        new TextEncoder().encode("Prompt"),
        "file",
        true,
      );
      transact(runRoot, "coord-1", "plan-brainstormed", { plan_id: "p1" }, (state) => {
        state.tasks = { t1: { id: "t1", status: "open" } };
      });

      setF(
        join(runRoot, "state.json"),
        JSON.stringify({ schema: "harness.state", event_sequence: 999, corrupted: true }),
      );
      const healResult = autoHealCapsule(runRoot);
      expect(
        healResult.projectionRecovered &&
          healResult.autoHealed.length > 0 &&
          healResult.autoHealed[0].includes("Recovered state projection"),
      ).toBe(true);

      setF(
        join(runRoot, "state.json"),
        JSON.stringify({ schema: "harness.state", event_sequence: 999, corrupted: true }),
      );
      const doctorReport = await runDoctor(runRoot, {}, () => ({
        status: 0,
        bytes: new Uint8Array(),
      }));
      expect(
        doctorReport.healthy &&
          Array.isArray(doctorReport.auto_healed) &&
          (doctorReport.auto_healed as string[]).length > 0,
      ).toBe(true);
    });
  });

  describe("Severity-Tiered Reporting & Formatting", () => {
    test("formatDoctorReport and formatDoctorBrief render clear severity sections: [ERROR], [WARN], [INFO]", () => {
      const reportMarkdown = formatDoctorReport({
        runRoot: "/test/run",
        healthy: false,
        bunVersion: "1.3.14",
        bunSupported: true,
        gitignored: true,
        issues: ["critical issue 1", "LAYOUT_UNDECLARED: note"],
        errors: ["critical issue 1"],
        warnings: ["advisory warning 1"],
        infos: ["Auto-Healed: Recovered projection", "LAYOUT_UNDECLARED: note"],
      });
      expect(
        [
          "### Doctor Findings:",
          "- **[ERROR]**:",
          "  - critical issue 1",
          "- **[WARN]**:",
          "  - advisory warning 1",
          "- **[INFO]**:",
          "  - Auto-Healed: Recovered projection",
        ].every((s) => reportMarkdown.includes(s)),
      ).toBe(true);

      const briefMarkdown = formatDoctorBrief("/test/run", {
        healthy: false,
        bun_version: "1.3.14",
        bun_supported: true,
        gitignored: true,
        critical_issues: ["critical issue 1"],
        cosmetic_issues: ["cosmetic note 1"],
        warnings: ["advisory warning 1"],
        auto_healed: ["Recovered projection"],
      });
      expect(
        [
          "### Doctor Findings:",
          "- **[ERROR]**:",
          "- **[WARN]**:",
          "- **[INFO]**:",
          "Auto-Healed: Recovered projection",
        ].every((s) => briefMarkdown.includes(s)),
      ).toBe(true);
    });
  });
});
