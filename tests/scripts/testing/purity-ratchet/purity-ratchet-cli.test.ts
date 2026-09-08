import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import type { PurityViolation } from "../../../../scripts/testing/guardrails/index.ts";
import {
  main,
  parseFlags,
  runCli,
} from "../../../../scripts/testing/purity-ratchet/purity-ratchet-cli.ts";
import type { PurityAuditSnapshot } from "../../../../scripts/testing/purity-ratchet/index.ts";
import {
  DEFAULT_PURITY_BASELINE,
  parseBaseline,
  serializeBaseline,
} from "../../../../scripts/testing/purity-ratchet/index.ts";

function violation(file: string, rule: string): PurityViolation {
  return { file, line: 1, column: 1, category: "filesystem", rule, message: `synthetic ${rule}` };
}

function snapshotOf(violations: readonly PurityViolation[]): PurityAuditSnapshot {
  return { scannedFiles: 12, violations };
}

const BASELINED = [
  violation("tests/alpha.test.ts", "no-physical-fs-call"),
  violation("tests/alpha.test.ts", "no-physical-fs-call"),
  violation("tests/beta.test.ts", "no-unmocked-subprocess-call"),
];

describe("purity ratchet CLI flag parsing", () => {
  test("defaults to a ratchet run rendered as markdown", () => {
    expect(parseFlags([])).toEqual({ mode: "ratchet", format: "markdown" });
  });

  test("parses every supported flag", () => {
    expect(parseFlags(["--mode", "strict"])).toEqual({ mode: "strict", format: "markdown" });
    expect(parseFlags(["--format", "json"])).toEqual({ mode: "ratchet", format: "json" });
    expect(parseFlags(["--format", "jsonl"])).toEqual({ mode: "ratchet", format: "jsonl" });
    expect(parseFlags(["--baseline", "custom/base.jsonl"])).toEqual({
      mode: "ratchet",
      format: "markdown",
      baselinePath: "custom/base.jsonl",
    });
  });

  test("rejects unknown flags and invalid values", () => {
    expect(() => parseFlags(["--unknown"])).toThrow("Invalid purity ratchet flag: --unknown");
    expect(() => parseFlags(["--mode", "lenient"])).toThrow("Invalid purity ratchet flag: --mode");
    expect(() => parseFlags(["--format", "xml"])).toThrow("Invalid purity ratchet flag: --format");
    expect(() => parseFlags(["--baseline"])).toThrow("Invalid purity ratchet flag: --baseline");
  });

  test("points at a committed baseline document by default", () => {
    expect(DEFAULT_PURITY_BASELINE).toBe("scripts/testing/purity-ratchet/baseline/index.jsonl");
  });
});

