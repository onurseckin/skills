import os from "node:os";
import type {
  QuotaViolation,
  ResourceQuota,
  ResourceUsageReport,
  ResourceUsageSnapshot,
} from "./types.ts";

export interface SystemMetricsProvider {
  getMemoryUsage(): { rss: number; heapUsed: number; heapTotal: number; external: number };
  getCpuUsage(previousValue?: NodeJS.CpuUsage): NodeJS.CpuUsage;
  getCpuCount(): number;
}

export class DefaultSystemMetricsProvider implements SystemMetricsProvider {
  public getMemoryUsage(): { rss: number; heapUsed: number; heapTotal: number; external: number } {
    return process.memoryUsage();
  }

  public getCpuUsage(previousValue?: NodeJS.CpuUsage): NodeJS.CpuUsage {
    return process.cpuUsage(previousValue);
  }

  public getCpuCount(): number {
    return os.cpus().length || 1;
  }
}

export interface ResourceGovernorOptions {
  readonly quota: ResourceQuota;
  readonly metricsProvider?: SystemMetricsProvider | undefined;
  readonly onViolation?: ((violation: QuotaViolation) => void) | undefined;
  readonly onFatalViolation?: ((violation: QuotaViolation) => void) | undefined;
}

export class ResourceGovernor {
  private readonly quota: ResourceQuota;
  private readonly metricsProvider: SystemMetricsProvider;
  private readonly onViolationCallback?: ((violation: QuotaViolation) => void) | undefined;
  private readonly onFatalViolationCallback?: ((violation: QuotaViolation) => void) | undefined;

  private timerId: ReturnType<typeof setInterval> | null = null;
  private startTime: number = 0;
  private previousCpuUsage: NodeJS.CpuUsage | null = null;
  private lastSampleTime: number = 0;
  private cpuViolationStreak: number = 0;
  private isRunning: boolean = false;

  private readonly snapshots: ResourceUsageSnapshot[] = [];
  private readonly violations: QuotaViolation[] = [];

  constructor(options: ResourceGovernorOptions) {
    this.quota = options.quota;
    this.metricsProvider = options.metricsProvider ?? new DefaultSystemMetricsProvider();
    this.onViolationCallback = options.onViolation;
    this.onFatalViolationCallback = options.onFatalViolation;
  }

  public start(): void {
    if (this.isRunning) {
      throw new Error("ResourceGovernor is already running");
    }
    this.reset();
    this.isRunning = true;
    this.startTime = performance.now();
    this.lastSampleTime = this.startTime;
    this.previousCpuUsage = this.metricsProvider.getCpuUsage();

    this.sample();

    const intervalMs = Math.max(20, this.quota.cpuSampleIntervalMs ?? 100);
    this.timerId = setInterval(() => {
      this.sample();
    }, intervalMs);
  }

  public sample(): ResourceUsageSnapshot {
    const now = performance.now();
    const elapsedMs = this.startTime > 0 ? now - this.startTime : 0;
    const sampleDeltaMs = Math.max(1, now - this.lastSampleTime);
    this.lastSampleTime = now;

    const mem = this.metricsProvider.getMemoryUsage();
    const currentCpu = this.metricsProvider.getCpuUsage(this.previousCpuUsage ?? undefined);
    this.previousCpuUsage = this.metricsProvider.getCpuUsage();

    const cpuCount = Math.max(1, this.metricsProvider.getCpuCount());
    const totalCpuMicros = currentCpu.user + currentCpu.system;
    const totalAvailableMicros = sampleDeltaMs * 1000 * cpuCount;
    const cpuPercent = Math.min(100, Math.max(0, (totalCpuMicros / totalAvailableMicros) * 100));

    const snapshot: ResourceUsageSnapshot = {
      timestamp: Date.now(),
      elapsedMs,
      memoryRssBytes: mem.rss,
      memoryHeapBytes: mem.heapUsed,
      cpuPercent: Math.round(cpuPercent * 100) / 100,
    };

    this.snapshots.push(snapshot);
    this.evaluateSnapshot(snapshot);
    return snapshot;
  }

  public stop(): ResourceUsageReport {
    if (this.isRunning) {
      this.sample();
      this.cleanupTimer();
      this.isRunning = false;
    }
    return this.getReport();
  }

