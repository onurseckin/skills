import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import * as durableWriteModule from "../../../../olt/scripts/src/core/durable-write.ts";
import * as platform from "../../../../olt/scripts/src/platform/index.ts";
import * as flockFfi from "../../../../olt/scripts/src/platform/fs/flock-ffi.ts";
import * as taskQueueLocks from "../../../../olt/scripts/src/task/queue/locks.ts";
import {
  executeAtomicDispatch,
  executeAtomicAdmissionToDispatch,
  executeProductOwnerAdmissionAndDispatch,
  type AtomicDispatchOptions,
} from "../../../../olt/scripts/src/mind/tasks/smart/index.ts";
import { executeAtomicDispatch as dispatchFromModule } from "../../../../olt/scripts/src/mind/tasks/smart/executor/dispatch.ts";
import { executeAtomicDispatch as dispatchFromExecutorBarrel } from "../../../../olt/scripts/src/mind/tasks/smart/executor/index.ts";
import { executeAtomicDispatch as dispatchFromTasksBarrel } from "../../../../olt/scripts/src/mind/tasks/index.ts";
import {
  ingestFeedbackItem,
  readFeedbackQueue,
} from "../../../../olt/scripts/src/mind/feedback/queue/index.ts";
import { readTaskQueue } from "../../../../olt/scripts/src/task/queue/index.ts";

const origExists = fs.existsSync;
const origRead = fs.readFileSync;

