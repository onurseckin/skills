import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  normalizePosixPath,
  VirtualMemoryFS,
  VirtualFSError,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  createTestIsolationContext,
  isPortAvailable,
} from "../../../olt/scripts/src/testing/isolation.ts";
import {
  calculateParetoThreshold,
  computeRuntimeSummary,
} from "../../../scripts/testing/reporting/runtime-telemetry.ts";
import type { TestFileRuntime } from "../../../scripts/testing/reporting/types.ts";

describe("Virtual FS Adversarial Probes", () => {
  test("Probe 1: Path traversal escape normalization and zero disk leakage", () => {
    expect(normalizePosixPath("/../../../../etc/passwd")).toBe("/etc/passwd");
    expect(normalizePosixPath("a/b/../../../../escape.txt", "/workspace")).toBe("/escape.txt");
    expect(normalizePosixPath("/foo/./bar/../../baz/../qux")).toBe("/qux");
    expect(normalizePosixPath("..//..///..///secret.env")).toBe("/secret.env");
    expect(normalizePosixPath("C:\\Windows\\System32\\..\\..\\leak.txt")).toBe("/C:/leak.txt");

    const fs = new VirtualMemoryFS();
    const sensitiveVirtualPaths = [
      "/tmp/adversarial-probe-leak.txt",
      "/etc/adversarial-probe.conf",
      "/var/log/adversarial-leak.log",
    ] as const;

    for (const p of sensitiveVirtualPaths) {
      const parentDir = p.slice(0, p.lastIndexOf("/"));
      fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(p, "sandboxed virtual payload");
      expect(fs.existsSync(p)).toBe(true);
      expect(fs.readFileSync(p, "utf-8")).toBe("sandboxed virtual payload");
      expect(existsSync(p)).toBe(false);
    }

    expect(() => fs.readFileSync("/nonexistent/traversal/test")).toThrow(VirtualFSError);
    expect(() => fs.writeFileSync("/uncreated/parent/file.txt", "payload")).toThrow(VirtualFSError);
    expect(() => fs.unlinkSync("/nonexistent.txt")).toThrow(VirtualFSError);
    expect(() => fs.unlinkSync("/")).toThrow(VirtualFSError);
  });

  test("Probe 2: Snapshot determinism, tree isolation, and reset cleanliness", () => {
    const fs1 = new VirtualMemoryFS();
    fs1.mkdirSync("/app/src/components", { recursive: true });
    fs1.mkdirSync("/app/config", { recursive: true });
    fs1.mkdirSync("/docs", { recursive: true });

    fs1.writeFileSync("/app/src/components/button.tsx", "export const Button = () => null;");
    fs1.writeFileSync("/app/src/index.ts", "export * from './components/button';");
    fs1.writeFileSync("/app/config/settings.json", '{"theme":"dark"}');
    fs1.writeFileSync("/docs/README.md", "# Documentation");
    fs1.writeFileSync("/app/binary.dat", new Uint8Array([10, 20, 30, 40, 50]));

    const snapshot1 = fs1.dumpTree();
    expect(Object.keys(snapshot1).length).toBe(5);

    const fs2 = new VirtualMemoryFS();
    fs2.loadSnapshot(snapshot1);
    const snapshot2 = fs2.dumpTree();
    expect(snapshot2).toEqual(snapshot1);

    expect(fs2.readFileSync("/app/src/components/button.tsx", "utf-8")).toBe(
      "export const Button = () => null;",
    );
    expect(fs2.readFileSync("/app/config/settings.json", "utf-8")).toBe('{"theme":"dark"}');

    fs1.writeFileSync("/app/src/new-feature.ts", "export const Feature = true;");
    fs1.writeFileSync("/docs/README.md", "# Modified Documentation");

    expect(fs2.existsSync("/app/src/new-feature.ts")).toBe(false);
    expect(fs2.readFileSync("/docs/README.md", "utf-8")).toBe("# Documentation");

    fs1.reset();
    expect(fs1.cwd()).toBe("/");
    expect(fs1.readdirSync("/")).toEqual([]);
    expect(fs1.dumpTree()).toEqual({});
    expect(fs1.existsSync("/app")).toBe(false);

    fs1.writeFileSync("/clean.txt", "fresh start");
    expect(fs1.readFileSync("/clean.txt", "utf-8")).toBe("fresh start");
  });

  test("Probe 3: Hermetic test isolation context resource lifecycle and port cleanup", async () => {
    const ctx = createTestIsolationContext({ prefix: "adversarial-probe-lifecycle" });
    expect(ctx.id).toBeDefined();
    expect(ctx.isCleanedUp).toBe(false);

    ctx.setEnv("PROBE_ADVERSARIAL_KEY", "probe_secret_123");
    expect(process.env.PROBE_ADVERSARIAL_KEY).toBe("probe_secret_123");

    const p1 = await ctx.allocatePort();
    const p2 = await ctx.allocatePort();
    expect(p1).toBeGreaterThan(0);
    expect(p2).toBeGreaterThan(0);
    expect(p1).not.toBe(p2);
    expect(ctx.allocatedPorts).toContain(p1);
    expect(ctx.allocatedPorts).toContain(p2);

    expect(await isPortAvailable(p1)).toBe(false);
    expect(await isPortAvailable(p2)).toBe(false);

    ctx.writeTempFile("deep/path/nested.json", JSON.stringify({ isolated: true }));
    expect(ctx.tempFileExists("deep/path/nested.json")).toBe(true);
    expect(existsSync(ctx.tempDir)).toBe(false);

    await ctx.cleanup();
    expect(ctx.isCleanedUp).toBe(true);
    expect(process.env.PROBE_ADVERSARIAL_KEY).toBeUndefined();

    expect(await isPortAvailable(p1)).toBe(true);
    expect(await isPortAvailable(p2)).toBe(true);

    expect(() => ctx.setEnv("FAIL", "1")).toThrow();
    await expect(ctx.allocatePort()).rejects.toThrow();
    expect(() => ctx.readTempFile("deep/path/nested.json")).toThrow();
    expect(ctx.tempFileExists("deep/path/nested.json")).toBe(false);
  });

  test("Probe 4: Pareto skew extreme bimodal and zero-runtime distribution", () => {
    const emptyPareto = calculateParetoThreshold([], 50);
    expect(emptyPareto.fileCount).toBe(0);
    expect(emptyPareto.cumulativeDurationMs).toBe(0);
    expect(emptyPareto.files).toEqual([]);

    const zeroFiles: TestFileRuntime[] = [
      { file: "zero1.test.ts", durationMs: 0, passed: true, testCount: 1, percentage: 0 },
      { file: "zero2.test.ts", durationMs: 0, passed: true, testCount: 1, percentage: 0 },
      { file: "zero3.test.ts", durationMs: 0, passed: true, testCount: 1, percentage: 0 },
    ];
    const zeroP50 = calculateParetoThreshold(zeroFiles, 50);
    const zeroP90 = calculateParetoThreshold(zeroFiles, 90);
    expect(zeroP50.cumulativeDurationMs).toBe(0);
    expect(zeroP50.fileCount).toBe(3);
    expect(zeroP90.cumulativeDurationMs).toBe(0);
    expect(zeroP90.fileCount).toBe(3);

    const bimodalFiles: TestFileRuntime[] = [
      {
        file: "heavy-monolith.test.ts",
        durationMs: 120000,
        passed: true,
        testCount: 50,
        percentage: 0,
      },
    ];
    for (let i = 0; i < 100; i++) {
      bimodalFiles.push({
        file: `micro-test-${i}.test.ts`,
        durationMs: 1,
        passed: true,
        testCount: 1,
        percentage: 0,
      });
    }

    const summary = computeRuntimeSummary(
      bimodalFiles,
      "2026-09-06T10:00:00Z",
      "2026-09-06T10:02:00Z",
    );
    expect(summary.totalFiles).toBe(101);
    expect(summary.slowestFile?.file).toBe("heavy-monolith.test.ts");

    expect(summary.pareto50.fileCount).toBe(1);
    expect(summary.pareto50.files[0]?.file).toBe("heavy-monolith.test.ts");
    expect(summary.pareto50.cumulativeDurationMs).toBe(120000);

    expect(summary.pareto90.fileCount).toBe(1);
    expect(summary.pareto90.files[0]?.file).toBe("heavy-monolith.test.ts");

    expect(summary.pareto50.fileCount).toBeLessThanOrEqual(summary.pareto90.fileCount);
    expect(summary.pareto50.cumulativeDurationMs).toBeLessThanOrEqual(
      summary.pareto90.cumulativeDurationMs,
    );
    expect(summary.medianDurationMs).toBe(1);
  });
});
