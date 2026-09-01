import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import * as pOps from "../../../olt/scripts/src/cli/commands/policy-ops.ts";
import { checkPolicyDoctor } from "../../../olt/scripts/src/reporting/doctor/policy-doctor.ts";
import * as pol from "../../../olt/scripts/src/policy/index.ts";

export const policyDoctorSuiteName =
  "Doctor Policy Certification & Policy CLI Operations (Task 4.3)";

type VirtualNode = { isDir: boolean; content?: string };
const vfs = new Map<string, VirtualNode>();
const openFds = new Map<number, string>();
let fdCounter = 100;
const spies: Array<{ mockRestore: () => void }> = [];

const curUid = typeof process.getuid === "function" ? process.getuid() : 0;
const curGid = typeof process.getgid === "function" ? process.getgid() : 0;

const mkStat = (isD: boolean, sz = 0): fs.Stats =>
  ({
    dev: 1,
    ino: 1,
    nlink: 1,
    uid: curUid,
    gid: curGid,
    isFile: () => !isD,
    isDirectory: () => isD,
    isSymbolicLink: () => false,
    mode: isD ? 0o755 : 0o600,
    size: sz,
    mtimeMs: Date.now(),
  }) as fs.Stats;

const getStats = (p: fs.PathLike): fs.Stats => {
  const s = typeof p === "number" ? (openFds.get(p) ?? "") : String(p).replace(/\/+$/, ""),
    n = vfs.get(s);
  if (n) return mkStat(n.isDir, n.content ? Buffer.byteLength(n.content) : 0);
  if (Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`))) return mkStat(true, 0);
  const err = new Error(`ENOENT: ${s}`) as Error & { code: string };
  err.code = "ENOENT";
  throw err;
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
const readNode = (p: fs.PathLike, opt?: unknown) => {
  const s = typeof p === "number" ? (openFds.get(p) ?? "") : String(p),
    n = vfs.get(s);
  if (!n || n.content === undefined) {
    const err = new Error(`ENOENT: ${s}`) as Error & { code: string };
    err.code = "ENOENT";
    throw err;
  }
  const enc = typeof opt === "string" ? opt : (opt as { encoding?: string } | undefined)?.encoding;
  return enc === "utf-8" || enc === "utf8"
    ? n.content
    : (Buffer.from(n.content) as unknown as string);
};
const strData = (d: string | NodeJS.ArrayBufferView) =>
  typeof d === "string" ? d : new TextDecoder().decode(d as Uint8Array);

function setupVirtualFs(): void {
  vfs.clear();
  openFds.clear();
  fdCounter = 100;
  vfs.set(process.cwd(), { isDir: true });
  vfs.set(join(process.cwd(), ".git"), { isDir: true });
  vfs.set(join(process.cwd(), "package.json"), { content: "{}", isDir: false });
  spies.push(
    spyOn(fs, "existsSync").mockImplementation(
      (p) =>
        vfs.has(String(p).replace(/\/+$/, "")) ||
        Array.from(vfs.keys()).some((k) => k.startsWith(`${String(p).replace(/\/+$/, "")}/`)),
    ),
    spyOn(fs, "statSync").mockImplementation(getStats),
    spyOn(fs, "lstatSync").mockImplementation(getStats),
    spyOn(fs, "fstatSync").mockImplementation(getStats),
    spyOn(fs, "readdirSync").mockImplementation(listDir),
    spyOn(fs, "readFileSync").mockImplementation(readNode),
    spyOn(fs, "writeFileSync").mockImplementation((p, d) => {
      vfs.set(String(p), { content: strData(d), isDir: false });
    }),
    spyOn(fs, "openSync").mockImplementation((p) => {
      const fd = ++fdCounter;
      openFds.set(fd, String(p));
      if (!vfs.has(String(p))) vfs.set(String(p), { content: "", isDir: false });
      return fd;
    }),
    spyOn(fs, "closeSync").mockImplementation((fd) => {
      openFds.delete(fd as number);
    }),
    spyOn(fs, "fsyncSync").mockImplementation(() => {}),
    spyOn(fs, "writeSync").mockImplementation((fd, d) => {
      const p = openFds.get(fd as number);
      if (p) vfs.set(p, { content: (vfs.get(p)?.content ?? "") + strData(d), isDir: false });
      return typeof d === "string" ? d.length : (d as Uint8Array).length;
    }),
    spyOn(fs, "mkdirSync").mockImplementation((p) => {
      vfs.set(String(p), { isDir: true });
      return undefined;
    }),
    spyOn(fs, "rmSync").mockImplementation((p) => {
      const pref = `${String(p).replace(/\/+$/, "")}/`;
      for (const k of Array.from(vfs.keys()))
        if (k === String(p) || k.startsWith(pref)) vfs.delete(k);
    }),
    spyOn(fs, "renameSync").mockImplementation((f, t) => {
      const n = vfs.get(String(f));
      if (n) {
        vfs.set(String(t), { content: n.content, isDir: n.isDir });
        vfs.delete(String(f));
      }
    }),
    spyOn(fs, "unlinkSync").mockImplementation((p) => {
      vfs.delete(String(p));
    }),
    spyOn(fs, "realpathSync").mockImplementation((p) => String(p)),
  );
}

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  openFds.clear();
});

const initRepo = (repo: string) => {
  vfs.set(repo, { isDir: true });
  vfs.set(`${repo}/.git`, { isDir: true });
};
const runCli = (repo: string, cmd: string, ...args: string[]) =>
  execute([cmd, "--repo", repo, ...args]);

describe(policyDoctorSuiteName, () => {
  test("reports auto-detected policy info when absent and flags corrupt policy.json as ERROR", () => {
    setupVirtualFs();
    initRepo("/virtual/missing-policy");
    const res1 = checkPolicyDoctor({ repoRoot: "/virtual/missing-policy" });
    const repo = "/virtual/corrupt-policy";
    initRepo(repo);
    vfs.set(join(repo, ".olt"), { isDir: true });
    vfs.set(join(repo, ".olt", "policy.json"), { content: "{ invalid-json: true ", isDir: false });
    const res2 = checkPolicyDoctor({ repoRoot: repo });
    const corrupt = res2.findings.find((f) => f.code === "POLICY_CORRUPT");
    expect(
      res1.passed &&
        res1.findings.some((f) => f.code === "POLICY_AUTO_DETECTED") &&
        !res2.passed &&
        corrupt?.severity === "ERROR",
    ).toBe(true);
  });

  test("detects unsupported schema version drift and SHA-256 checksum drift", async () => {
    const drifted: pol.RepoPolicy = { ...pol.generateDefaultRepoPolicy(), schema_version: 99 };
    const res1 = checkPolicyDoctor({ policy: drifted });
    const vFind = res1.findings.find((f) => f.code === "POLICY_SCHEMA_VERSION_DRIFT");

    setupVirtualFs();
    initRepo("/virtual/checksum-drift");
    await pOps.policyInitCommand({ repo: "/virtual/checksum-drift" });
    const res2 = checkPolicyDoctor({
      repoRoot: "/virtual/checksum-drift",
      expectedChecksum: "0".repeat(64),
      strict: true,
    });
    expect(
      !res1.passed &&
        vFind?.severity === "ERROR" &&
        vFind.message.includes("version 99") &&
        !res2.passed &&
        res2.findings.some((f) => f.code === "POLICY_CHECKSUM_DRIFT"),
    ).toBe(true);
  });

  test("enforces pushback quotas, passing quotas, and cognitive validator command locks", () => {
    const res1 = checkPolicyDoctor({
      tasks: {
        "task-1": {
          id: "task-1",
          status: "satisfied",
          adversarial_probes: [1, 2],
          cognitive_pushbacks: [1],
        },
      },
    });
    const res2 = checkPolicyDoctor({
      tasks: {
        "task-ok": {
          id: "task-ok",
          status: "satisfied",
          adversarial_probes: [1, 2, 3, 4, 5],
          cognitive_pushbacks: [1, 2, 3, 4, 5],
        },
      },
    });
    const strict: pol.RepoPolicy = {
      ...pol.generateDefaultRepoPolicy(),
      forbidden_commands: ["rm -rf /", "git push --force"],
    };
    const res3 = checkPolicyDoctor({
      policy: strict,
      grants: [
        { id: "agent-val", role: "validator_code_quality" },
        { id: "agent-impl", role: "implementer" },
      ],
      commands: {
        cmd1: { id: "cmd1", agent_id: "agent-val", command: "bun test" },
        cmd2: { id: "cmd2", agent_id: "agent-impl", command: "rm -rf /" },
      },
    });
    expect(
      !res1.passed &&
        res1.findings.some((f) => f.code === "PUSHBACK_QUOTA_ADVERSARIAL_PROBES_DEFICIT") &&
        res2.passed &&
        !res3.passed &&
        res3.findings.some((f) => f.code === "COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION"),
    ).toBe(true);
  });

  test("policy CLI operations: init, set, and check-drift", async () => {
    setupVirtualFs();
    initRepo("/virtual/cli-ops");
    const initRes = await pOps.policyInitCommand({ repo: "/virtual/cli-ops", ecosystem: "bun" });
    const setRes = await pOps.policySetCommand({
      repo: "/virtual/cli-ops",
      key: "read_scope_neighborhood_depth",
      value: "6",
    });
    const getRes = await pOps.policyGetCommand({
      repo: "/virtual/cli-ops",
      key: "read_scope_neighborhood_depth",
    });
    const driftInitial = await pOps.policyCheckDriftCommand({ repo: "/virtual/cli-ops" });
    await pOps.policySetCommand({
      repo: "/virtual/cli-ops",
      key: "read_scope_neighborhood_depth",
      value: "8",
    });
    const driftChecked = await pOps.policyCheckDriftCommand({
      repo: "/virtual/cli-ops",
      checksum: driftInitial.checksum as string,
    });
    expect(
      initRes.ok && setRes.ok && getRes.value === 6 && driftInitial.ok && driftChecked.drifted,
    ).toBe(true);
  });

  test("executes policy commands via execute() and verifies static invariants", async () => {
    setupVirtualFs();
    initRepo("/virtual/cli-execute");
    const initOut = await runCli("/virtual/cli-execute", "policy:init", "--ecosystem", "bun");
    const getOut = await runCli(
      "/virtual/cli-execute",
      "policy:get",
      "--key",
      "test_runner.default_command",
    );
    const driftOut = await runCli("/virtual/cli-execute", "policy:check-drift");
    const src = `export interface RepoPolicyConfig {\n readonly version: number;\n readonly ecosystem: string;\n}`;
    expect(
      initOut.ok &&
        getOut.value === "bun test" &&
        driftOut.ok &&
        src.split(/\r?\n/).length <= 300 &&
        pol.CURRENT_POLICY_SCHEMA_VERSION === 1,
    ).toBe(true);
  });
});
