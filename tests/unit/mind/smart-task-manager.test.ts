import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  compileSmartTasksToWavePlan,
  expandExternalPromptToPlan,
  expandExternalPromptToWavePlan,
  runAutonomousDualIntakeCycle,
  synthesizeAutonomousTasks,
  type SmartTaskPlan,
} from "../../../orchestrating-long-tasks/scripts/src/mind/smart-task-manager.ts";
import {
  clearTaskQueue,
  completeTask,
  enqueueTask,
  readTaskQueue,
} from "../../../orchestrating-long-tasks/scripts/src/mind/task-queue.ts";
import {
  smartTaskCycleCommand,
  smartTaskIngestCommand,
  smartTaskQueueCompleteCommand,
  smartTaskQueueFailCommand,
  smartTaskQueueListCommand,
  smartTaskQueuePopCommand,
  smartTaskQueueReclaimCommand,
  smartTaskSynthesizeCommand,
} from "../../../orchestrating-long-tasks/scripts/src/cli/commands/smart-task-ops.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Smart Task Manager & Autonomous Synthesizer", () => {
  const testDir = scratchRoot(import.meta.path, "test-smart-task-manager");
  const feedbackFile = join(testDir, "FEEDBACK_QUEUE.jsonl");
  const taskQueueFile = join(testDir, "TASK_QUEUE.jsonl");

  function setup() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      feedbackFile,
      JSON.stringify({
        id: "fb-test-item",
        title: "Test Feedback Item",
        content: "Test feedback content for smart task manager",
        priority: "CRITICAL_USER_FEEDBACK",
        category: "CORE_ENGINE",
        status: "PENDING",
      }) + "\n",
      "utf8",
    );
  }

  function teardown() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  it("synthesizes tasks when pending user feedbacks exist (Mode B External Intake)", () => {
    setup();
    const result = synthesizeAutonomousTasks({
      capsulesDir: feedbackFile,
      queuePath: taskQueueFile,
    });
    expect(result.mode).toBe("feedback_intake");
    expect(result.tasks.length).toBeGreaterThan(0);
    expect(result.source_items_count).toBeGreaterThan(0);

    const firstTask = result.tasks[0]!;
    expect(firstTask.id).toBeDefined();
    expect(firstTask.label).toBeDefined();
    expect(firstTask.write_scope.length).toBeGreaterThan(0);
    expect(firstTask.gate).toContain("bun test");
    expect(firstTask.source_type).toBe("feedback_intake");
    expect(firstTask.acceptance_criteria.length).toBeGreaterThan(0);
    teardown();
  });

  it("respects maxTasks limit during synthesis", () => {
    setup();
    const result = synthesizeAutonomousTasks({
      capsulesDir: feedbackFile,
      queuePath: taskQueueFile,
      maxTasks: 2,
    });
    expect(result.tasks.length).toBeLessThanOrEqual(2);
    teardown();
  });

  it("auto-enqueues synthesized tasks into stateful task queue when requested", () => {
    setup();
    const result = synthesizeAutonomousTasks({
      capsulesDir: feedbackFile,
      queuePath: taskQueueFile,
      autoEnqueue: true,
    });

    expect(result.enqueued_count).toBe(result.tasks.length);
    const queue = readTaskQueue(taskQueueFile);
    expect(queue.length).toBe(result.tasks.length);
    expect(queue[0]!.id).toBe(result.tasks[0]!.id);
    expect(queue[0]!.status).toBe("PENDING");
    teardown();
  });

  it("synthesizes self-evolution tasks when feedback queue is empty (Mode A)", () => {
    setup();
    // Empty the feedback queue
    writeFileSync(feedbackFile, "", "utf8");

    const result = synthesizeAutonomousTasks({
      capsulesDir: feedbackFile,
      queuePath: taskQueueFile,
    });

    expect(result.mode).toBe("self_evolution");
    expect(result.tasks.length).toBeGreaterThan(0);

    const invariantTask = result.tasks.find((t) => t.id.includes("invariant-hardening"));
    expect(invariantTask).toBeDefined();
    expect(invariantTask?.gate).toContain("bun test tests/unit/mind");
    expect(invariantTask?.acceptance_criteria.length).toBeGreaterThan(0);
    teardown();
  });

  it("expands an external prompt into a structured task plan", () => {
    const plan = expandExternalPromptToPlan("Implement real-time metrics telemetry\nDetailed prompt description", {
      baseId: "task-metrics-1",
      charterGoals: ["G1", "G2"],
    });

    expect(plan.id).toBe("task-metrics-1");
    expect(plan.label).toBe("Implement real-time metrics telemetry");
    expect(plan.charter_goals).toEqual(["G1", "G2"]);
    expect(plan.gate).toBe("bun test tests/unit && bun run typecheck");
    expect(plan.source_type).toBe("direct_prompt");
    expect(plan.acceptance_criteria.length).toBeGreaterThan(0);
  });

  it("throws when expanding an empty prompt", () => {
    expect(() => {
      expandExternalPromptToPlan("   ");
    }).toThrow("Prompt cannot be empty");
  });

  it("expands multi-step prompt into a structured wave plan", () => {
    const prompt = `
      Step 1: Define database schema and migrations
      Step 2: Implement REST API endpoints
      Step 3: Add integration tests and benchmarks
    `;

    const wavePlan = expandExternalPromptToWavePlan(prompt, {
      baseIdPrefix: "api-wave",
      charterGoals: ["G1"],
    });

    expect(wavePlan.total_tasks).toBe(3);
    expect(wavePlan.total_waves).toBe(3);
    expect(wavePlan.waves.length).toBe(3);
    expect(wavePlan.waves[0]!.tasks.length).toBe(1);
    expect(wavePlan.waves[0]!.tasks[0]!.id).toContain("api-wave-1");
    expect(wavePlan.waves[1]!.tasks[0]!.dependencies).toContain(wavePlan.waves[0]!.tasks[0]!.id);
  });

  it("compiles smart tasks into waves with disjoint write scopes", () => {
    const tasks: SmartTaskPlan[] = [
      {
        id: "t1",
        label: "Task 1",
        write_scope: ["src/a.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "direct_prompt",
        rationale: "R1",
      },
      {
        id: "t2",
        label: "Task 2",
        write_scope: ["src/b.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "direct_prompt",
        rationale: "R2",
      },
      {
        id: "t3",
        label: "Task 3",
        write_scope: ["src/c.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: ["t1", "t2"],
        source_type: "direct_prompt",
        rationale: "R3",
      },
    ];

    const result = compileSmartTasksToWavePlan(tasks);
    expect(result.total_waves).toBe(2);
    expect(result.total_tasks).toBe(3);

    // Wave 1 should contain independent roots t1 and t2
    expect(result.waves[0]!.wave_number).toBe(1);
    expect(result.waves[0]!.task_ids).toEqual(["t1", "t2"]);

    // Wave 2 should contain dependent t3
    expect(result.waves[1]!.wave_number).toBe(2);
    expect(result.waves[1]!.task_ids).toEqual(["t3"]);
  });

  it("runs full autonomous dual-intake cycle dynamically switching between Mode A and Mode B", () => {
    setup();
    // 1. Initial run with pending feedback -> Mode B
    const cycle1 = runAutonomousDualIntakeCycle({
      capsulesDir: feedbackFile,
      queuePath: taskQueueFile,
    });

    expect(cycle1.mode).toBe("Mode_B_External_Intake");
    expect(cycle1.enqueued_tasks.length).toBeGreaterThan(0);
    expect(cycle1.admitted_feedback_ids.length).toBeGreaterThan(0);

    // 2. Clear task queue and feedback queue -> Mode A Self-Evolution
    clearTaskQueue(taskQueueFile);
    writeFileSync(feedbackFile, "", "utf8");

    const cycle2 = runAutonomousDualIntakeCycle({
      capsulesDir: feedbackFile,
      queuePath: taskQueueFile,
    });

    expect(cycle2.mode).toBe("Mode_A_Self_Evolution");
    expect(cycle2.enqueued_tasks.length).toBeGreaterThan(0);

    // 3. Run again while tasks are active in queue -> Queue_Active
    const cycle3 = runAutonomousDualIntakeCycle({
      capsulesDir: feedbackFile,
      queuePath: taskQueueFile,
    });

    expect(cycle3.mode).toBe("Queue_Active");
    expect(cycle3.enqueued_tasks.length).toBe(0);
    teardown();
  });
});

describe("Smart Task CLI Handlers & Operations", () => {
  const testDir = scratchRoot(import.meta.path, "test-smart-task-cli");
  const feedbackFile = join(testDir, "FEEDBACK_QUEUE.jsonl");
  const taskQueueFile = join(testDir, "TASK_QUEUE.jsonl");

  function setup() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      feedbackFile,
      JSON.stringify({
        id: "fb-cli-1",
        title: "CLI Feature Request",
        content: "Add smart CLI command tests",
        priority: "HIGH_ARCHITECTURAL_FEATURE",
        category: "CLI_TOOLING",
        status: "PENDING",
      }) + "\n",
      "utf8",
    );
  }

  function teardown() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  it("smartTaskSynthesizeCommand executes cleanly with markdown brief", () => {
    setup();
    const res = smartTaskSynthesizeCommand({
      "capsules-dir": feedbackFile,
      "queue-file": taskQueueFile,
      "max-tasks": "2",
    });

    expect(res.mode).toBe("feedback_intake");
    expect(res.tasksCount).toBeGreaterThan(0);
    expect(res.markdown).toContain("Smart Task Autonomous Synthesizer");
    teardown();
  });

  it("smartTaskIngestCommand ingests prompt and optionally enqueues", () => {
    setup();
    const res = smartTaskIngestCommand({
      prompt: "Implement autonomous queue watcher\nFull description",
      id: "task-watcher-cli",
      "queue-file": taskQueueFile,
      "auto-enqueue": true,
    });

    expect(res.task.id).toBe("task-watcher-cli");
    expect(res.markdown).toContain("External Prompt Ingested");

    const queue = readTaskQueue(taskQueueFile);
    expect(queue.some((t) => t.id === "task-watcher-cli")).toBe(true);
    teardown();
  });

  it("smartTaskQueueListCommand, Pop, Complete, Fail, and Reclaim CLI commands work end-to-end", () => {
    setup();
    // Ingest two tasks
    smartTaskIngestCommand({
      prompt: "Task 1 for queue ops",
      id: "cli-t1",
      "queue-file": taskQueueFile,
      "auto-enqueue": true,
    });

    smartTaskIngestCommand({
      prompt: "Task 2 for queue ops",
      id: "cli-t2",
      "queue-file": taskQueueFile,
      "auto-enqueue": true,
    });

    // List
    const listRes = smartTaskQueueListCommand({
      "queue-file": taskQueueFile,
    });
    expect(listRes.count).toBe(2);
    expect(listRes.stats.total).toBe(2);
    expect(listRes.markdown).toContain("Stateful Task Queue Engine");

    // Pop task
    const popRes = smartTaskQueuePopCommand({
      agent: "agent-pop-test",
      "queue-file": taskQueueFile,
      "lease-duration": "600",
    });
    expect(popRes.task).not.toBeNull();
    expect(popRes.leaseToken).not.toBeNull();

    // Complete task
    const compRes = smartTaskQueueCompleteCommand({
      id: popRes.task!.id,
      "lease-token": popRes.leaseToken!,
      "queue-file": taskQueueFile,
    });
    expect(compRes.completedTask.status).toBe("COMPLETED");

    // Fail task
    const failRes = smartTaskQueueFailCommand({
      id: "cli-t2",
      error: "Test failure message",
      "queue-file": taskQueueFile,
      "can-retry": true,
    });
    expect(failRes.task.status).toBe("PENDING"); // retried
    expect(failRes.retried).toBe(true);

    // Reclaim command
    const reclaimRes = smartTaskQueueReclaimCommand({
      "queue-file": taskQueueFile,
    });
    expect(reclaimRes.markdown).toContain("Expired Lease Reclaim Engine");

    // Cycle command
    const cycleRes = smartTaskCycleCommand({
      "capsules-dir": feedbackFile,
      "queue-file": taskQueueFile,
    });
    expect(cycleRes.result).toBeDefined();
    expect(cycleRes.markdown).toContain("Autonomous Dual-Intake Cycle");
    teardown();
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  it("verifies smart task manager files contain zero any and zero suppressions", () => {
    const filesToAudit = [
      "/Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/scripts/src/mind/smart-task-manager.ts",
      "/Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/scripts/src/mind/task-queue.ts",
      "/Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/scripts/src/cli/commands/smart-task-ops.ts",
      "/Users/onurseckinsenoglu/repos/skills/tests/unit/mind/smart-task-manager.test.ts",
    ];

    const anyPattern = /:\s*any\b|as\s+any\b|<any>/;
    const suppressionPattern = /@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable|oxlint-disable/;

    for (const filePath of filesToAudit) {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;

        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});
