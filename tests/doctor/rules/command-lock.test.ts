import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import * as cle from "../../../olt/scripts/src/reporting/doctor/command-lock-engine.ts";

export const commandLockSuiteName =
  "checkCognitiveValidatorCommandLock & checkCommandLockIntegrity";

type VirtualNode = { isDir: boolean; content?: string };
const vfs = new Map<string, VirtualNode>();
const spies: Array<{ mockRestore: () => void }> = [];

const getStats = (p: fs.PathLike): fs.Stats => {
  const s = String(p).replace(/\/+$/, ""),
    n = vfs.get(s);
  if (n)
    return {
      isFile: () => !n.isDir,
      isDirectory: () => n.isDir,
      isSymbolicLink: () => false,
      mode: n.isDir ? 0o755 : 0o644,
      size: n.content ? Buffer.byteLength(n.content) : 0,
      mtimeMs: Date.now(),
    } as fs.Stats;
  if (Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`)))
    return {
      isFile: () => false,
      isDirectory: () => true,
      isSymbolicLink: () => false,
      mode: 0o755,
      size: 0,
      mtimeMs: Date.now(),
    } as fs.Stats;
  throw new Error(`ENOENT: ${s}`);
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
  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = String(p).replace(/\/+$/, "");
      return vfs.has(s) || Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`));
    }),
    spyOn(fs, "statSync").mockImplementation(getStats),
    spyOn(fs, "readdirSync").mockImplementation(listDir),
    spyOn(fs, "readFileSync").mockImplementation((p) => {
      const n = vfs.get(String(p));
      if (!n || n.content === undefined) throw new Error(`ENOENT: ${String(p)}`);
      return n.content;
    }),
  );
}

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
});

const checkSt = (
  agents: Record<string, { role: string }>,
  commands: Array<{ agent_id: string; command: string }>,
) => cle.checkCognitiveValidatorCommandLock({ state: { agents, commands } });

