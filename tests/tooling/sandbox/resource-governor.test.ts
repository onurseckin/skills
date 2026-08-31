import { describe, expect, it } from "bun:test";
import {
  ResourceGovernor,
  type SystemMetricsProvider,
} from "../../../../olt/scripts/src/tooling/sandbox/resource-governor.ts";
import type {
  QuotaViolation,
  ResourceQuota,
} from "../../../../olt/scripts/src/tooling/sandbox/types.ts";

class MockSystemMetricsProvider implements SystemMetricsProvider {
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

describe("ResourceGovernor Unit Test Suite", () => {
  it("samples default system metrics cleanly", () => {
    const governor = new ResourceGovernor({
      quota: { maxMemoryRssBytes: 1024 * 1024 * 1024, cpuSampleIntervalMs: 50 },
    });

    governor.start();
    const snapshot = governor.sample();
    expect(snapshot.memoryRssBytes).toBeGreaterThan(0);
    expect(snapshot.memoryHeapBytes).toBeGreaterThan(0);
    expect(snapshot.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(snapshot.elapsedMs).toBeGreaterThanOrEqual(0);

    const report = governor.stop();
    expect(report.sampleCount).toBeGreaterThanOrEqual(1);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    governor.dispose();
  });

  it("triggers warning violation when memory warning threshold is reached", () => {
    const mock = new MockSystemMetricsProvider();
    const recordedViolations: QuotaViolation[] = [];

    const quota: ResourceQuota = {
      memoryWarningBytes: 40 * 1024 * 1024,
      maxMemoryRssBytes: 100 * 1024 * 1024,
    };

    const governor = new ResourceGovernor({
      quota,
      metricsProvider: mock,
      onViolation: (v) => recordedViolations.push(v),
    });

    governor.start();
    expect(recordedViolations).toHaveLength(1);
    expect(recordedViolations[0]?.type).toBe("memory_rss");
    expect(recordedViolations[0]?.severity).toBe("warning");
    expect(governor.hasFatalViolation()).toBe(false);

    governor.dispose();
  });

  it("triggers fatal violation when memory max limit is breached", () => {
    const mock = new MockSystemMetricsProvider();
    mock.memory.rss = 200 * 1024 * 1024;
    let fatalTriggered = false;

    const quota: ResourceQuota = {
      maxMemoryRssBytes: 100 * 1024 * 1024,
    };

    const governor = new ResourceGovernor({
      quota,
      metricsProvider: mock,
      onFatalViolation: () => {
        fatalTriggered = true;
      },
    });

    governor.start();
    expect(fatalTriggered).toBe(true);
    expect(governor.hasFatalViolation()).toBe(true);
    const report = governor.stop();
    expect(report.violations.some((v) => v.severity === "fatal" && v.type === "memory_rss")).toBe(
      true,
    );
    governor.dispose();
  });

  it("triggers heap memory fatal violation", () => {
    const mock = new MockSystemMetricsProvider();
    mock.memory.heapUsed = 80 * 1024 * 1024;

    const quota: ResourceQuota = {
      maxHeapBytes: 50 * 1024 * 1024,
    };

    const governor = new ResourceGovernor({
      quota,
      metricsProvider: mock,
    });

    governor.start();
    expect(governor.hasFatalViolation()).toBe(true);
    expect(governor.getViolations()[0]?.type).toBe("memory_heap");
    governor.dispose();
  });

  it("distinguishes between CPU spike and sustained CPU violation", () => {
    const mock = new MockSystemMetricsProvider();
    mock.cpuUsageValue = { user: 10000000, system: 5000000 };

    const quota: ResourceQuota = {
      maxCpuPercent: 10,
      maxCpuViolationCount: 3,
      cpuSampleIntervalMs: 30,
    };

    const violations: QuotaViolation[] = [];
    const governor = new ResourceGovernor({
      quota,
      metricsProvider: mock,
      onViolation: (v) => violations.push(v),
    });

    governor.start();
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0]?.type).toBe("cpu_spike");
    expect(violations[0]?.severity).toBe("warning");

    governor.sample();
    governor.sample();
    expect(governor.hasFatalViolation()).toBe(true);
    expect(violations.some((v) => v.type === "cpu_sustained" && v.severity === "fatal")).toBe(true);

    governor.dispose();
  });

  it("prevents double start and handles lifecycle safely", () => {
    const governor = new ResourceGovernor({ quota: {} });
    governor.start();
    expect(() => governor.start()).toThrow("ResourceGovernor is already running");
    governor.stop();
    expect(() => governor.start()).not.toThrow();
    governor.dispose();
  });
});
