import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as cp from "node:child_process";
import { join } from "node:path";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { undeclaredEntries } from "../../../olt/scripts/src/engine/store/integrity/layout-integrity.ts";
import * as doc from "../../../olt/scripts/src/reporting/doctor.ts";
import * as tc from "../../../olt/scripts/src/reporting/doctor/tier-confinement/index.ts";
import { formatDoctorBrief } from "../../../olt/scripts/src/cli/commands/diagnostics-ops.ts";

export const doctorSeverityTieringSuiteName =
  "Doctor Severity Tiering & Cosmetic Classification Suite";

const vfs = new Map<string, { isDir: boolean; content?: string; mode?: number }>();
const openFds = new Map<number, string>();
const fdPositions = new Map<number, number>();
let fdCounter = 100;
const spies: Array<{ mockRestore: () => void }> = [];

const enoent = (op: string, p: string) => {
  const e = new Error(`ENOENT: ${op} '${p}'`) as Error & { code: string };
  e.code = "ENOENT";
  return e;
};

function setupVirtualFs(): void {
  vfs.clear();
  openFds.clear();
  fdPositions.clear();
  fdCounter = 100;
  vfs.set(process.cwd(), { isDir: true });
  vfs.set(join(process.cwd(), ".git"), { isDir: true });
  vfs.set(join(process.cwd(), "package.json"), { content: "{}", isDir: false });

  const getStats = (p: fs.PathLike): fs.Stats => {
    const s = typeof p === "number" ? (openFds.get(p) ?? "") : String(p);
    const n = vfs.get(s);
    if (!n) throw enoent("stat", s);
    const isDir = n.isDir;
    return {
      dev: 1,
      ino: 1,
      nlink: 1,
      isFile: () => !isDir,
      isDirectory: () => isDir,
      isSymbolicLink: () => false,
      mode: n.mode ?? (isDir ? 0o755 : s.endsWith("prompt.md") ? 0o444 : 0o644),
      size: n.content ? Buffer.byteLength(n.content) : 0,
      mtimeMs: Date.now(),
    } as fs.Stats;
  };

  const setFile = (p: fs.PathLike, d: string | Uint8Array, append = false) => {
    const s = String(p);
    const str = typeof d === "string" ? d : new TextDecoder().decode(d);
    vfs.set(s, { content: append ? (vfs.get(s)?.content ?? "") + str : str, isDir: false });
  };
  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p) => vfs.has(String(p))),
    spyOn(fs, "statSync").mockImplementation(getStats),
    spyOn(fs, "lstatSync").mockImplementation(getStats),
    spyOn(fs, "fstatSync").mockImplementation(getStats),
    spyOn(fs, "realpathSync").mockImplementation((p) => String(p)),
    spyOn(fs, "mkdirSync").mockImplementation(
      (p) => (vfs.set(String(p), { isDir: true }), undefined),
    ),
    spyOn(fs, "fsyncSync").mockImplementation(() => {}),
    spyOn(fs, "chmodSync").mockImplementation((p, m) => {
      const n = vfs.get(String(p));
      if (n) n.mode = typeof m === "number" ? m : 0o644;
    }),
    spyOn(fs, "renameSync").mockImplementation((f, t) => {
      const n = vfs.get(String(f));
      if (n) {
        vfs.set(String(t), n);
        vfs.delete(String(f));
      }
    }),
    spyOn(fs, "rmSync").mockImplementation((p) => (vfs.delete(String(p)), undefined)),
    spyOn(fs, "unlinkSync").mockImplementation((p) => (vfs.delete(String(p)), undefined)),
    spyOn(fs, "writeFileSync").mockImplementation((p, d) => setFile(p, d, false)),
    spyOn(fs, "appendFileSync").mockImplementation((p, d) => setFile(p, d, true)),
    spyOn(fs, "openSync").mockImplementation((p) => {
      const fd = ++fdCounter;
      openFds.set(fd, String(p));
      fdPositions.set(fd, 0);
      if (!vfs.has(String(p))) vfs.set(String(p), { content: "", isDir: false });
      return fd;
    }),
    spyOn(fs, "closeSync").mockImplementation(
      (fd) => (openFds.delete(fd as number), fdPositions.delete(fd as number), undefined),
    ),
    spyOn(fs, "writeSync").mockImplementation((fd, d) => {
      const p = openFds.get(fd as number);
      if (p) setFile(p, d, true);
      return typeof d === "string" ? d.length : (d as Uint8Array).length;
    }),
    spyOn(fs, "readdirSync").mockImplementation((p, opt) => {
      const pref = `${String(p).replace(/\/+$/, "")}/`;
      const ent = new Map<string, boolean>();
      for (const [k, v] of vfs.entries())
        if (k.startsWith(pref) && k.length > pref.length) {
          const seg = k.slice(pref.length).split("/")[0];
          if (seg && !ent.has(seg)) ent.set(seg, k.slice(pref.length).includes("/") || v.isDir);
        }
      const withTypes = typeof opt === "object" && opt !== null && "withFileTypes" in opt;
      return (withTypes
        ? Array.from(ent.entries()).map(([name, isDir]) => ({
            name,
            isDirectory: () => isDir,
            isFile: () => !isDir,
            isSymbolicLink: () => false,
          }))
        : Array.from(ent.keys())) as unknown as fs.Dirent[];
    }),
    spyOn(fs, "readFileSync").mockImplementation((p, opt) => {
      const s = typeof p === "number" ? (openFds.get(p) ?? "") : String(p);
      const n = vfs.get(s);
      if (!n) throw enoent("open", s);
      const enc =
        typeof opt === "string" ? opt : (opt as { encoding?: string } | undefined)?.encoding;
      return enc === "utf-8" || enc === "utf8"
        ? (n.content ?? "")
        : (Buffer.from(n.content ?? "") as unknown as string);
    }),
    spyOn(fs, "readSync").mockImplementation((fd, buf, off, len, pos) => {
      const path = openFds.get(fd as number);
      if (!path) return 0;
      const b = Buffer.from(vfs.get(path)?.content ?? "");
      const cur = typeof pos === "number" ? pos : (fdPositions.get(fd as number) ?? 0);
      const toRead = Math.min(len, Math.max(0, b.length - cur));
      if (toRead <= 0) return 0;
      b.copy(buf as Buffer, off, cur, cur + toRead);
      if (pos === null || pos === undefined) fdPositions.set(fd as number, cur + toRead);
      return toRead;
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

const initTestRun = (n: string) => {
  const r = `/virtual/repo-${n}`;
  vfs.set(r, { isDir: true });
  vfs.set(`${r}/.git`, { isDir: true });
  return initRun(r, `${n}-run`, new TextEncoder().encode("P"), "file", true);
};
const CRASHED = { pulse: { last: { outcome: "crashed", terminal_reason: "crashed" } } };
const crashedCritical = () =>
  tc.summarizeTierConfinement(tc.auditTierConfinement("", CRASHED)).issues;

describe(doctorSeverityTieringSuiteName, () => {
  test("a freshly initialised capsule that has brainstorming.json reports Healthy: yes", async () => {
    setupVirtualFs();
    const runRoot = initTestRun("tiering-brainstorm");
    vfs.set(join(runRoot, "brainstorming.json"), {
      content: JSON.stringify({
        schema: "harness.brainstorming",
        version: 1,
        prompt: "Build a slugify helper.",
        rounds: 1,
        vectors: [],
        total_expanded_items: 0,
      }),
      isDir: false,
    });
    const report = await doc.runDoctor(runRoot);
    expect(
      report.healthy &&
        !report.issues.includes(
          "LAYOUT_UNDECLARED: capsule holds an undeclared entry: brainstorming.json",
        ),
    ).toBe(true);
  });

  test("classifyIssueSeverity marks a real undeclared-entry note cosmetic and a real tier-confinement finding critical", () => {
    setupVirtualFs();
    const runRoot = initTestRun("tiering-classify");
    vfs.set(join(runRoot, "random-extra-file.txt"), { content: "cosmetic noise", isDir: false });
    const cosmeticIssues = undeclaredEntries(runRoot);
    expect(
      cosmeticIssues.length === 1 &&
        doc.classifyIssueSeverity(`${cosmeticIssues[0]?.code}: ${cosmeticIssues[0]?.message}`) ===
          "cosmetic",
    ).toBe(true);
    const criticalText = crashedCritical()[0] ?? "";
    expect(
      criticalText.includes(
        'Subagent "unknown" terminated mind pulse loop with outcome "crashed"',
      ) && doc.classifyIssueSeverity(criticalText) === "critical",
    ).toBe(true);
  });

  test("tierDoctorIssues keeps a critical finding unhealthy even alongside a cosmetic note, and keeps the two lists separate", () => {
    const criticalTexts = crashedCritical();
    const cosmeticText = "LAYOUT_UNDECLARED: capsule holds an undeclared entry: brainstorming.json";
    const cosmeticOnly = doc.tierDoctorIssues([cosmeticText]);
    expect(
      cosmeticOnly.healthy &&
        cosmeticOnly.cosmeticIssues.length === 1 &&
        cosmeticOnly.criticalIssues.length === 0,
    ).toBe(true);

    const criticalOnly = doc.tierDoctorIssues(criticalTexts);
    expect(
      !criticalOnly.healthy && criticalOnly.criticalIssues.length === criticalTexts.length,
    ).toBe(true);

    const both = doc.tierDoctorIssues([...criticalTexts, cosmeticText]);
    expect(
      !both.healthy &&
        both.criticalIssues.length === criticalTexts.length &&
        both.cosmeticIssues.length === 1,
    ).toBe(true);
  });

  test("formatDoctorBrief renders the critical finding in a visibly-flagged section the cosmetic note cannot mask", () => {
    const c1 = crashedCritical()[0] ?? "";
    const c2 = "LAYOUT_UNDECLARED: capsule holds an undeclared entry: brainstorming.json";
    const comb = [c1, c2].filter(Boolean);
    const t = doc.tierDoctorIssues(comb);
    const brief = formatDoctorBrief("run-x", {
      healthy: t.healthy,
      bun_version: "1.3.14",
      bun_supported: true,
      gitignored: true,
      issues: comb,
      critical_issues: t.criticalIssues,
      cosmetic_issues: t.cosmeticIssues,
    });
    expect(brief).toContain("- **Healthy**: no");
    expect(brief).toContain(`  - ${c1}`);
    expect(brief).toContain(`  - ${c2}`);
    expect(brief.indexOf("- **Critical Issues**:")).toBeLessThan(brief.indexOf("- **Notices**"));
  });

  test("a cosmetic-only integrity issue does not suppress computation of a real critical finding via runDoctor", async () => {
    setupVirtualFs();
    const runRoot = initTestRun("tiering-mask");
    transact(runRoot, "mind-gen-1", "pulse-recorded", {}, (state) => {
      state.pulse = { last: { outcome: "crashed", terminal_reason: "crashed" } };
    });
    vfs.set(join(runRoot, "random-extra-file.txt"), { content: "cosmetic noise", isDir: false });

    const report = await doc.runDoctor(runRoot);
    expect(
      !report.healthy &&
        (report.critical_issues as string[]).some((i) =>
          i.includes("tier-confinement [critical]"),
        ) &&
        (report.cosmetic_issues as string[]).some((i) => i.startsWith("LAYOUT_UNDECLARED")),
    ).toBe(true);
  });
});