describe("Smart Tasks Execute Atomic Dispatch Test Suite", () => {
  const testRoot = `${process.cwd()}/.olt/virtual-exec-atomic-dispatch`;
  const feedbackFile = join(testRoot, ".olt", "capsules", "FEEDBACK_QUEUE.jsonl");
  const taskQueueFile = join(testRoot, ".olt", "capsules", "TASK_QUEUE.jsonl");
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    mockDirs.add(testRoot);
    mockDirs.add(join(testRoot, ".olt"));
    mockDirs.add(join(testRoot, ".olt", "capsules"));

    let fdCounter = 100;
    const fdMap = new Map<number, string>();
    const getIno = (p: string) => {
      let h = 0;
      for (let i = 0; i < p.length; i++) h = (h * 31 + p.charCodeAt(i)) | 0;
      return Math.abs(h) + 10;
    };

    spies.push(
      spyOn(taskQueueLocks, "acquireTaskQueueFlock").mockImplementation(() => true) as unknown as {
        mockRestore: () => void;
      },
      spyOn(taskQueueLocks, "releaseTaskQueueFlock").mockImplementation(
        () => undefined,
      ) as unknown as { mockRestore: () => void },
      spyOn(platform, "tryExclusiveFlock").mockImplementation(() => true) as unknown as {
        mockRestore: () => void;
      },
      spyOn(platform, "releaseFlock").mockImplementation(() => undefined) as unknown as {
        mockRestore: () => void;
      },
      spyOn(flockFfi, "tryExclusiveFlock").mockImplementation(() => true) as unknown as {
        mockRestore: () => void;
      },
      spyOn(flockFfi, "releaseFlock").mockImplementation(() => undefined) as unknown as {
        mockRestore: () => void;
      },
      spyOn(fs, "existsSync").mockImplementation(((p: fs.PathLike) => {
        const s = String(p);
        return mockFiles.has(s) || mockDirs.has(s) || origExists(p);
      }) as unknown as typeof fs.existsSync) as unknown as { mockRestore: () => void },
      spyOn(fs, "openSync").mockImplementation(((p: fs.PathLike) => {
        const s = String(p);
        const fd = ++fdCounter;
        fdMap.set(fd, s);
        return fd;
      }) as unknown as typeof fs.openSync) as unknown as { mockRestore: () => void },
      spyOn(fs, "closeSync").mockImplementation(((fd: number) => {
        fdMap.delete(fd);
      }) as unknown as typeof fs.closeSync) as unknown as { mockRestore: () => void },
      spyOn(fs, "lstatSync").mockImplementation(((p: fs.PathLike) => {
        const s = String(p);
        const ino = getIno(s);
        if (mockFiles.has(s))
          return {
            isFile: () => true,
            isDirectory: () => false,
            nlink: 1,
            dev: 1,
            ino,
          } as unknown as fs.Stats;
        if (s.endsWith(".jsonl") || s.endsWith(".tmp") || s.includes(".tmp")) {
          const err = new Error(`ENOENT: no such file or directory, lstat '${s}'`) as Error & {
            code: string;
          };
          err.code = "ENOENT";
          throw err;
        }
        return {
          isFile: () => false,
          isDirectory: () => true,
          nlink: 1,
          dev: 1,
          ino,
        } as unknown as fs.Stats;
      }) as unknown as typeof fs.lstatSync) as unknown as { mockRestore: () => void },
      spyOn(fs, "fstatSync").mockImplementation(((fd: number) => {
        const s = fdMap.get(fd) ?? "";
        const ino = getIno(s);
        if (mockFiles.has(s))
          return {
            isFile: () => true,
            isDirectory: () => false,
            nlink: 1,
            dev: 1,
            ino,
          } as unknown as fs.Stats;
        return {
          isFile: () => false,
          isDirectory: () => true,
          nlink: 1,
          dev: 1,
          ino,
        } as unknown as fs.Stats;
      }) as unknown as typeof fs.fstatSync) as unknown as { mockRestore: () => void },
      spyOn(fs, "writeSync").mockImplementation(((
        fd: number,
        buffer: NodeJS.ArrayBufferView,
        _o?: number,
        length?: number,
      ) => {
        const s = fdMap.get(fd) ?? "";
        const text = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).toString(
          "utf8",
        );
        mockFiles.set(s, (mockFiles.get(s) ?? "") + text);
        return length ?? buffer.byteLength;
      }) as unknown as typeof fs.writeSync) as unknown as { mockRestore: () => void },
      spyOn(fs, "fsyncSync").mockImplementation(
        (() => undefined) as unknown as typeof fs.fsyncSync,
      ) as unknown as { mockRestore: () => void },
      spyOn(fs, "renameSync").mockImplementation(((oldP: fs.PathLike, newP: fs.PathLike) => {
        mockFiles.set(String(newP), mockFiles.get(String(oldP)) ?? "");
        mockFiles.delete(String(oldP));
      }) as unknown as typeof fs.renameSync) as unknown as { mockRestore: () => void },
      spyOn(fs, "unlinkSync").mockImplementation(((p: fs.PathLike) => {
        mockFiles.delete(String(p));
      }) as unknown as typeof fs.unlinkSync) as unknown as { mockRestore: () => void },
      spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor) => {
        const s = typeof p === "number" ? (fdMap.get(p) ?? "") : String(p);
        const val = mockFiles.get(s);
        if (val !== undefined) return val;
        try {
          return origRead(p as string, "utf8");
        } catch {
          const err = new Error(`ENOENT: no such file or directory, open '${s}'`) as Error & {
            code: string;
          };
          err.code = "ENOENT";
          throw err;
        }
      }) as unknown as typeof fs.readFileSync) as unknown as { mockRestore: () => void },
      spyOn(fs, "writeFileSync").mockImplementation(((
        p: fs.PathOrFileDescriptor,
        data: string | NodeJS.ArrayBufferView,
      ) => {
        const s = typeof p === "number" ? (fdMap.get(p) ?? "") : String(p);
        mockFiles.set(
          s,
          typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf-8"),
        );
      }) as unknown as typeof fs.writeFileSync) as unknown as { mockRestore: () => void },
      spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike) => {
        mockDirs.add(String(p));
        return undefined as unknown as string;
      }) as unknown as typeof fs.mkdirSync) as unknown as { mockRestore: () => void },
      spyOn(durableWriteModule, "atomicWriteBytes").mockImplementation(((
        targetPath: string,
        bytes: Uint8Array,
      ) => {
        mockFiles.set(targetPath, new TextDecoder().decode(bytes));
      }) as unknown as typeof durableWriteModule.atomicWriteBytes) as unknown as {
        mockRestore: () => void;
      },
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  it("exports executeAtomicDispatch across canonical module and barrels", () => {
    expect(typeof executeAtomicDispatch).toBe("function");
    expect(typeof dispatchFromModule).toBe("function");
    expect(typeof dispatchFromExecutorBarrel).toBe("function");
    expect(typeof dispatchFromTasksBarrel).toBe("function");
    expect(executeAtomicDispatch).toBe(dispatchFromModule);
    expect(executeAtomicDispatch).toBe(dispatchFromExecutorBarrel);
    expect(executeAtomicDispatch).toBe(dispatchFromTasksBarrel);
  });

  it("handles empty feedback queue by returning empty arrays and valid invariant report", () => {
    const opts: AtomicDispatchOptions = { capsulesDir: feedbackFile, queuePath: taskQueueFile };
    const result = executeAtomicDispatch(opts);
    expect(result.synthesized_tasks).toHaveLength(0);
    expect(result.enqueued_tasks).toHaveLength(0);
    expect(result.admitted_feedbacks).toHaveLength(0);
    expect(result.audit_report.zero_paused_admitted).toBe(true);
    expect(result.summary).toContain("No pending feedback items");
  });

  it("atomically admits and dispatches pending feedback items into task queue", () => {
    ingestFeedbackItem(
      {
        title: "Remediate missing export",
        content: "Export executeAtomicDispatch cleanly",
        priority: "CRITICAL_USER_FEEDBACK",
        category: "CORE_ENGINE",
      },
      feedbackFile,
    );
    ingestFeedbackItem(
      {
        title: "Harden validation rules",
        content: "Enforce anti-batching 1:1 isolation",
        priority: "HIGH_ARCHITECTURAL_FEATURE",
        category: "SCALING",
      },
      feedbackFile,
    );

    const result = executeAtomicDispatch({
      capsulesDir: feedbackFile,
      queuePath: taskQueueFile,
      charterGoals: ["G1", "G2"],
    });
    expect(result.synthesized_tasks).toHaveLength(2);
    expect(result.enqueued_tasks).toHaveLength(2);
    expect(result.admitted_feedbacks).toHaveLength(2);
    expect(result.audit_report.zero_paused_admitted).toBe(true);

    const enqueued = readTaskQueue(taskQueueFile);
    expect(enqueued).toHaveLength(2);

    const feedbacks = readFeedbackQueue(feedbackFile);
    expect(feedbacks.filter((f) => f.status === "ADMITTED")).toHaveLength(2);
    for (const fb of feedbacks) {
      expect(typeof fb.metadata?.["dispatched_task_id"]).toBe("string");
      expect(typeof fb.metadata?.["atomic_dispatched_at"]).toBe("string");
      expect(fb.metadata?.["feedback_dispatch_state"]).toBe("COMMITTED");
    }
  });

  it("honors maxTasks and stages tasks when orchestratorIds are provided", () => {
    for (let i = 1; i <= 5; i++) {
      ingestFeedbackItem(
        {
          title: `Task item ${i}`,
          content: `Description for task ${i}`,
          priority: "NORMAL",
          category: "CORE_ENGINE",
        },
        feedbackFile,
      );
    }

    const result = executeAtomicDispatch({
      capsulesDir: feedbackFile,
      queuePath: taskQueueFile,
      maxTasks: 3,
      orchestratorIds: ["orch-alpha", "orch-beta"],
    });
    expect(result.synthesized_tasks).toHaveLength(3);
    expect(result.enqueued_tasks).toHaveLength(3);
    expect(result.admitted_feedbacks).toHaveLength(3);
    expect(result.audit_report.zero_paused_admitted).toBe(true);

    for (const task of result.synthesized_tasks) {
      expect(task.assigned_tier).toBe("Tier_1_Orchestrator");
      expect(typeof task.metadata?.["assigned_orchestrator"]).toBe("string");
    }
  });

  it("accepts explicitly passed feedbackItems in options without reading file", () => {
    const customFeedbacks = [
      {
        id: "direct-fb-1",
        title: "Direct Feedback 1",
        content: "Content 1",
        priority: "CRITICAL_USER_FEEDBACK" as const,
        status: "PENDING" as const,
        category: "CORE_ENGINE" as const,
        timestamp: new Date().toISOString(),
        candidate_id: null,
      },
    ];
    const result = executeAtomicDispatch({
      capsulesDir: feedbackFile,
      queuePath: taskQueueFile,
      feedbackItems: customFeedbacks,
    });
    expect(result.synthesized_tasks).toHaveLength(1);
    expect(result.enqueued_tasks).toHaveLength(1);
    expect(result.enqueued_tasks[0]?.id).toBe(result.synthesized_tasks[0]?.id);
  });

  it("verifies equivalence with executeAtomicAdmissionToDispatch and executeProductOwnerAdmissionAndDispatch", () => {
    const queue1 = join(testRoot, ".olt", "capsules", "TQ1.jsonl");
    const queue2 = join(testRoot, ".olt", "capsules", "TQ2.jsonl");
    const queue3 = join(testRoot, ".olt", "capsules", "TQ3.jsonl");
    const directItem = [
      {
        id: "fb-equiv-1",
        title: "Equivalence Task",
        content: "Equivalence check",
        priority: "NORMAL" as const,
        status: "PENDING" as const,
        category: "GENERAL" as const,
        timestamp: new Date().toISOString(),
        candidate_id: null,
      },
    ];

    const res1 = executeAtomicDispatch({
      capsulesDir: feedbackFile,
      queuePath: queue1,
      feedbackItems: directItem,
    });
    const res2 = executeAtomicAdmissionToDispatch({
      capsulesDir: feedbackFile,
      queuePath: queue2,
      feedbackItems: directItem,
    });
    const res3 = executeProductOwnerAdmissionAndDispatch({
      capsulesDir: feedbackFile,
      queuePath: queue3,
      feedbackItems: directItem,
    });

    expect(res1.synthesized_tasks.length).toBe(res2.synthesized_tasks.length);
    expect(res1.synthesized_tasks.length).toBe(res3.synthesized_tasks.length);
    expect(res1.audit_report.zero_paused_admitted).toBe(true);
    expect(res2.audit_report.zero_paused_admitted).toBe(true);
    expect(res3.audit_report.zero_paused_admitted).toBe(true);
  });

  it("enforces strict repository invariants across touched files", () => {
    const files = [
      "olt/scripts/src/mind/tasks/smart/executor/dispatch.ts",
      "olt/scripts/src/mind/tasks/smart/executor/index.ts",
      "olt/scripts/src/mind/tasks/smart/index.ts",
      "olt/scripts/src/mind/tasks/index.ts",
      "tests/mind/synthesis/smart-tasks/execute-atomic-dispatch.test.ts",
    ];

    const colonAny = new RegExp(":\\s*" + "any\\b", "u");
    const asAny = new RegExp("as\\s+" + "any\\b", "u");
    const angleAny = new RegExp("<" + "any>", "u");
    const tsIgnore = "@ts" + "-ignore";
    const tsExpectError = "@ts" + "-expect-error";
    const tsNocheck = "@ts" + "-nocheck";
    const lineComment = new RegExp("^\\s*/" + "/", "mu");
    const blockComment = new RegExp("/" + "\\*", "mu");

    for (const relPath of files) {
      const fullPath = join(process.cwd(), relPath);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, "utf8");
      const lines = content.split("\n");
      expect(lines.length).toBeLessThanOrEqual(300);

      const stripped = content
        .split("\n")
        .filter(
          (l) =>
            !l.includes("colonAny") &&
            !l.includes("asAny") &&
            !l.includes("angleAny") &&
            !l.includes("lineComment") &&
            !l.includes("blockComment"),
        )
        .join("\n");

      expect(colonAny.test(stripped)).toBe(false);
      expect(asAny.test(stripped)).toBe(false);
      expect(angleAny.test(stripped)).toBe(false);
      expect(content.includes(tsIgnore)).toBe(false);
      expect(content.includes(tsExpectError)).toBe(false);
      expect(content.includes(tsNocheck)).toBe(false);
      expect(lineComment.test(stripped)).toBe(false);
      expect(blockComment.test(stripped)).toBe(false);
    }
  });
});
