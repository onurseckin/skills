import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";

const mockProcRunner = await import("node:child_process");
const mockFs = await import("node:fs");
const mockOs = await import("node:os");

describe("Oxlint Pure-Rust Hardening Invariants", () => {
  const repoRoot = join(import.meta.dir, "../../..");
  const configPath = join(repoRoot, ".oxlintrc.json");
  const rawConfig = mockFs.readFileSync(configPath, "utf8");
  const config = JSON.parse(rawConfig);

  describe("1. Static Configuration Invariants", () => {
    it("enforces pure Rust plugins without TypeScript JS runtime overhead", () => {
      expect(config.plugins).toBeDefined();
      expect(Array.isArray(config.plugins)).toBe(true);
      expect(config.plugins).toEqual(["oxc", "unicorn"]);
      expect(config.plugins).not.toContain("typescript");
      expect(config.jsPlugins).toBeUndefined();
    });

    it("enforces correctness category at error severity", () => {
      expect(config.categories?.correctness).toBe("error");
    });

    it("locks mandatory exclusions for tsc delegation and ANSI parsing", () => {
      expect(config.rules["no-unused-vars"]).toBe("off");
      expect(config.rules["no-control-regex"]).toBe("off");
      expect(config.rules["no-unsafe-finally"]).toBe("off");
      expect(config.rules["no-unsafe-optional-chaining"]).toBe("off");
      expect(config.rules["unicorn/no-thenable"]).toBe("off");
    });

    it("enforces critical safety rules with error severity", () => {
      expect(config.rules["no-debugger"]).toBe("error");
      expect(config.rules["no-eval"]).toBe("error");
      expect(config.rules["no-var"]).toBe("error");
      expect(config.rules["eqeqeq"]).toBe("error");
      expect(config.rules["no-caller"]).toBe("error");
      expect(config.rules["no-with"]).toBe("error");
      expect(config.rules["prefer-const"]).toBeDefined();
    });

    it("shields transient and temporary directories in ignorePatterns", () => {
      const patterns = config.ignorePatterns as string[];
      expect(patterns).toContain("**/coverage/**");
      expect(patterns).toContain("**/.tmp/**");
      expect(patterns).toContain("**/tests_tmp*/**");
      expect(patterns).toContain("runtime/**");
      expect(patterns).toContain("**/.cache/**");
    });
  });

  describe("2. Dynamic Execution & Anti-Pattern Fail-Fast Probes", () => {
    let tempDir: string;

    beforeAll(() => {
      const sp = mockProcRunner.spawnSync as unknown as { mockRestore?: () => void };
      if (typeof sp?.mockRestore === "function") {
        sp.mockRestore();
      }
      tempDir = mockFs.mkdtempSync(join(mockOs.tmpdir(), "oxlint-invariants-"));
    });

    afterAll(() => {
      mockFs.rmSync(tempDir, { recursive: true, force: true });
    });

    function probe(code: string): { status: number | null; output: string } {
      const sp = mockProcRunner.spawnSync as unknown as { mockRestore?: () => void };
      if (typeof sp?.mockRestore === "function") {
        sp.mockRestore();
      }
      const filePath = join(tempDir, "probe-" + Math.random().toString(36).slice(2) + ".ts");
      mockFs.writeFileSync(filePath, code);
      try {
        const proc = mockProcRunner.spawnSync(
          process.execPath,
          ["x", "oxlint", "--deny-warnings", "-c", configPath, "-f", "unix", filePath],
          {
            cwd: repoRoot,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${join(process.execPath, "..")}:${process.env.PATH ?? ""}`,
            },
          },
        );
        return {
          status: proc.status,
          output: (proc.stdout ?? "") + (proc.stderr ?? ""),
        };
      } finally {
        mockFs.rmSync(filePath, { force: true });
      }
    }

    it("passes cleanly on valid idiomatic modern TypeScript", () => {
      const validSnippet =
        "export function compute(a: number, b: number): number {\n  const sum = a + b;\n  return sum;\n}\n";
      const result = probe(validSnippet);
      expect(result.status).toBe(0);
      expect(result.output).not.toMatch(/error|warning/iu);
    });

    it("fails fast with exit code 1 on var declarations", () => {
      const result = probe("var obsoleteVariable = 42;\nconsole.log(obsoleteVariable);\n");
      expect(result.status).toBe(1);
      expect(result.output).toContain("no-var");
    });

    it("fails fast with exit code 1 on debugger statements", () => {
      const result = probe("export function pause(): void {\n  debugger;\n}\n");
      expect(result.status).toBe(1);
      expect(result.output).toContain("no-debugger");
    });

    it("fails fast with exit code 1 on eval usage", () => {
      const result = probe('export const unsafe = eval("2 + 2");\n');
      expect(result.status).toBe(1);
      expect(result.output).toContain("no-eval");
    });

    it("fails fast with exit code 1 on loose equality (==)", () => {
      const result = probe("export const areEqual = (1 == 2);\n");
      expect(result.status).toBe(1);
      expect(result.output).toContain("eqeqeq");
    });

    it("fails fast with exit code 1 on caller access (arguments.callee)", () => {
      const result = probe("export function callee(): unknown {\n  return arguments.callee;\n}\n");
      expect(result.status).toBe(1);
      expect(result.output).toContain("no-caller");
    });
  });
});
