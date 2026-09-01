import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as cp from "node:child_process";
import { join } from "node:path";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { doctorCertifyCommand } from "../../../olt/scripts/src/reporting/doctor/certify-command.ts";
import type { Flags } from "../../../olt/scripts/src/cli/options.ts";

export const doctorCertifyCommandSuiteName = "doctor:certify command suite";
const vfs = new Map<string, { isDir: boolean; content?: string; mode?: number }>();
const openFds = new Map<number, string>();
const fdPositions = new Map<number, number>();
let fdCounter = 100;
const spies: Array<{ mockRestore: () => void }> = [];

const err = (op: string, p: string) => {
  const e = new Error(`ENOENT: ${op} '${p}'`) as Error & { code: string };
  e.code = "ENOENT";
  return e;
};
const certify = (flags: Record<string, unknown>) => doctorCertifyCommand(flags as unknown as Flags);

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
    if (!n) throw err("stat", s);
    return {
      dev: 1,
      ino: 1,
      nlink: 1,
      isFile: () => !n.isDir,
      isDirectory: () => n.isDir,
      isSymbolicLink: () => false,
      mode: n.mode ?? (n.isDir ? 0o755 : s.endsWith("prompt.md") ? 0o444 : 0o644),
      size: n.content ? Buffer.byteLength(n.content) : 0,
      mtimeMs: Date.now(),
    } as fs.Stats;
  };
  const spiesList = [
    spyOn(fs, "existsSync").mockImplementation((p) => vfs.has(String(p))),
    spyOn(fs, "statSync").mockImplementation(getStats),
    spyOn(fs, "lstatSync").mockImplementation(getStats),
    spyOn(fs, "fstatSync").mockImplementation(getStats),
    spyOn(fs, "realpathSync").mockImplementation((p) => String(p)),
    spyOn(fs, "mkdirSync").mockImplementation((p) => {
      vfs.set(String(p), { isDir: true });
      return undefined;
    }),
    spyOn(fs, "fsyncSync").mockImplementation(() => {}),
    spyOn(fs, "rmSync").mockImplementation((p) => {
      vfs.delete(String(p));
    }),
    spyOn(fs, "chmodSync").mockImplementation((p, m) => {
      const n = vfs.get(String(p));
      if (n) n.mode = typeof m === "number" ? m : 0o644;
    }),
    spyOn(fs, "renameSync").mockImplementation((f, t) => {
      const n = vfs.get(String(f));
      if (n) {
        vfs.set(String(t), { ...n });
        vfs.delete(String(f));
      }
    }),
    spyOn(fs, "readdirSync").mockImplementation((p, opt) => {
      const pref = `${String(p).replace(/\/+$/, "")}/`;
      const ent = new Map<string, boolean>();
      for (const [k, v] of vfs.entries())
        if (k.startsWith(pref) && k.length > pref.length) {
          const seg = k.slice(pref.length).split("/")[0];
          if (seg && !ent.has(seg)) ent.set(seg, k.slice(pref.length).includes("/") || v.isDir);
        }
      return typeof opt === "object" && opt !== null && "withFileTypes" in opt
        ? (Array.from(ent.entries()).map(([name, isDir]) => ({
            name,
            isDirectory: () => isDir,
            isFile: () => !isDir,
            isSymbolicLink: () => false,
          })) as unknown as fs.Dirent[])
        : (Array.from(ent.keys()) as unknown as fs.Dirent[]);
    }),
    spyOn(fs, "readFileSync").mockImplementation((p, opt) => {
      const s = typeof p === "number" ? (openFds.get(p) ?? "") : String(p);
      const n = vfs.get(s);
      if (!n) throw err("open", s);
      const enc =
        typeof opt === "string" ? opt : (opt as { encoding?: string } | undefined)?.encoding;
      return enc === "utf-8" || enc === "utf8"
        ? (n.content ?? "")
        : (Buffer.from(n.content ?? "") as unknown as string);
    }),
    spyOn(fs, "writeFileSync").mockImplementation((p, d) => {
      vfs.set(String(p), {
        content: typeof d === "string" ? d : new TextDecoder().decode(d as Uint8Array),
        isDir: false,
      });
    }),
    spyOn(fs, "appendFileSync").mockImplementation((p, d) => {
      const s = String(p);
      vfs.set(s, {
        content:
          (vfs.get(s)?.content ?? "") +
          (typeof d === "string" ? d : new TextDecoder().decode(d as Uint8Array)),
        isDir: false,
      });
    }),
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
      const path = openFds.get(fd as number);
      if (path)
        vfs.set(path, {
          content:
            (vfs.get(path)?.content ?? "") +
            (typeof d === "string" ? d : new TextDecoder().decode(d as Uint8Array)),
          isDir: false,
        });
      return typeof d === "string" ? d.length : (d as Uint8Array).length;
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
    spyOn(cp, "spawnSync").mockImplementation((_cmd, args) => {
      const tf = (args ?? []).find((a) => typeof a === "string" && a.endsWith(".test.ts"));
      if (tf && vfs.has(tf)) {
        const c = (vfs.get(tf)?.content ?? "").trim();
        const valid =
          `import { test, expect } from "bun:test";\ntest("falsifiable", () => { expect(1 + 1).toBe(2); });`.trim();
        if (c !== valid)
          return {
            status: 1,
            stdout: "",
            stderr: "Mutation failed as expected",
            error: undefined,
          } as unknown as cp.SpawnSyncReturns<string>;
      }
      return {
        status: 0,
        stdout: "1 pass",
        stderr: "",
        error: undefined,
      } as unknown as cp.SpawnSyncReturns<string>;
    }),
  ];
  spies.push(...spiesList);
}

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  openFds.clear();
  fdPositions.clear();
});

