import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { tempRoot, cleanupTempRoots } from "../command/fixture.ts";

afterEach(cleanupTempRoots);
import {
  configOperand,
  pathOperand,
  pathRole,
} from "../../../olt/scripts/src/engine/runner/signing/gate-path-operands.ts";

describe("configOperand", () => {
  test("identifies config flags at the target index", () => {
    expect(configOperand(["--config", "config.json"], 0)).toBe(true);
    expect(configOperand(["--config=config.json"], 0)).toBe(true);
    expect(configOperand(["-p", "tsconfig.json"], 0)).toBe(true);
    expect(configOperand(["--setup-file", "setup.ts"], 0)).toBe(true);
  });

  test("identifies config values immediately following a config flag", () => {
    expect(configOperand(["--config", "config.json"], 1)).toBe(true);
    expect(configOperand(["-p", "tsconfig.json"], 1)).toBe(true);
    expect(configOperand(["--project", "tsconfig.json"], 1)).toBe(true);
  });

  test("returns false for non-config arguments", () => {
    expect(configOperand(["echo", "hello"], 0)).toBe(false);
    expect(configOperand(["echo", "hello"], 1)).toBe(false);
    expect(configOperand([], 0)).toBe(false);
  });
});

describe("pathOperand", () => {
  test("returns undefined for empty operand or pure flag", () => {
    expect(pathOperand("", "/repo", false)).toBeUndefined();
    expect(pathOperand("-v", "/repo", false)).toBeUndefined();
    expect(pathOperand("--verbose", "/repo", false)).toBeUndefined();
    expect(pathOperand("./...", "/repo", false)).toBeUndefined();
  });

  test("throws HarnessError on absolute path or path with backslash", () => {
    expect(() => pathOperand("/etc/passwd", "/repo", false)).toThrow("gate path operand is unsafe");
    expect(() => pathOperand("src\\file.ts", "/repo", false)).toThrow(
      "gate path operand is unsafe",
    );
  });

  test("returns undefined for bare executable without slash or dot", () => {
    expect(pathOperand("node", "/repo", true)).toBeUndefined();
    expect(pathOperand("bun", "/repo", true)).toBeUndefined();
  });

  test("resolves paths starting with dot, containing slash, or matching extension", () => {
    expect(pathOperand("./src/file", "/repo", false)).toBe("./src/file");
    expect(pathOperand("src/file", "/repo", false)).toBe("src/file");
    expect(pathOperand("file.ts", "/repo", false)).toBe("file.ts");
    expect(pathOperand("main.go", "/repo", false)).toBe("main.go");
    expect(pathOperand("lib.rs", "/repo", false)).toBe("lib.rs");
    expect(pathOperand("--config=src/custom.json", "/repo", false)).toBe("src/custom.json");
  });

  test("resolves an existing extensionless file in cwd", () => {
    const root = tempRoot("path-operand-exist");
    writeFileSync(join(root, "Makefile"), "all:\\n");
    expect(pathOperand("Makefile", root, false)).toBe("Makefile");
    expect(pathOperand("nonexistent_file_no_ext", root, false)).toBeUndefined();
  });
});

describe("pathRole", () => {
  test("returns executable for executableIndices", () => {
    const execSet = new Set([0]);
    expect(pathRole(["bun", "test"], 0, "/repo", 0, execSet)).toBe("executable");
  });

  test("returns config for config flags", () => {
    const execSet = new Set<number>();
    expect(pathRole(["--config", "vitest.config.ts"], 0, "/repo", 0, execSet)).toBe("config");
    expect(pathRole(["--config", "vitest.config.ts"], 1, "/repo", 0, execSet)).toBe("config");
  });

  test("returns target for test intent commands", () => {
    const execSet = new Set([0]);
    expect(pathRole(["bun", "test", "tests/foo.test.ts"], 2, "/repo", 0, execSet)).toBe("target");
  });

  test("returns target for non-interpreter families", () => {
    const execSet = new Set([0]);
    expect(pathRole(["custom-tool", "arg1"], 1, "/repo", 0, execSet)).toBe("target");
  });

  test("distinguishes program and target for interpreter invocations", () => {
    const execSet = new Set([0]);
    const argv = ["node", "scripts/build.js", "src/file.ts"];
    expect(pathRole(argv, 1, "/repo", 0, execSet)).toBe("program");
    expect(pathRole(argv, 2, "/repo", 0, execSet)).toBe("target");
  });

  test("handles interpreter with flag options", () => {
    const execSet = new Set([0]);
    const argv = ["python3", "-u", "script.py", "data.txt"];
    expect(pathRole(argv, 2, "/repo", 0, execSet)).toBe("program");
    expect(pathRole(argv, 3, "/repo", 0, execSet)).toBe("target");
  });
});