describe(commandLockSuiteName, () => {
  test("passes when implementer executes file-scoped test and validator has zero commands", () => {
    const res = checkSt({ "impl-1": { role: "implementer" }, "val-1": { role: "validator" } }, [
      { agent_id: "impl-1", command: "bun test tests/authority/guards-and-rbac.test.ts" },
      { agent_id: "impl-1", command: "git status" },
    ]);
    expect(
      res.engine === "checkCognitiveValidatorCommandLock" &&
        res.passed &&
        res.findings.length === 0,
    ).toBe(true);
  });

  test("detects cognitive validator executing command in state.commands", () => {
    const res = checkSt({ "val-1": { role: "validator" } }, [
      { agent_id: "val-1", command: "bun test tests/doctor/checks/git-index-engine.test.ts" },
    ]);
    expect(
      !res.passed &&
        res.findings.length === 1 &&
        res.findings[0]?.code === "COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION" &&
        res.findings[0]?.severity === "ERROR",
    ).toBe(true);
  });

  test("detects completeness critic executing command in events", () => {
    const res = cle.checkCognitiveValidatorCommandLock({
      events: [
        {
          name: "command-executed",
          actor: "critic_run-1",
          payload: { role: "completeness-critic", command: "git diff" },
        },
      ],
    });
    expect(
      !res.passed &&
        res.findings.length === 1 &&
        res.findings[0]?.code === "COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION",
    ).toBe(true);
  });

  test("infers validator role from agent naming convention in grants", () => {
    const res = cle.checkCognitiveValidatorCommandLock({
      grants: [{ id: "agent-x", role: "ui-validator" }],
      commands: [{ actor: "agent-x", command: "bun test tests/mind/view.test.ts" }],
    });
    expect(
      !res.passed &&
        res.findings.length === 1 &&
        res.findings[0]?.code === "COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION",
    ).toBe(true);
  });

  test("detects implementer executing whole-suite test runs in state.commands", () => {
    const cmds = [
      "bun test",
      "npm test",
      "vitest",
      "jest",
      "pnpm test",
      "yarn test",
      "bun run test",
    ];
    for (const cmd of cmds) {
      const res = checkSt({ "worker-1": { role: "implementer" } }, [
        { agent_id: "worker-1", command: cmd },
      ]);
      expect(
        !res.passed &&
          res.findings.length === 1 &&
          res.findings[0]?.code === "IMPLEMENTER_COMMAND_LOCK_VIOLATION" &&
          res.findings[0]?.details?.reason === "WHOLE_SUITE_TEST_RUN_DENIED",
      ).toBe(true);
    }
  });

  test("detects implementer executing whole-suite test runs in events", () => {
    const res = cle.checkCognitiveValidatorCommandLock({
      events: [
        {
          name: "command-executed",
          actor: "implementer-42",
          payload: { role: "implementer", command: "bun test" },
        },
      ],
    });
    expect(
      !res.passed &&
        res.findings.length === 1 &&
        res.findings[0]?.code === "IMPLEMENTER_COMMAND_LOCK_VIOLATION",
    ).toBe(true);
  });

  test("detects implementer executing unauthorized git mutations", () => {
    const dangerousGit = [
      "git reset --hard HEAD~1",
      "git push origin main --force",
      "git clean -fd",
      "git checkout main",
    ];
    for (const cmd of dangerousGit) {
      const res = checkSt({ "impl-1": { role: "implementer" } }, [
        { agent_id: "impl-1", command: cmd },
      ]);
      expect(
        !res.passed &&
          res.findings.length === 1 &&
          res.findings[0]?.code === "IMPLEMENTER_COMMAND_LOCK_VIOLATION" &&
          res.findings[0]?.details?.reason === "UNAUTHORIZED_GIT_MUTATION",
      ).toBe(true);
    }
  });

  test("returns passed when no capsules exist", () => {
    const res = cle.checkCommandLockIntegrity("/non-existent-olt-dir");
    expect(
      res.engine === "checkCommandLockIntegrity" && res.passed && res.findings.length === 0,
    ).toBe(true);
  });

  test("detects corrupted state.json, validator violations, and implementer whole-suite violations", () => {
    setupVirtualFs();
    const scratch = "/virtual/cmd-lock-test",
      capDir = join(scratch, ".olt", "capsules");
    vfs.set(scratch, { isDir: true });
    vfs.set(capDir, { isDir: true });
    vfs.set(join(capDir, "cap-corrupt"), { isDir: true });
    vfs.set(join(capDir, "cap-val-violation"), { isDir: true });
    vfs.set(join(capDir, "cap-impl-violation"), { isDir: true });
    vfs.set(join(capDir, "cap-corrupt", "state.json"), { content: "{ invalid json", isDir: false });
    vfs.set(join(capDir, "cap-val-violation", "state.json"), {
      content: JSON.stringify({
        agents: { "v-1": { role: "validator" } },
        commands: [{ agent_id: "v-1", command: "echo test" }],
      }),
      isDir: false,
    });
    vfs.set(join(capDir, "cap-impl-violation", "state.json"), {
      content: JSON.stringify({
        agents: { "impl-1": { role: "implementer" } },
        commands: [{ agent_id: "impl-1", command: "bun test" }],
      }),
      isDir: false,
    });

    const res = cle.checkCommandLockIntegrity(scratch);
    const codes = [
      "COMMAND_LOCK_STATE_CORRUPT",
      "COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION",
      "IMPLEMENTER_COMMAND_LOCK_VIOLATION",
    ];
    expect(
      res.engine === "checkCommandLockIntegrity" &&
        !res.passed &&
        codes.every((c) => res.findings.some((f) => f.code === c)),
    ).toBe(true);
  });

  test("audits direct capsule directory path correctly", () => {
    setupVirtualFs();
    const scratch = "/virtual/cmd-lock-direct";
    vfs.set(scratch, { isDir: true });
    const state = {
      agents: { "worker-1": { role: "implementer" } },
      commands: [
        {
          agent_id: "worker-1",
          command: "bun test tests/doctor/checks/pushback-quotas-engine.test.ts",
        },
      ],
    };
    vfs.set(join(scratch, "state.json"), { content: JSON.stringify(state), isDir: false });

    const res = cle.checkCommandLockIntegrity(scratch);
    expect(
      res.engine === "checkCommandLockIntegrity" && res.passed && res.findings.length === 0,
    ).toBe(true);
  });
});
