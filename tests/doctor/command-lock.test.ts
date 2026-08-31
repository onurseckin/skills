import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkCognitiveValidatorCommandLock,
  checkCommandLockIntegrity,
} from "../../olt/scripts/src/reporting/doctor/command-lock-engine.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("checkCognitiveValidatorCommandLock", () => {
  test("passes when implementer executes file-scoped test and validator has zero commands", () => {
    const res = checkCognitiveValidatorCommandLock({
      state: {
        agents: {
          "impl-1": { role: "implementer" },
          "val-1": { role: "validator" },
        },
        commands: [
          { agent_id: "impl-1", command: "bun test tests/unit/auth.test.ts" },
          { agent_id: "impl-1", command: "git status" },
        ],
      },
    });

    expect(res.engine).toBe("checkCognitiveValidatorCommandLock");
    expect(res.passed).toBe(true);
    expect(res.findings).toHaveLength(0);
  });

  test("detects cognitive validator executing command in state.commands", () => {
    const res = checkCognitiveValidatorCommandLock({
      state: {
        agents: {
          "val-1": { role: "validator" },
        },
        commands: [{ agent_id: "val-1", command: "bun test tests/unit/foo.test.ts" }],
      },
    });

    expect(res.passed).toBe(false);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].code).toBe("COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION");
    expect(res.findings[0].severity).toBe("ERROR");
  });

  test("detects completeness critic executing command in events", () => {
    const res = checkCognitiveValidatorCommandLock({
      events: [
        {
          name: "command-executed",
          actor: "critic_run-1",
          payload: {
            role: "completeness-critic",
            command: "git diff",
          },
        },
      ],
    });

    expect(res.passed).toBe(false);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].code).toBe("COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION");
  });

  test("infers validator role from agent naming convention in grants", () => {
    const res = checkCognitiveValidatorCommandLock({
      grants: [{ id: "agent-x", role: "ui-validator" }],
      commands: [{ actor: "agent-x", command: "bun test tests/ui/view.test.ts" }],
    });

    expect(res.passed).toBe(false);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].code).toBe("COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION");
  });

  test("detects implementer executing whole-suite test runs in state.commands", () => {
    const wholeSuiteCommands = [
      "bun test",
      "npm test",
      "vitest",
      "jest",
      "pnpm test",
      "yarn test",
      "bun run test",
    ];

    for (const cmd of wholeSuiteCommands) {
      const res = checkCognitiveValidatorCommandLock({
        state: {
          agents: { "worker-1": { role: "implementer" } },
          commands: [{ agent_id: "worker-1", command: cmd }],
        },
      });

      expect(res.passed).toBe(false);
      expect(res.findings).toHaveLength(1);
      expect(res.findings[0].code).toBe("IMPLEMENTER_COMMAND_LOCK_VIOLATION");
      expect(res.findings[0].details?.reason).toBe("WHOLE_SUITE_TEST_RUN_DENIED");
    }
  });

  test("detects implementer executing whole-suite test runs in events", () => {
    const res = checkCognitiveValidatorCommandLock({
      events: [
        {
          name: "command-executed",
          actor: "implementer-42",
          payload: {
            role: "implementer",
            command: "bun test",
          },
        },
      ],
    });

    expect(res.passed).toBe(false);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].code).toBe("IMPLEMENTER_COMMAND_LOCK_VIOLATION");
  });

  test("detects implementer executing unauthorized git mutations", () => {
    const dangerousGit = [
      "git reset --hard HEAD~1",
      "git push origin main --force",
      "git clean -fd",
      "git checkout main",
    ];

    for (const cmd of dangerousGit) {
      const res = checkCognitiveValidatorCommandLock({
        state: {
          agents: { "impl-1": { role: "implementer" } },
          commands: [{ agent_id: "impl-1", command: cmd }],
        },
      });

      expect(res.passed).toBe(false);
      expect(res.findings).toHaveLength(1);
      expect(res.findings[0].code).toBe("IMPLEMENTER_COMMAND_LOCK_VIOLATION");
      expect(res.findings[0].details?.reason).toBe("UNAUTHORIZED_GIT_MUTATION");
    }
  });
});

describe("checkCommandLockIntegrity", () => {
  test("returns passed when no capsules exist", () => {
    const res = checkCommandLockIntegrity("/non-existent-olt-dir");
    expect(res.engine).toBe("checkCommandLockIntegrity");
    expect(res.passed).toBe(true);
    expect(res.findings).toHaveLength(0);
  });

  test("detects corrupted state.json, validator violations, and implementer whole-suite violations", () => {
    const scratch = scratchRoot(import.meta.path, "cmd-lock-integrity-comprehensive");
    const capsulesDir = join(scratch, ".olt", "capsules");
    const capCorrupt = join(capsulesDir, "cap-corrupt");
    const capValidator = join(capsulesDir, "cap-val-violation");
    const capImpl = join(capsulesDir, "cap-impl-violation");

    mkdirSync(capCorrupt, { recursive: true });
    mkdirSync(capValidator, { recursive: true });
    mkdirSync(capImpl, { recursive: true });

    writeFileSync(join(capCorrupt, "state.json"), "{ invalid json", "utf8");

    const validatorState = {
      agents: { "v-1": { role: "validator" } },
      commands: [{ agent_id: "v-1", command: "echo test" }],
    };
    writeFileSync(join(capValidator, "state.json"), JSON.stringify(validatorState), "utf8");

    const implState = {
      agents: { "impl-1": { role: "implementer" } },
      commands: [{ agent_id: "impl-1", command: "bun test" }],
    };
    writeFileSync(join(capImpl, "state.json"), JSON.stringify(implState), "utf8");

    const res = checkCommandLockIntegrity(scratch);
    expect(res.engine).toBe("checkCommandLockIntegrity");
    expect(res.passed).toBe(false);

    const corruptFinding = res.findings.find((f) => f.code === "COMMAND_LOCK_STATE_CORRUPT");
    expect(corruptFinding).toBeDefined();

    const valFinding = res.findings.find(
      (f) => f.code === "COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION",
    );
    expect(valFinding).toBeDefined();

    const implFinding = res.findings.find((f) => f.code === "IMPLEMENTER_COMMAND_LOCK_VIOLATION");
    expect(implFinding).toBeDefined();

    rmSync(scratch, { recursive: true, force: true });
  });

  test("audits direct capsule directory path correctly", () => {
    const scratch = scratchRoot(import.meta.path, "cmd-lock-direct-capsule");
    mkdirSync(scratch, { recursive: true });

    const state = {
      agents: { "worker-1": { role: "implementer" } },
      commands: [{ agent_id: "worker-1", command: "bun test tests/unit/sample.test.ts" }],
    };
    writeFileSync(join(scratch, "state.json"), JSON.stringify(state), "utf8");

    const res = checkCommandLockIntegrity(scratch);
    expect(res.engine).toBe("checkCommandLockIntegrity");
    expect(res.passed).toBe(true);
    expect(res.findings).toHaveLength(0);

    rmSync(scratch, { recursive: true, force: true });
  });
});
