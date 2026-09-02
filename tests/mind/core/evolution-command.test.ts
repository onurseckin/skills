import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mindSelfEvolveCommand,
  mindStrategicCognitionCommand,
} from "../../../olt/scripts/src/mind/core/evolution-command.ts";

describe("evolution-command Core Module Coverage Suite", () => {
  let tempDir: string;
  let charterPath: string;
  let taskQueuePath: string;
  let feedbackQueuePath: string;
  let historyPath: string;
  let capsulesDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "evolution-cmd-test-"));
    charterPath = join(tempDir, "CHARTER.yaml");
    taskQueuePath = join(tempDir, "tasks.jsonl");
    feedbackQueuePath = join(tempDir, "feedback.jsonl");
    historyPath = join(tempDir, "history.jsonl");
    capsulesDir = join(tempDir, "capsules");
    mkdirSync(capsulesDir, { recursive: true });

    const charterYaml = `
identity: "Test Mind Core"
goals:
  - id: "G1"
    statement: "Drive continuous system capability"
non_goals:
  - "Make-work"
`;
    writeFileSync(charterPath, charterYaml, "utf8");
    writeFileSync(taskQueuePath, "", "utf8");
    writeFileSync(feedbackQueuePath, "", "utf8");
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("mindSelfEvolveCommand executes Mode A discovery with default and custom flags", () => {
    // 1. Mode A execution with custom parameters
    const result1 = mindSelfEvolveCommand({
      charter: charterPath,
      "task-queue": taskQueuePath,
      "feedback-queue": feedbackQueuePath,
      "history-file": historyPath,
      "capsules-dir": capsulesDir,
      generation: 2,
      cycle: 4,
      "max-tasks": 3,
      actor: "test-mind-agent",
      "auto-enqueue": true,
    });

    expect(result1.generation).toBe(2);
    expect(result1.cycle_number).toBe(4);
    expect(typeof result1.cycle_id).toBe("string");
    expect(typeof result1.markdown).toBe("string");
    expect(result1.markdown).toContain("Self-Evolution Cycle");
    expect(Array.isArray(result1.synthesized_tasks)).toBe(true);
    expect(Array.isArray(result1.candidate_proposals)).toBe(true);
    expect(Array.isArray(result1.enqueued_tasks)).toBe(true);
    expect(typeof result1.duration_ms).toBe("number");
  });

  test("mindSelfEvolveCommand executes Mode B feedback intake when feedback items are pending", () => {
    const feedbackItem = {
      id: "fb-cov-1",
      timestamp: new Date().toISOString(),
      title: "Expand error coverage",
      content: "Ensure CLI flags produce appropriate error messages",
      priority: "NORMAL",
      status: "PENDING",
      category: "CLI_TOOLING",
    };
    writeFileSync(feedbackQueuePath, JSON.stringify(feedbackItem) + "\n", "utf8");

    const result = mindSelfEvolveCommand({
      charter: charterPath,
      "task-queue": taskQueuePath,
      "feedback-queue": feedbackQueuePath,
      "history-file": historyPath,
      "capsules-dir": capsulesDir,
    });

    expect(result.mode).toBe("MODE_B_FEEDBACK_INTAKE");
    expect(result.admitted_feedback_ids).toContain("fb-cov-1");
    expect(typeof result.markdown).toBe("string");
  });

  test("mindStrategicCognitionCommand executes proactive cognition with default and custom windows", () => {
    // 1. Default window-hours (2h)
    const result1 = mindStrategicCognitionCommand({});

    expect(result1.altitude).toBe("30,000 feet");
    expect(result1.window_hours).toBe(2);
    expect(typeof result1.markdown).toBe("string");
    expect(result1.markdown).toContain("Tier 0 Mind Strategic Cognition");
    expect(result1.macro_dag).toBeDefined();
    expect(result1.backlog_grooming).toBeDefined();
    expect(result1.candidate_admission).toBeDefined();
    expect(result1.proactive_roadmap).toBeDefined();

    // 2. Custom window-hours and fleet-id
    const result2 = mindStrategicCognitionCommand({
      "window-hours": 5,
      "fleet-id": "fleet-test-omega",
    });

    expect(result2.window_hours).toBe(5);
    expect(result2.strategic_summary).toBeDefined();
    expect(typeof result2.strategic_summary).toBe("string");
  });
});
