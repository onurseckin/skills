import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  coverageCheckCommand,
  loadBunfigCoverageThreshold,
  parseCoverageTable,
} from "../../olt/scripts/src/cli/commands/coverage-check.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";

describe("coverage-check CLI command", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `coverage-check-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("parseCoverageTable", () => {
    test("parses standard bun test coverage table lines", () => {
      const output = `
------------------------------------------------------------------------------------------|---------|---------|-------------------
File                                                                                     | % Funcs | % Lines | Uncovered Line #s 
------------------------------------------------------------------------------------------|---------|---------|-------------------
 src/cli/commands/foo.ts                                                                  |   95.00 |   90.00 | 10-15
 src/core/bar.ts                                                                          |  100.00 |  100.00 | 
------------------------------------------------------------------------------------------|---------|---------|-------------------
All files                                                                                |   97.50 |   95.00 |
`;
      const records = parseCoverageTable(output);
      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({
        file: "src/cli/commands/foo.ts",
        lines: 0.95,
        functions: 0.95,
        statements: 0.9,
      });
      expect(records[1]).toEqual({
        file: "src/core/bar.ts",
        lines: 1.0,
        functions: 1.0,
        statements: 1.0,
      });
    });

    test("returns empty array for output without coverage table", () => {
      const output = "Random log output\nAll tests passed\n";
      const records = parseCoverageTable(output);
      expect(records).toEqual([]);
    });
  });

  describe("loadBunfigCoverageThreshold", () => {
    test("returns undefined if bunfig.toml does not exist", () => {
      const threshold = loadBunfigCoverageThreshold(testDir);
      expect(threshold).toBeUndefined();
    });

    test("returns fractional threshold when bunfig.toml has decimal <= 1", () => {
      fs.writeFileSync(join(testDir, "bunfig.toml"), "coverageThreshold = 0.85\n", "utf-8");
      const threshold = loadBunfigCoverageThreshold(testDir);
      expect(threshold).toBe(0.85);
    });

    test("returns scaled threshold when bunfig.toml has percentage > 1", () => {
      fs.writeFileSync(join(testDir, "bunfig.toml"), "coverageThreshold = 95\n", "utf-8");
      const threshold = loadBunfigCoverageThreshold(testDir);
      expect(threshold).toBe(0.95);
    });

    test("returns undefined if threshold is not a valid number", () => {
      fs.writeFileSync(join(testDir, "bunfig.toml"), 'coverageThreshold = "invalid"\n', "utf-8");
      const threshold = loadBunfigCoverageThreshold(testDir);
      expect(threshold).toBeUndefined();
    });

    test("returns undefined if readFileSync throws", () => {
      fs.writeFileSync(join(testDir, "bunfig.toml"), "coverageThreshold = 0.8\n", "utf-8");
      const spy = spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("read error");
      });
      const threshold = loadBunfigCoverageThreshold(testDir);
      expect(threshold).toBeUndefined();
      spy.mockRestore();
    });
  });

  describe("coverageCheckCommand", () => {
    test("throws HarnessError if target directory does not exist", async () => {
      const nonExistent = join(testDir, "does-not-exist");
      await expect(
        coverageCheckCommand({
          dir: nonExistent,
        }),
      ).rejects.toThrow(HarnessError);
    });

    test("runs coverage check and throws HarnessError when coverage is below threshold", async () => {
      const spawnSpy = spyOn(childProcess, "spawnSync").mockReturnValue({
        stdout: `
 src/cli/commands/low.ts | 50.00 | 40.00 | 1-20
`,
        stderr: "",
        status: 0,
        pid: 1234,
        output: [],
        signal: null,
      });

      await expect(
        coverageCheckCommand({
          dir: testDir,
          threshold: "80", // scaled to 0.8
        }),
      ).rejects.toThrow(HarnessError);

      spawnSpy.mockRestore();
    });

    test("runs coverage check and succeeds when coverage meets or exceeds threshold", async () => {
      const spawnSpy = spyOn(childProcess, "spawnSync").mockReturnValue({
        stdout: `
 src/cli/commands/good.ts | 95.00 | 95.00 | 1-2
`,
        stderr: "",
        status: 0,
        pid: 1234,
        output: [],
        signal: null,
      });

      const result = await coverageCheckCommand({
        dir: testDir,
        threshold: "0.9",
      });

      expect(result.passed).toBe(true);
      expect(result.threshold).toBe(0.9);
      expect(result.total_files).toBe(1);
      expect(result.failing_count).toBe(0);
      expect(String(result.markdown)).toContain("### Coverage Check Certification");
      expect(String(result.markdown)).toContain("✅ PASSED");

      spawnSpy.mockRestore();
    });

    test("uses default threshold 0.0 when no threshold and no bunfig present", async () => {
      const spawnSpy = spyOn(childProcess, "spawnSync").mockReturnValue({
        stdout: `
 src/cli/commands/good.ts | 10.00 | 10.00 | 1-2
`,
        stderr: "",
        status: 0,
        pid: 1234,
        output: [],
        signal: null,
      });

      const result = await coverageCheckCommand({
        dir: testDir,
      });

      expect(result.passed).toBe(true);
      expect(result.threshold).toBe(0.0);
      expect(result.failing_count).toBe(0);

      spawnSpy.mockRestore();
    });
  });
});
