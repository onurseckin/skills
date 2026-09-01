import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  injectRemediationToFeedbackQueue,
  type FeedbackInjectionOptions,
  type ForensicsIncident,
} from "../../../../olt/scripts/src/mind/auditing/meta/index.ts";
import {
  __setFeedbackQueuePersistenceTestHook,
  readFeedbackQueue,
} from "../../../../olt/scripts/src/mind/feedback/queue/index.ts";

describe("Meta Auditor - Feedback Queue Remediation Injection (in-memory virtual)", () => {
  const scratchDir = `${process.cwd()}/.olt/virtual-feedback-injection`;
  const queuePath = join(scratchDir, "FEEDBACK_QUEUE.jsonl");
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    mockDirs.add(scratchDir);

    let fdCounter = 100;
    const fdMap = new Map<number, string>();

    const existsSpy = spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
      const pathStr = String(p);
      return mockFiles.has(pathStr) || mockDirs.has(pathStr);
    });
    spies.push(existsSpy);

    const openSpy = spyOn(fs, "openSync").mockImplementation((p: fs.PathLike) => {
      const pathStr = String(p);
      const fd = ++fdCounter;
      fdMap.set(fd, pathStr);
      return fd;
    });
    spies.push(openSpy);

    const closeSpy = spyOn(fs, "closeSync").mockImplementation((fd: number) => {
      fdMap.delete(fd);
    });
    spies.push(closeSpy);

    const getIno = (pathStr: string) => {
      let h = 0;
      for (let i = 0; i < pathStr.length; i++) h = (h * 31 + pathStr.charCodeAt(i)) | 0;
      return Math.abs(h) + 10;
    };

    const lstatSpy = spyOn(fs, "lstatSync").mockImplementation((p: fs.PathLike) => {
      const pathStr = String(p);
      const ino = getIno(pathStr);
      if (mockFiles.has(pathStr)) {
        return {
          isFile: () => true,
          isDirectory: () => false,
          nlink: 1,
          dev: 1,
          ino,
        } as unknown as fs.Stats;
      }
      if (pathStr.endsWith(".jsonl") || pathStr.endsWith(".tmp") || pathStr.includes(".tmp")) {
        const err = new Error(`ENOENT: no such file or directory, lstat '${pathStr}'`) as Error & {
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
    });
    spies.push(lstatSpy);

    const fstatSpy = spyOn(fs, "fstatSync").mockImplementation((fd: number) => {
      const pathStr = fdMap.get(fd) ?? "";
      const ino = getIno(pathStr);
      if (mockFiles.has(pathStr)) {
        return {
          isFile: () => true,
          isDirectory: () => false,
          nlink: 1,
          dev: 1,
          ino,
        } as unknown as fs.Stats;
      }
      return {
        isFile: () => false,
        isDirectory: () => true,
        nlink: 1,
        dev: 1,
        ino,
      } as unknown as fs.Stats;
    });
    spies.push(fstatSpy);

    const writeSyncSpy = spyOn(fs, "writeSync").mockImplementation(
      (fd: number, buffer: NodeJS.ArrayBufferView, offset?: number, length?: number) => {
        const pathStr = fdMap.get(fd) ?? "";
        const buf = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const text = buf.toString("utf8");
        const prev = mockFiles.get(pathStr) ?? "";
        mockFiles.set(pathStr, prev + text);
        return length ?? buffer.byteLength;
      },
    );
    spies.push(writeSyncSpy);

    const fsyncSpy = spyOn(fs, "fsyncSync").mockImplementation(() => undefined);
    spies.push(fsyncSpy);

    const renameSpy = spyOn(fs, "renameSync").mockImplementation(
      (oldPath: fs.PathLike, newPath: fs.PathLike) => {
        const oldStr = String(oldPath);
        const newStr = String(newPath);
        const val = mockFiles.get(oldStr) ?? "";
        mockFiles.set(newStr, val);
        mockFiles.delete(oldStr);
      },
    );
    spies.push(renameSpy);

    const readSpy = spyOn(fs, "readFileSync").mockImplementation((p: fs.PathOrFileDescriptor) => {
      const pathStr = typeof p === "number" ? (fdMap.get(p) ?? "") : String(p);
      const val = mockFiles.get(pathStr);
      if (val !== undefined) return val;
      const err = new Error(`ENOENT: no such file or directory, open '${pathStr}'`) as Error & {
        code: string;
      };
      err.code = "ENOENT";
      throw err;
    });
    spies.push(readSpy);

    const writeSpy = spyOn(fs, "writeFileSync").mockImplementation(
      (p: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView) => {
        const pathStr = typeof p === "number" ? (fdMap.get(p) ?? "") : String(p);
        mockFiles.set(
          pathStr,
          typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf-8"),
        );
      },
    );
    spies.push(writeSpy);

    const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation((p: fs.PathLike) => {
      mockDirs.add(String(p));
      return undefined as unknown as string;
    });
    spies.push(mkdirSpy);

    const unlinkSpy = spyOn(fs, "unlinkSync").mockImplementation((p: fs.PathLike) => {
      mockFiles.delete(String(p));
    });
    spies.push(unlinkSpy);
  });

  afterEach(() => {
    while (spies.length > 0) {
      spies.pop()?.mockRestore();
    }
  });

  it("returns zero counts when empty proposals/incidents provided", () => {
    const result = injectRemediationToFeedbackQueue([]);
    expect(result.injectedCount).toBe(0);
    expect(result.injected_count).toBe(0);
    expect(result.itemIds).toEqual([]);
    expect(result.injected_items).toEqual([]);
  });

  it("injects synthesized proposals into feedback queue and skips duplicate titles", () => {
    const incident: ForensicsIncident = {
      id: "inc-co-test",
      category: "CONTEXT_OVERFLOW",
      severity: "HIGH",
      title: "Test Context Overflow",
      description: "Agent token budget exceeded",
      observation: "Agent token budget exceeded",
      remediation: "Apply chunking",
      recommendation: "Apply chunking",
      agentId: "agent-1",
    };

    const injectionOptions: FeedbackInjectionOptions = {
      queue_path: queuePath,
    };

    // 1. First injection: should inject 1 proposal
    const res1 = injectRemediationToFeedbackQueue([incident], injectionOptions);
    expect(res1.injectedCount).toBe(1);
    expect(res1.itemIds).toHaveLength(1);
    expect(fs.existsSync(queuePath)).toBe(true);

    const itemsInQueue = readFeedbackQueue(queuePath);
    expect(itemsInQueue).toHaveLength(1);
    expect(itemsInQueue[0]?.title).toContain("Stream Chunking");
    expect(itemsInQueue[0]?.status).toBe("PENDING");
    expect(itemsInQueue[0]?.category).toBe("CORE_ENGINE");

    // 2. Second injection with same incident: should detect duplicate title and skip
    const res2 = injectRemediationToFeedbackQueue([incident], injectionOptions);
    expect(res2.injectedCount).toBe(0);
    expect(res2.itemIds).toHaveLength(0);

    const itemsAfterSecond = readFeedbackQueue(queuePath);
    expect(itemsAfterSecond).toHaveLength(1);
  });

  it("supports passing string run root or customRoot options", () => {
    const incident: ForensicsIncident = {
      id: "inc-tb-test",
      category: "TOKEN_BURNING",
      severity: "HIGH",
      title: "Token Burn Test",
      description: "Test",
      observation: "Test",
      remediation: "Test",
      recommendation: "Test",
    };

    const result = injectRemediationToFeedbackQueue([incident], scratchDir);
    expect(result.injectedCount).toBe(1);
    expect(result.queue_path).toBeDefined();
  });

  it("does not fallback-count a remediation injection when persistence fails", () => {
    const queuePathFail = join(scratchDir, "FEEDBACK_QUEUE_FAIL.jsonl");
    const incident: ForensicsIncident = {
      id: "inc-persist-failure",
      category: "TOKEN_BURNING",
      severity: "HIGH",
      title: "Persistence Failure",
      description: "Test",
      observation: "Test",
      remediation: "Test",
      recommendation: "Test",
    };
    __setFeedbackQueuePersistenceTestHook((stage) => {
      if (stage === "before_rename") throw new Error("forced persistence failure");
    });
    try {
      expect(() =>
        injectRemediationToFeedbackQueue([incident], { queue_path: queuePathFail }),
      ).toThrow("forced persistence failure");
      expect(fs.existsSync(queuePathFail)).toBe(false);
    } finally {
      __setFeedbackQueuePersistenceTestHook(undefined);
    }
  });

  it("keeps one record when synchronized meta-audit injections share a title", () => {
    const queuePathDedupe = join(scratchDir, "FEEDBACK_QUEUE_DEDUPE.jsonl");
    const proposal = {
      id: "prop-shared",
      title: "Shared dedupe title",
      content: "content",
      priority: "NORMAL" as const,
      category: "GENERAL" as const,
      rootCause: "TOKEN_BURNING" as const,
      remediationDirective: "directive",
    };

    const first = injectRemediationToFeedbackQueue([proposal], { queue_path: queuePathDedupe });
    const second = injectRemediationToFeedbackQueue([proposal], { queue_path: queuePathDedupe });

    expect(first.injectedCount).toBe(1);
    expect(second.injectedCount).toBe(0);
    expect(readFeedbackQueue(queuePathDedupe)).toHaveLength(1);
  });
});
