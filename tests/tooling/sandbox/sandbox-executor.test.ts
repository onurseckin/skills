import { describe, expect, it } from "bun:test";
import { type SystemMetricsProvider } from "../../../olt/scripts/src/tooling/sandbox/resource-governor.ts";
import { SandboxedToolExecutor } from "../../../olt/scripts/src/tooling/sandbox/sandbox-executor.ts";
import type { ResourceQuota } from "../../../olt/scripts/src/tooling/sandbox/types.ts";

class MockMetricsProvider implements SystemMetricsProvider {
  public memory = {
    rss: 50 * 1024 * 1024,
    heapUsed: 20 * 1024 * 1024,
    heapTotal: 30 * 1024 * 1024,
    external: 0,
  };
  public cpuUsageValue = { user: 1000, system: 500 };
  public cpuCount = 4;

  public getMemoryUsage() {
    return { ...this.memory };
  }

  public getCpuUsage() {
    return { ...this.cpuUsageValue };
  }

  public getCpuCount(): number {
    return this.cpuCount;
  }
}

describe("SandboxedToolExecutor Unit Test Suite", () => {
  it("executes handler successfully and returns resource telemetry", async () => {
    const executor = new SandboxedToolExecutor();
    const handler = async (args: Record<string, unknown>) => {
      return `Processed ${args.input}`;
    };

    const result = await executor.execute(
      handler,
      { input: "test-data" },
      { toolName: "echo_tool" },
    );

    expect(result.success).toBe(true);
    expect(result.output).toBe("Processed test-data");
    expect(result.toolName).toBe("echo_tool");
    expect(result.terminationReason).toBe("completed");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.resourceUsage.sampleCount).toBeGreaterThanOrEqual(1);
  });

  it("terminates execution when timeout quota is exceeded", async () => {
    const executor = new SandboxedToolExecutor();
    const hangingHandler = async (
      _args: Record<string, unknown>,
      ctx?: { abortSignal?: AbortSignal },
    ) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 500);
        ctx?.abortSignal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        });
      });
      return "never";
    };

    const quota: ResourceQuota = { timeoutMs: 50, gracePeriodMs: 0 };
    const result = await executor.execute(hangingHandler, {}, { toolName: "hanging_tool", quota });

    expect(result.success).toBe(false);
    expect(result.terminationReason).toBe("timeout");
    expect(result.output).toBeNull();
  });

  it("terminates execution when memory quota limit is breached", async () => {
    const mock = new MockMetricsProvider();
    mock.memory.rss = 500 * 1024 * 1024;

    const executor = new SandboxedToolExecutor();
    const handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "done";
    };

    const quota: ResourceQuota = { maxMemoryRssBytes: 100 * 1024 * 1024, cpuSampleIntervalMs: 20 };
    const result = await executor.execute(
      handler,
      {},
      { toolName: "memory_tool", quota, governorOptions: { metricsProvider: mock } },
    );

    expect(result.success).toBe(false);
    expect(result.terminationReason).toBe("memory_exceeded");
    expect(result.resourceUsage.violations.some((v) => v.type === "memory_rss")).toBe(true);
  });

  it("terminates execution on external context abort", async () => {
    const executor = new SandboxedToolExecutor();
    const abortController = new AbortController();

    const handler = async (_args: Record<string, unknown>, ctx?: { abortSignal?: AbortSignal }) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 500);
        ctx?.abortSignal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("External abort"));
        });
      });
      return "never";
    };

    setTimeout(() => abortController.abort(new Error("User cancelled")), 20);

    const result = await executor.execute(
      handler,
      {},
      { toolName: "aborted_tool", context: { abortSignal: abortController.signal } },
    );

    expect(result.success).toBe(false);
    expect(result.terminationReason).toBe("aborted");
  });

  it("enforces max concurrent executions quota", async () => {
    const executor = new SandboxedToolExecutor();
    const slowHandler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return "ok";
    };

    const quota: ResourceQuota = { maxConcurrentRuns: 1 };

    const p1 = executor.execute(slowHandler, {}, { toolName: "single_run_tool", quota });
    const p2 = executor.execute(slowHandler, {}, { toolName: "single_run_tool", quota });

    const [r1, r2] = await Promise.all([p1, p2]);

    const hasSuccess = r1.success || r2.success;
    const hasConcurrencyExceeded =
      r1.terminationReason === "concurrency_exceeded" ||
      r2.terminationReason === "concurrency_exceeded";

    expect(hasSuccess).toBe(true);
    expect(hasConcurrencyExceeded).toBe(true);
  });

  it("captures and wraps synchronous/asynchronous errors properly", async () => {
    const executor = new SandboxedToolExecutor();
    const failingHandler = async () => {
      throw new Error("Internal tool failure");
    };

    const result = await executor.execute(failingHandler, {}, { toolName: "failing_tool" });

    expect(result.success).toBe(false);
    expect(result.terminationReason).toBe("error");
    expect(result.error).toContain("Internal tool failure");
  });
});