function initVirtualCapsule(label: string): { repo: string; runRoot: string } {
  const repo = `/virtual/repo-${label}`;
  vfs.set(repo, { isDir: true });
  vfs.set(`${repo}/.git`, { isDir: true });
  vfs.set(`${repo}/.olt`, { isDir: true });
  vfs.set(`${repo}/.olt/capsules`, { isDir: true });
  return {
    repo,
    runRoot: initRun(
      repo,
      `run-${label}`,
      new TextEncoder().encode("Prompt for test."),
      "file",
      true,
    ),
  };
}

function setupNonCanonRun(label: string) {
  const repo = `/virtual/repo-${label}`;
  vfs.set(repo, { isDir: true });
  vfs.set(`${repo}/.git`, { isDir: true });
  const runRoot = initRun(
    repo,
    "non-canon-run",
    new TextEncoder().encode("Prompt for test."),
    "file",
    true,
  );
  const target = `${repo}/nested/custom-capsules/${label}`;
  for (const [k, v] of Array.from(vfs.entries())) {
    if (k.startsWith(runRoot)) vfs.set(`${target}${k.slice(runRoot.length)}`, v);
  }
  return target;
}

describe(doctorCertifyCommandSuiteName, () => {
  test("rejects a --write-scope path that is not a .test.ts or .spec.ts file, instead of silently skipping it", async () => {
    setupVirtualFs();
    const { runRoot } = initVirtualCapsule("certify-non-test-scope");
    const nonTest = "/virtual/src/some-helper.ts";
    vfs.set("/virtual/src", { isDir: true });
    vfs.set(nonTest, { content: "export const x = 1;\n", isDir: false });
    await expect(certify({ run: runRoot, "write-scope": nonTest })).rejects.toThrow(
      "--write-scope must name a .test.ts or .spec.ts file",
    );
  });

  test("runs the non-adversarial health diagnostics and certifies a clean, canonically-placed capsule with no --write-scope", async () => {
    setupVirtualFs();
    const { runRoot } = initVirtualCapsule("certify-baseline-run");
    const report = await certify({ run: runRoot });
    const healthChecks = report["healthChecks"] as readonly { status: string }[];
    expect(report["adversarialChecks"]).toEqual([]);
    expect(healthChecks.length > 0 && healthChecks.every((check) => check.status === "pass")).toBe(
      true,
    );
    expect(report["certified"]).toBe(true);
  });

  test("--strict throws when the capsule root is not under the canonical location", async () => {
    setupVirtualFs();
    const nonCanonRunRoot = setupNonCanonRun("certify-strict");
    await expect(certify({ run: nonCanonRunRoot, strict: true })).rejects.toThrow();
  });

  test("without --strict, an uncertified capsule root still returns a report rather than throwing", async () => {
    setupVirtualFs();
    const nonCanonRunRoot = setupNonCanonRun("certify-nostrict");
    const report = await certify({ run: nonCanonRunRoot });
    const healthChecks = report["healthChecks"] as readonly { name: string; status: string }[];
    expect(report["certified"]).toBe(false);
    expect(healthChecks.find((c) => c.name === "capsule_root_confinement")?.status).toBe("fail");
  });

  test("proves a trivially-passing test is falsifiable via a real counterfactual mutation round-trip", async () => {
    setupVirtualFs();
    const { repo, runRoot } = initVirtualCapsule("certify-adversarial-round-trip");
    const testFile = join(repo, "tests", "corrupted-falsifiable.test.ts");
    vfs.set(join(repo, "tests"), { isDir: true });
    vfs.set(testFile, {
      content: `import { test, expect } from "bun:test";\ntest("falsifiable", () => { expect(1 + 1).toBe(2); });\n`,
      isDir: false,
    });
    const report = await certify({ run: runRoot, "write-scope": testFile });
    const adversarial = report["adversarialChecks"] as readonly { passed: boolean }[];
    expect(adversarial.length > 0 && adversarial.every((check) => check.passed)).toBe(true);
    expect(report["certified"]).toBe(true);
  });
});
