import { describe, it, expect, beforeEach } from "bun:test";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import {
  mindTaskDiscoveryCommand,
  mindSelfEvolveCommand,
  mindStrategicCognitionCommand,
  MIND_TASK_DISCOVERY_COMMAND_SPEC,
  MIND_SELF_EVOLVE_COMMAND_SPEC,
  MIND_STRATEGIC_COGNITION_COMMAND_SPEC,
} from "../../olt/scripts/src/mind/lifecycle/index.ts";
import { scratchRoot } from "../shared/scratch-root.ts";

describe("mind/mind.ts Unified Mind Commands and CommandSpecs", () => {
  let scratchDir: string;
  let charterPath: string;
  let feedbackQueuePath: string;
  let taskQueuePath: string;
  let historyPath: string;

  beforeEach(() => {
    scratchDir = scratchRoot(import.meta.path, "mind-commands-test");
    charterPath = join(scratchDir, "mind.yaml");
    feedbackQueuePath = join(scratchDir, "FEEDBACK_QUEUE.jsonl");
    taskQueuePath = join(scratchDir, "TASK_QUEUE.jsonl");
    historyPath = join(scratchDir, "EVOLUTION_HISTORY.jsonl");

    writeFileSync(
      charterPath,
      'name: "mind"\nrole: "mind"\ncharter:\n  identity: "Test"\n  goals:\n    - id: "G1"\n      statement: "Stability"\n  non_goals:\n    - "None"\n  repo_roots:\n    - "src/"\n',
      "utf-8",
    );
    writeFileSync(feedbackQueuePath, "", "utf-8");
    writeFileSync(taskQueuePath, "", "utf-8");
    writeFileSync(historyPath, "", "utf-8");

    const srcDir = join(scratchDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "index.ts"), "export const a = 1;\n", "utf-8");
  });

  it("exports valid command specs with metadata", () => {
    expect(MIND_TASK_DISCOVERY_COMMAND_SPEC.name).toBe("mind:task-discovery");
    expect(MIND_TASK_DISCOVERY_COMMAND_SPEC.handler).toBe(mindTaskDiscoveryCommand);

    expect(MIND_SELF_EVOLVE_COMMAND_SPEC.name).toBe("mind:self-evolve");
    expect(MIND_SELF_EVOLVE_COMMAND_SPEC.handler).toBe(mindSelfEvolveCommand);

    expect(MIND_STRATEGIC_COGNITION_COMMAND_SPEC.name).toBe("mind:strategic-cognition");
    expect(MIND_STRATEGIC_COGNITION_COMMAND_SPEC.handler).toBe(mindStrategicCognitionCommand);
  });

  it("executes mindTaskDiscoveryCommand successfully", () => {
    const res = mindTaskDiscoveryCommand({
      run: scratchDir,
      charter: charterPath,
      "feedback-queue": feedbackQueuePath,
      "task-queue": taskQueuePath,
      "source-root": [join(scratchDir, "src")],
      "test-root": [join(scratchDir, "src")],
      "max-tasks": "2",
      actor: "custom-discovery",
    });

    expect(res).toBeDefined();
    expect(res["markdown"]).toBeDefined();
    expect(res["discoveries"]).toBeDefined();
    expect(res["findings"]).toBeDefined();
    expect(res["stats"]).toBeDefined();
    expect(res["summary"]).toBeDefined();
  });

  it("executes mindSelfEvolveCommand successfully", () => {
    const res = mindSelfEvolveCommand({
      run: scratchDir,
      charter: charterPath,
      "feedback-queue": feedbackQueuePath,
      "task-queue": taskQueuePath,
      "history-file": historyPath,
      "auto-enqueue": true,
      "max-tasks": "3",
      generation: "1",
      cycle: "1",
    });

    expect(res).toBeDefined();
    expect(res["markdown"]).toBeDefined();
    expect(res["cycle_id"]).toBeDefined();
    expect(res["generation"]).toBe(1);
    expect(res["cycle_number"]).toBe(1);
  });

  it("executes mindStrategicCognitionCommand successfully", () => {
    const res = mindStrategicCognitionCommand({
      "window-hours": "3",
      "fleet-id": "fleet-001",
    });

    expect(res).toBeDefined();
    expect(res["markdown"]).toBeDefined();
    expect(res["altitude"]).toBe("30,000 feet");
    expect(res["window_hours"]).toBe(3);
    expect(res["macro_dag"]).toBeDefined();
    expect(res["backlog_grooming"]).toBeDefined();
    expect(res["proactive_roadmap"]).toBeDefined();
  });
});
