import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { main, processCoverageArtifacts } from "../../../scripts/testing/reporting/index.ts";

const TEST_SCRATCH_DIR = "/virtual/coverage-scratch/coverage-artifacts-unit";

let vfs: VirtualMemoryFS;
let session: VirtualFSSession | undefined;

describe("Coverage Reporting Artifacts Orchestration", () => {
  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(TEST_SCRATCH_DIR, { recursive: true });
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = undefined;
    }
  });

  test("returns lcovExists: false when lcov.info is missing", () => {
    const res = processCoverageArtifacts(TEST_SCRATCH_DIR, "non-existent-dir");
    expect(res.lcovExists).toBe(false);
    expect(res.filesCount).toBe(0);
    expect(res.totalPct).toBe(0);
  });

  test("orchestrates artifacts on disk when lcov.info is present", () => {
    const covDir = join(TEST_SCRATCH_DIR, "coverage");
    vfs.mkdirSync(covDir, { recursive: true });
    vfs.writeFileSync(
      join(covDir, "lcov.info"),
      "SF:src/bar.ts\nLF:10\nLH:10\nend_of_record",
      "utf-8",
    );

    const res = processCoverageArtifacts(TEST_SCRATCH_DIR, "coverage");
    expect(res.lcovExists).toBe(true);
    expect(res.filesCount).toBe(1);
    expect(res.totalPct).toBe(100);
    expect(existsSync(join(covDir, "coverage-summary.json"))).toBe(true);
    expect(existsSync(join(covDir, "REPORT.md"))).toBe(true);
    expect(existsSync(join(covDir, "index.html"))).toBe(true);
  });

  test("supports pure zero-disk processing via lcovContent and writeToDisk:false", () => {
    const lcovContent = "SF:src/zero-disk.ts\nLF:20\nLH:20\nend_of_record";
    const res = processCoverageArtifacts(TEST_SCRATCH_DIR, "coverage-zero", {
      lcovContent,
      writeToDisk: false,
    });

    expect(res.lcovExists).toBe(true);
    expect(res.filesCount).toBe(1);
    expect(res.totalPct).toBe(100);
    expect(res.summary).toBeDefined();
    expect(res.summaryPath).toBeUndefined();
    expect(existsSync(join(TEST_SCRATCH_DIR, "coverage-zero"))).toBe(false);
  });

  test("recreates coverage directory if removed before artifact writing", () => {
    const covDir = join(TEST_SCRATCH_DIR, "coverage-recreate");
    vfs.mkdirSync(covDir, { recursive: true });
    const lcovPath = join(covDir, "lcov.info");
    vfs.writeFileSync(lcovPath, "SF:src/test.ts\nLF:10\nLH:10\nend_of_record", "utf-8");

    let checkCount = 0;
    const origVfsExists = vfs.existsSync.bind(vfs);
    const spy = spyOn(vfs, "existsSync").mockImplementation((p: string) => {
      if (p === lcovPath) return true;
      if (p === covDir) {
        checkCount++;
        if (checkCount === 1) return false;
      }
      return origVfsExists(p);
    });

    try {
      const res = processCoverageArtifacts(TEST_SCRATCH_DIR, "coverage-recreate");
      expect(res.lcovExists).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test("executes CLI script and main() logs status appropriately", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));

    try {
      main(TEST_SCRATCH_DIR);
      expect(logs.some((l) => l.includes("No coverage/lcov.info found"))).toBe(true);

      logs.length = 0;
      const covDir = join(TEST_SCRATCH_DIR, "coverage");
      vfs.mkdirSync(covDir, { recursive: true });
      vfs.writeFileSync(
        join(covDir, "lcov.info"),
        "SF:src/cli.ts\nLF:5\nLH:5\nend_of_record",
        "utf-8",
      );
      main(TEST_SCRATCH_DIR);
      expect(logs.some((l) => l.includes("Generated coverage/lcov.info"))).toBe(true);
    } finally {
      console.log = origLog;
    }
  });

  test("generates LLMS.txt guide and deficits.json artifacts correctly", () => {
    const covDir = join(TEST_SCRATCH_DIR, "cov-llms");
    vfs.mkdirSync(covDir, { recursive: true });
    vfs.writeFileSync(
      join(covDir, "lcov.info"),
      "SF:src/a.ts\nLF:10\nLH:8\nDA:1,0\nend_of_record",
      "utf-8",
    );

    const res = processCoverageArtifacts(TEST_SCRATCH_DIR, "cov-llms");
    expect(res.llmsGuidePath).toBeDefined();
    expect(res.deficitsPath).toBeDefined();
    expect(existsSync(res.llmsGuidePath!)).toBe(true);
    expect(existsSync(res.deficitsPath!)).toBe(true);

    const llmsContent = readFileSync(res.llmsGuidePath!, "utf-8");
    expect(llmsContent).toContain("# Coverage & Test Telemetry LLM Query Guide");
    expect(llmsContent).toContain("coverage-summary.json");
    expect(llmsContent).toContain("test-telemetry.json");
    expect(llmsContent).toContain("deficits.json");

    const deficitsJson = JSON.parse(readFileSync(res.deficitsPath!, "utf-8"));
    expect(Array.isArray(deficitsJson.clusters)).toBe(true);
  });
});
