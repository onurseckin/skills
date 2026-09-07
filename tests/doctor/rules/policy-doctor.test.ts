import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import * as pOps from "../../../olt/scripts/src/cli/commands/policy-ops.ts";
import { checkPolicyDoctor } from "../../../olt/scripts/src/reporting/doctor/policy-doctor.ts";
import * as pol from "../../../olt/scripts/src/policy/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const policyDoctorSuiteName =
  "Doctor Policy Certification & Policy CLI Operations (Task 4.3)";

let vfs: VirtualMemoryFS;
let session: VirtualFSSession;

function setupVirtualFs(): void {
  vfs.reset();
  vfs.mkdirSync(process.cwd(), { recursive: true });
  vfs.mkdirSync(join(process.cwd(), ".git"), { recursive: true });
  vfs.writeFileSync(join(process.cwd(), "package.json"), "{}");
}

beforeEach(() => {
  vfs = new VirtualMemoryFS();
  session = createVirtualFSSession(vfs);
  setupVirtualFs();
});

afterEach(() => {
  session.cleanup();
});

const initRepo = (repo: string) => {
  vfs.mkdirSync(repo, { recursive: true });
  vfs.mkdirSync(join(repo, ".git"), { recursive: true });
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
    vfs.mkdirSync(join(repo, ".olt"), { recursive: true });
    vfs.writeFileSync(join(repo, ".olt", "policy.json"), "{ invalid-json: true ");
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
        src.split(/\r?\n/).length <= 400 &&
        pol.CURRENT_POLICY_SCHEMA_VERSION === 1,
    ).toBe(true);
  });
});
