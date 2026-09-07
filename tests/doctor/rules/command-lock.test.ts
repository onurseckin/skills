import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import * as cle from "../../../olt/scripts/src/reporting/doctor/command-lock-engine.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const commandLockSuiteName =
  "checkCognitiveValidatorCommandLock & checkCommandLockIntegrity";

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession | null = null;

function setupVirtualFs(): void {
  if (session) session.cleanup();
  vfs = new VirtualMemoryFS();
  session = createVirtualFSSession(vfs);
}

beforeEach(() => {
  setupVirtualFs();
});

afterEach(() => {
  if (session) {
    session.cleanup();
    session = null;
  }
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
      grants: [{ id: "agent-x", role: "ui-optical-validator" }],
      commands: [{ actor: "agent-x", command: "bun test tests/mind/view.test.ts" }],
    });
    expect(
      !res.passed &&
        res.findings.length === 1 &&
        res.findings[0]?.code === "COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION",
    ).toBe(true);
  });

  test("allows ui-headless-validator to execute Playwright commands (mechanic role is not command-locked)", () => {
    const res = checkSt({ "agent-x": { role: "ui-headless-validator" } }, [
      { agent_id: "agent-x", command: "npx playwright test" },
    ]);
    expect(
      res.engine === "checkCognitiveValidatorCommandLock" &&
        res.passed &&
        res.findings.length === 0,
    ).toBe(true);
  });

  test("infers ui-headless-validator role from agent naming convention and does not lock it", () => {
    const res = cle.checkCognitiveValidatorCommandLock({
      commands: [{ actor: "ui-headless-validator-1", command: "npx playwright test" }],
    });
    expect(
      res.engine === "checkCognitiveValidatorCommandLock" &&
        res.passed &&
        res.findings.length === 0,
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
    const scratch = "/virtual/cmd-lock-test";
    const capDir = join(scratch, ".olt", "capsules");
    vfs.mkdirSync(scratch, { recursive: true });
    vfs.mkdirSync(capDir, { recursive: true });
    vfs.mkdirSync(join(capDir, "cap-corrupt"), { recursive: true });
    vfs.mkdirSync(join(capDir, "cap-val-violation"), { recursive: true });
    vfs.mkdirSync(join(capDir, "cap-impl-violation"), { recursive: true });
    vfs.writeFileSync(join(capDir, "cap-corrupt", "state.json"), "{ invalid json");
    vfs.writeFileSync(
      join(capDir, "cap-val-violation", "state.json"),
      JSON.stringify({
        agents: { "v-1": { role: "validator" } },
        commands: [{ agent_id: "v-1", command: "echo test" }],
      }),
    );
    vfs.writeFileSync(
      join(capDir, "cap-impl-violation", "state.json"),
      JSON.stringify({
        agents: { "impl-1": { role: "implementer" } },
        commands: [{ agent_id: "impl-1", command: "bun test" }],
      }),
    );

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
    vfs.mkdirSync(scratch, { recursive: true });
    const state = {
      agents: { "worker-1": { role: "implementer" } },
      commands: [
        {
          agent_id: "worker-1",
          command: "bun test tests/doctor/checks/pushback-quotas-engine.test.ts",
        },
      ],
    };
    vfs.writeFileSync(join(scratch, "state.json"), JSON.stringify(state));

    const res = cle.checkCommandLockIntegrity(scratch);
    expect(
      res.engine === "checkCommandLockIntegrity" && res.passed && res.findings.length === 0,
    ).toBe(true);
  });
});
