import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  DynamicExecutionSandbox,
  IsolatedChildProcessManager,
  getGlobalExecutionSandbox,
  resetGlobalExecutionSandbox,
  spawnIsolatedProcess,
} from "../../../olt/scripts/src/tooling/index.ts";

class MockChildProcess extends EventEmitter {
  public pid = 0;
  public killed = false;
  public stdout = new EventEmitter();
  public stderr = new EventEmitter();
  public stdin = {
    buffer: "",
    write: (chunk: string | Buffer) => {
      this.stdin.buffer += chunk.toString();
      return true;
    },
    end: () => {
      if (this.command === "cat")
        queueMicrotask(() => {
          this.stdout.emit("data", Buffer.from(this.stdin.buffer));
          this.emit("close", 0, null);
        });
    },
    destroy: () => {},
  };

  constructor(
    public command: string,
    public args: string[],
  ) {
    super();
    queueMicrotask(() => {
      if (this.killed) return;
      if (command === "non-existent-binary-12345") this.emit("error", new Error("spawn ENOENT"));
      else if (command === "echo") {
        const text = args.join(" ");
        this.stdout.emit("data", Buffer.from(text ? `${text}\n` : "\n"));
        this.emit("close", 0, null);
      }
    });
  }

  public kill(signal?: NodeJS.Signals | string) {
    this.killed = true;
    queueMicrotask(() => this.emit("close", null, signal ?? "SIGTERM"));
    return true;
  }
}

describe("Dynamic Tool Sandboxing & Execution Isolation Suite", () => {
  let vfsSession: VirtualFSSession;
  let spawnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    vfsSession = createVirtualFSSession(new VirtualMemoryFS());
    resetGlobalExecutionSandbox();
    spawnSpy = spyOn(childProcess, "spawn").mockImplementation(
      ((cmd: string, args: readonly string[]) =>
        new MockChildProcess(String(cmd), [
          ...(args ?? []),
        ]) as unknown as childProcess.ChildProcess) as unknown as typeof childProcess.spawn,
    );
  });

  afterEach(() => {
    resetGlobalExecutionSandbox();
    spawnSpy.mockRestore();
    vfsSession.cleanup();
  });

  describe("Isolated Child Process Management", () => {
    it("executes standard command and captures stdout", async () => {
      const result = await spawnIsolatedProcess("echo", ["hello-sandbox"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello-sandbox");
      expect(result.timedOut).toBe(false);
      expect(result.killed).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("pipes stdin into subprocess", async () => {
      const result = await spawnIsolatedProcess("cat", [], { stdin: "streamed-input" });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("streamed-input");
    });

    it("terminates long-running process when timeout or abort signal is reached", async () => {
      const manager = new IsolatedChildProcessManager();
      const resTimeout = await manager.runIsolated("sleep", ["5"], { timeoutMs: 5 });
      expect(resTimeout.timedOut).toBe(true);
      expect(resTimeout.killed).toBe(true);

      const controller = new AbortController();
      const promise = manager.runIsolated("sleep", ["5"], { abortSignal: controller.signal });
      setTimeout(() => controller.abort(), 2);
      const resAbort = await promise;
      expect(resAbort.killed).toBe(true);
    });

    it("truncates output when maxBufferBytes is exceeded", async () => {
      const result = await spawnIsolatedProcess("echo", ["12345678901234567890"], {
        maxBufferBytes: 5,
      });
      expect(result.stdout).toContain("[STDOUT TRUNCATED: MAX BUFFER EXCEEDED]");
    });

    it("handles pre-aborted signal, non-existent binaries, and killAll lifecycle", async () => {
      const manager = new IsolatedChildProcessManager();
      const res1 = await manager.runIsolated("echo", ["hi"], { abortSignal: AbortSignal.abort() });
      expect(res1.killed).toBe(true);

      const nonExistent = await manager.runIsolated("non-existent-binary-12345");
      expect(nonExistent.exitCode).toBe(1);
      expect(manager.getActiveCount()).toBe(0);
      manager.killAll();
    });
  });

  describe("Dynamic Execution Sandbox Engine", () => {
    it("executes in-memory async functions within boundary constraints", async () => {
      const sandbox = new DynamicExecutionSandbox();
      const res = await sandbox.executeFunction(async () => 42 * 2);
      expect(res.success).toBe(true);
      expect(res.result).toBe(84);
      expect(res.timedOut).toBe(false);
      expect(res.violations).toEqual([]);
    });

    it("enforces timeout on hanging in-memory functions", async () => {
      const sandbox = new DynamicExecutionSandbox();
      const res = await sandbox.executeFunction(() => new Promise((r) => setTimeout(r, 100)), {
        timeoutMs: 5,
      });
      expect(res.success).toBe(false);
      expect(res.timedOut).toBe(true);
      expect(res.error).toContain("timed out");
    });

    it("catches function errors and returns structured failure", async () => {
      const sandbox = new DynamicExecutionSandbox();
      const res = await sandbox.executeFunction(() => {
        throw new Error("Internal tool failure");
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe("Internal tool failure");
    });

    it("blocks execution when working directory violates boundary policy", async () => {
      const sandbox = new DynamicExecutionSandbox();
      const res = await sandbox.executeFunction(async () => "ok", {
        workingDir: "/etc",
        isolationLevel: "strict",
      });
      expect(res.success).toBe(false);
      expect(res.violations.length).toBe(1);
      expect(res.violations[0]?.rule).toBe("PATH_BOUNDARY_VIOLATION");
    });

    it("executes subprocess command through sandbox with safety checks and manages singleton", async () => {
      const sandbox = new DynamicExecutionSandbox();
      const res = await sandbox.executeCommand("echo", ["sandboxed-run"], {
        isolationLevel: "restricted",
      });
      expect(res.exitCode).toBe(0);
      expect(res.stdout.trim()).toBe("sandboxed-run");

      const blockedRes = await sandbox.executeCommand("sudo", ["whoami"], {
        isolationLevel: "restricted",
      });
      expect(blockedRes.exitCode).toBe(126);
      expect(sandbox.getViolations().length).toBe(1);

      const s1 = getGlobalExecutionSandbox();
      expect(s1).toBe(getGlobalExecutionSandbox());
      resetGlobalExecutionSandbox();
      expect(getGlobalExecutionSandbox()).not.toBe(s1);
    });
  });
});