  public getReport(): ResourceUsageReport {
    const durationMs = this.startTime > 0 ? performance.now() - this.startTime : 0;
    let peakRssBytes = 0;
    let peakHeapBytes = 0;
    let peakCpuPercent = 0;
    let totalCpuPercent = 0;

    for (const snap of this.snapshots) {
      if (snap.memoryRssBytes > peakRssBytes) peakRssBytes = snap.memoryRssBytes;
      if (snap.memoryHeapBytes > peakHeapBytes) peakHeapBytes = snap.memoryHeapBytes;
      if (snap.cpuPercent > peakCpuPercent) peakCpuPercent = snap.cpuPercent;
      totalCpuPercent += snap.cpuPercent;
    }

    const sampleCount = this.snapshots.length;
    const averageCpuPercent =
      sampleCount > 0 ? Math.round((totalCpuPercent / sampleCount) * 100) / 100 : 0;

    return {
      peakRssBytes,
      peakHeapBytes,
      peakCpuPercent,
      averageCpuPercent,
      sampleCount,
      durationMs,
      violations: [...this.violations],
    };
  }

  public getViolations(): readonly QuotaViolation[] {
    return [...this.violations];
  }

  public hasFatalViolation(): boolean {
    return this.violations.some((v) => v.severity === "fatal");
  }

  public dispose(): void {
    this.cleanupTimer();
    this.isRunning = false;
    this.reset();
  }

  private cleanupTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private reset(): void {
    this.snapshots.length = 0;
    this.violations.length = 0;
    this.cpuViolationStreak = 0;
    this.startTime = 0;
    this.lastSampleTime = 0;
    this.previousCpuUsage = null;
  }

  private evaluateSnapshot(snapshot: ResourceUsageSnapshot): void {
    if (this.quota.maxMemoryRssBytes && snapshot.memoryRssBytes > this.quota.maxMemoryRssBytes) {
      this.recordViolation({
        type: "memory_rss",
        severity: "fatal",
        message: `RSS memory quota exceeded: ${snapshot.memoryRssBytes} bytes > ${this.quota.maxMemoryRssBytes} bytes`,
        observedValue: snapshot.memoryRssBytes,
        thresholdValue: this.quota.maxMemoryRssBytes,
        timestamp: snapshot.timestamp,
      });
    } else if (
      this.quota.memoryWarningBytes &&
      snapshot.memoryRssBytes > this.quota.memoryWarningBytes
    ) {
      this.recordViolation({
        type: "memory_rss",
        severity: "warning",
        message: `RSS memory warning threshold exceeded: ${snapshot.memoryRssBytes} bytes > ${this.quota.memoryWarningBytes} bytes`,
        observedValue: snapshot.memoryRssBytes,
        thresholdValue: this.quota.memoryWarningBytes,
        timestamp: snapshot.timestamp,
      });
    }

    if (this.quota.maxHeapBytes && snapshot.memoryHeapBytes > this.quota.maxHeapBytes) {
      this.recordViolation({
        type: "memory_heap",
        severity: "fatal",
        message: `Heap memory quota exceeded: ${snapshot.memoryHeapBytes} bytes > ${this.quota.maxHeapBytes} bytes`,
        observedValue: snapshot.memoryHeapBytes,
        thresholdValue: this.quota.maxHeapBytes,
        timestamp: snapshot.timestamp,
      });
    }

    if (this.quota.maxCpuPercent && snapshot.cpuPercent > this.quota.maxCpuPercent) {
      this.cpuViolationStreak++;
      const maxStreak = this.quota.maxCpuViolationCount ?? 3;
      const isFatal = this.cpuViolationStreak >= maxStreak;
      this.recordViolation({
        type: isFatal ? "cpu_sustained" : "cpu_spike",
        severity: isFatal ? "fatal" : "warning",
        message: isFatal
          ? `Sustained CPU quota exceeded for ${this.cpuViolationStreak} intervals: ${snapshot.cpuPercent}% > ${this.quota.maxCpuPercent}%`
          : `CPU spike observed: ${snapshot.cpuPercent}% > ${this.quota.maxCpuPercent}%`,
        observedValue: snapshot.cpuPercent,
        thresholdValue: this.quota.maxCpuPercent,
        timestamp: snapshot.timestamp,
      });
    } else {
      this.cpuViolationStreak = 0;
    }
  }

  private recordViolation(violation: QuotaViolation): void {
    this.violations.push(violation);
    this.onViolationCallback?.(violation);
    if (violation.severity === "fatal") {
      this.onFatalViolationCallback?.(violation);
    }
  }
}