describe("purity ratchet CLI runs (in-memory virtual)", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;
  let stdout = "";
  let stderr = "";
  let restoreStdout: (() => void) | null = null;
  const root = "/virtual/purity-ratchet-cli";

  function captureStreams(): void {
    const originalStdout = process.stdout.write;
    const originalStderr = process.stderr.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString();
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += chunk.toString();
      return true;
    }) as typeof process.stderr.write;
    restoreStdout = () => {
      process.stdout.write = originalStdout;
      process.stderr.write = originalStderr;
    };
  }

  beforeEach(() => {
    stdout = "";
    stderr = "";
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync(root, { recursive: true });
    vfs.writeFileSync(
      join(root, "baseline.jsonl"),
      serializeBaseline([
        { file: "tests/alpha.test.ts", rule: "no-physical-fs-call", count: 2 },
        { file: "tests/beta.test.ts", rule: "no-unmocked-subprocess-call", count: 1 },
      ]),
    );
    captureStreams();
  });

  afterEach(() => {
    if (restoreStdout) {
      restoreStdout();
      restoreStdout = null;
    }
    process.exitCode = 0;
    if (session) {
      session.cleanup();
      session = null;
    }
  });

  const RATCHET_ARGS = ["--mode", "ratchet", "--baseline", "baseline.jsonl"];

  test("passes while the baselined backlog is unchanged and still non-zero", async () => {
    const code = await main(RATCHET_ARGS, root, { audit: () => snapshotOf(BASELINED) });

    expect(code).toBe(0);
    expect(stdout).toContain("Status: passed");
    expect(stdout).toContain("Violations: 3");
    expect(stdout).toContain("Files with violations: 2");
  });

  test("blocks a newly introduced violation and names the file and the rule", async () => {
    const code = await main(RATCHET_ARGS, root, {
      audit: () =>
        snapshotOf([...BASELINED, violation("tests/fresh.test.ts", "no-physical-fs-import")]),
    });

    expect(code).toBe(1);
    expect(stdout).toContain("Status: failed");
    expect(stdout).toContain("Added violations (blocking)");
    expect(stdout).toContain("tests/fresh.test.ts");
    expect(stdout).toContain("no-physical-fs-import");
  });

  test("blocks a worsened count inside an already baselined file", async () => {
    const code = await main(RATCHET_ARGS, root, {
      audit: () =>
        snapshotOf([...BASELINED, violation("tests/alpha.test.ts", "no-physical-fs-call")]),
    });

    expect(code).toBe(1);
    expect(stdout).toContain("Worsened violations (blocking)");
    expect(stdout).toContain("2 baselined, 3 observed");
  });

  test("never blocks when a baselined violation is removed", async () => {
    const code = await main(RATCHET_ARGS, root, {
      audit: () => snapshotOf([violation("tests/beta.test.ts", "no-unmocked-subprocess-call")]),
    });

    expect(code).toBe(0);
    expect(stdout).toContain("Status: passed");
    expect(stdout).toContain("Resolved: 1");
  });

  test("never blocks when the entire backlog is removed at once", async () => {
    const code = await main(RATCHET_ARGS, root, { audit: () => snapshotOf([]) });

    expect(code).toBe(0);
    expect(stdout).toContain("Resolved: 2");
  });

  test("renders a machine readable report and a regenerable baseline document", async () => {
    const jsonCode = await main([...RATCHET_ARGS, "--format", "json"], root, {
      audit: () => snapshotOf(BASELINED),
    });
    expect(jsonCode).toBe(0);
    expect(stdout).toContain("olt-purity-ratchet-report/v1");

    stdout = "";
    const jsonlCode = await main([...RATCHET_ARGS, "--format", "jsonl"], root, {
      audit: () => snapshotOf(BASELINED),
    });
    expect(jsonlCode).toBe(0);
    expect(stdout.split("\n")[0]).toBe('{"schema":"olt-purity-baseline/v1"}');
    expect(stdout).toContain(
      '{"file":"tests/alpha.test.ts","rule":"no-physical-fs-call","count":2}',
    );
  });

  test("preserves human reason attributes byte-for-byte across baseline regeneration", async () => {
    const reason1 = "sandbox containment: live fs required by design";
    const reason2 = "subprocess auditor: unmocked binary execution";
    const reason3 = "tmpdir probe: physical isolation testing";
    const resolvedReason = "historical violation now fixed";

    vfs.writeFileSync(
      join(root, "reasoned-baseline.jsonl"),
      serializeBaseline([
        { file: "tests/alpha.test.ts", rule: "no-physical-fs-call", count: 2, reason: reason1 },
        {
          file: "tests/beta.test.ts",
          rule: "no-unmocked-subprocess-call",
          count: 1,
          reason: reason2,
        },
        {
          file: "tests/gamma.test.ts",
          rule: "no-physical-tmpdir-import",
          count: 1,
          reason: reason3,
        },
        {
          file: "tests/resolved.test.ts",
          rule: "no-physical-fs-call",
          count: 1,
          reason: resolvedReason,
        },
        { file: "tests/unreasoned.test.ts", rule: "no-physical-fs-call", count: 1 },
      ]),
    );

    const activeViolations = [
      violation("tests/alpha.test.ts", "no-physical-fs-call"),
      violation("tests/alpha.test.ts", "no-physical-fs-call"),
      violation("tests/beta.test.ts", "no-unmocked-subprocess-call"),
      violation("tests/gamma.test.ts", "no-physical-tmpdir-import"),
      violation("tests/unreasoned.test.ts", "no-physical-fs-call"),
    ];

    stdout = "";
    const code = await main(
      ["--mode", "ratchet", "--baseline", "reasoned-baseline.jsonl", "--format", "jsonl"],
      root,
      { audit: () => snapshotOf(activeViolations) },
    );

    expect(code).toBe(0);
    const regenerated = parseBaseline(stdout);
    const reasonedEntries = regenerated.entries.filter((entry) => entry.reason !== undefined);
    expect(reasonedEntries).toHaveLength(3);
    expect(regenerated.entries.find((e) => e.file === "tests/alpha.test.ts")?.reason).toBe(reason1);
    expect(regenerated.entries.find((e) => e.file === "tests/beta.test.ts")?.reason).toBe(reason2);
    expect(regenerated.entries.find((e) => e.file === "tests/gamma.test.ts")?.reason).toBe(reason3);
    expect(
      regenerated.entries.find((e) => e.file === "tests/unreasoned.test.ts")?.reason,
    ).toBeUndefined();
    expect(regenerated.entries.find((e) => e.file === "tests/resolved.test.ts")).toBeUndefined();
  });

  test("fails a strict run while the backlog is non-empty", async () => {
    const code = await main(["--mode", "strict"], root, { audit: () => snapshotOf(BASELINED) });

    expect(code).toBe(1);
    expect(stdout).toContain("Status: failed");
  });

  test("reports a missing baseline document on stderr instead of passing silently", async () => {
    const code = await main(["--mode", "ratchet", "--baseline", "absent.jsonl"], root, {
      audit: () => snapshotOf(BASELINED),
    });

    expect(code).toBe(1);
    expect(stderr).toContain("missing baseline file");
  });

  test("reports invalid flags on stderr", async () => {
    const code = await main(["--nope"], root, { audit: () => snapshotOf([]) });

    expect(code).toBe(1);
    expect(stderr).toContain("Invalid purity ratchet flag");
  });

  test("runCli delegates when it owns the entry point and no-ops otherwise", async () => {
    const skipped = await runCli(false);
    expect(skipped).toBeUndefined();

    const executed = await runCli(true, RATCHET_ARGS, root, { audit: () => snapshotOf(BASELINED) });
    expect(executed).toBe(0);
  });
});
