import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkCognitiveValidatorCommandLock,
  checkCommandLockIntegrity,
} from "../../../olt/scripts/src/reporting/doctor/command-lock-engine.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("checkCognitiveValidatorCommandLock", () => {
  test("passes when implementer executes commands and validator has zero commands", () => {
    const res = checkCognitiveValidatorCommandLock({
      state: {
        agents: {
          "impl-1": { role: "implementer" },
          "val-1": { role: "validator" },
        },
        commands: [{ agent_id: "impl-1", command: "bun test tests/unit/auth.test.ts" }],
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
        commands: [{ agent_id: "val-1", command: "bun test" }],
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
      commands: [{ actor: "agent-x", command: "bun test tests/ui" }],
    });

    expect(res.passed).toBe(false);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].code).toBe("COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION");
  });
});

describe("checkCommandLockIntegrity", () => {
  test("returns passed when no capsules exist", () => {
    const res = checkCommandLockIntegrity("/non-existent-olt-dir");
    expect(res.engine).toBe("checkCommandLockIntegrity");
    expect(res.passed).toBe(true);
    expect(res.findings).toHaveLength(0);
  });

  test("detects corrupted state.json and validator lock violations in disk capsules", () => {
    const scratch = scratchRoot(import.meta.path, "cmd-lock-integrity-test");
    const capsulesDir = join(scratch, ".olt", "capsules");
    const cap1 = join(capsulesDir, "cap-corrupt");
    const cap2 = join(capsulesDir, "cap-violation");
    mkdirSync(cap1, { recursive: true });
    mkdirSync(cap2, { recursive: true });

    writeFileSync(join(cap1, "state.json"), "{ broken json", "utf8");

    const stateViolation = {
      agents: { "v-1": { role: "validator" } },
      commands: [{ agent_id: "v-1", command: "bun test" }],
    };
    writeFileSync(join(cap2, "state.json"), JSON.stringify(stateViolation), "utf8");

    const res = checkCommandLockIntegrity(scratch);
    expect(res.engine).toBe("checkCommandLockIntegrity");
    expect(res.passed).toBe(false);

    const corruptFinding = res.findings.find((f) => f.code === "COMMAND_LOCK_STATE_CORRUPT");
    expect(corruptFinding).toBeDefined();

    const lockFinding = res.findings.find(
      (f) => f.code === "COGNITIVE_VALIDATOR_COMMAND_LOCK_VIOLATION",
    );
    expect(lockFinding).toBeDefined();

    rmSync(scratch, { recursive: true, force: true });
  });
});
