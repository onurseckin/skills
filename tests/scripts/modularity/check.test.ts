import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import { main, parseFlags, runCli } from "../../../scripts/modularity/check.ts";
import * as inventoryModule from "../../../scripts/modularity/inventory/index.ts";
import type { IndexedBlob } from "../../../scripts/modularity/inventory/index.ts";

function blob(path: string, content: string): IndexedBlob {
  return { path, oid: "oid-test", bytes: new TextEncoder().encode(content) };
}

describe("modularity CLI parsing and runner (in-memory virtual)", () => {
  const tempDir = `${process.cwd()}/.olt/virtual-mod-check-repo`;
  let memoryBlobs: IndexedBlob[] = [];
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    memoryBlobs = [
      blob("README.md", "# Clean\n"),
      blob("package.json", JSON.stringify({ name: "clean", version: "1.0.0" })),
      blob("src/index.ts", "export const value = 1;\n"),
    ];

    spies.push(spyOn(inventoryModule, "readTreeBlobs").mockImplementation(async () => memoryBlobs));
    spies.push(
      spyOn(inventoryModule, "readIndexedBlobs").mockImplementation(async () => memoryBlobs),
    );
  });

  afterEach(() => {
    process.exitCode = 0;
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  test("parseFlags parses default arguments", () => {
    const flags = parseFlags([]);
    expect(flags).toEqual({
      mode: "ratchet",
      source: "index",
      format: "markdown",
      baselinePath: undefined,
    });
  });

  test("parseFlags parses all valid flags", () => {
    expect(parseFlags(["--mode", "strict"])).toEqual({
      mode: "strict",
      source: "index",
      format: "markdown",
      baselinePath: undefined,
    });

    expect(parseFlags(["--mode", "ratchet"])).toEqual({
      mode: "ratchet",
      source: "index",
      format: "markdown",
      baselinePath: undefined,
    });

    expect(parseFlags(["--source", "tree"])).toEqual({
      mode: "ratchet",
      source: "tree",
      format: "markdown",
      baselinePath: undefined,
    });

    expect(parseFlags(["--source", "index"])).toEqual({
      mode: "ratchet",
      source: "index",
      format: "markdown",
      baselinePath: undefined,
    });

    expect(parseFlags(["--baseline", "custom/baseline.json"])).toEqual({
      mode: "ratchet",
      source: "index",
      format: "markdown",
      baselinePath: "custom/baseline.json",
    });

    expect(parseFlags(["--format", "json"])).toEqual({
      mode: "ratchet",
      source: "index",
      format: "json",
      baselinePath: undefined,
    });

    expect(parseFlags(["--format", "markdown"])).toEqual({
      mode: "ratchet",
      source: "index",
      format: "markdown",
      baselinePath: undefined,
    });
  });

  test("parseFlags throws on invalid flags or values", () => {
    expect(() => parseFlags(["--unknown"])).toThrow("Invalid modularity flag: --unknown");
    expect(() => parseFlags(["--mode", "invalid"])).toThrow("Invalid modularity flag: --mode");
    expect(() => parseFlags(["--source", "invalid"])).toThrow("Invalid modularity flag: --source");
    expect(() => parseFlags(["--format", "invalid"])).toThrow("Invalid modularity flag: --format");
    expect(() => parseFlags(["--baseline"])).toThrow("Invalid modularity flag: --baseline");
  });

  test("main executes successfully and returns 0 on clean repository", async () => {
    const originalStdoutWrite = process.stdout.write;
    let stdoutOutput = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutOutput += chunk.toString();
      return true;
    }) as typeof process.stdout.write;

    try {
      const exitCode = await main(
        ["--mode", "strict", "--source", "index", "--format", "json"],
        tempDir,
      );
      expect(exitCode).toBe(0);
      expect(stdoutOutput).toContain("olt-modularity-report/v1");
    } finally {
      process.stdout.write = originalStdoutWrite;
    }
  });

  test("main renders markdown output format", async () => {
    const originalStdoutWrite = process.stdout.write;
    let stdoutOutput = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutOutput += chunk.toString();
      return true;
    }) as typeof process.stdout.write;

    try {
      await main(["--mode", "strict", "--source", "tree", "--format", "markdown"], tempDir);
      expect(stdoutOutput).toContain("# Modularity report");
    } finally {
      process.stdout.write = originalStdoutWrite;
    }
  });

  test("main returns exitCode 1 when report fails in strict mode", async () => {
    memoryBlobs = [blob("src/index.ts", "export const x = 1;\n".repeat(305))];
    const originalStdoutWrite = process.stdout.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;

    try {
      const exitCode = await main(
        ["--mode", "strict", "--source", "index", "--format", "json"],
        tempDir,
      );
      expect(exitCode).toBe(1);
    } finally {
      process.stdout.write = originalStdoutWrite;
    }
  });

  test("main catches errors and writes to stderr", async () => {
    const originalStderrWrite = process.stderr.write;
    let stderrOutput = "";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrOutput += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    try {
      const exitCode = await main(["--invalid-flag"]);
      expect(exitCode).toBe(1);
      expect(stderrOutput).toContain("Invalid modularity flag");
    } finally {
      process.stderr.write = originalStderrWrite;
    }
  });

  test("main executes with default args", async () => {
    const originalStdoutWrite = process.stdout.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;

    try {
      const exitCode = await main(["--mode", "strict", "--source", "tree"], tempDir);
      expect(typeof exitCode).toBe("number");
    } finally {
      process.stdout.write = originalStdoutWrite;
    }
  });

  test("runCli executes main when isMain is true and noops when false", async () => {
    const originalStdoutWrite = process.stdout.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;

    try {
      const noopResult = await runCli(false);
      expect(noopResult).toBeUndefined();

      const mainResult = await runCli(true, ["--mode", "strict", "--source", "tree"]);
      expect(typeof mainResult).toBe("number");
    } finally {
      process.stdout.write = originalStdoutWrite;
    }
  });
});
