import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

describe("Domain Test Suite & Subsystem Mirror Invariant Tests", () => {
  const repoRoot = resolve(import.meta.dir, "../../..");
  const scriptsSrcDir = join(repoRoot, "olt", "scripts", "src");
  const testsDir = join(repoRoot, "tests");

  it("verifies 1:1 domain correspondence between scripts/src/ subsystems and tests/ domain test suites", () => {
    expect(existsSync(scriptsSrcDir)).toBe(true);
    expect(existsSync(testsDir)).toBe(true);

    const nameMap: Record<string, string> = {
      task: "tasks",
      integration: "workflow",
      critic: "critic",
      engine: "engine",
    };

    const srcSubsystems = readdirSync(scriptsSrcDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(srcSubsystems.length).toBeGreaterThan(0);

    for (const subsystem of srcSubsystems) {
      const targetDomain = nameMap[subsystem] ?? subsystem;
      const testDomainDir = join(testsDir, targetDomain);
      expect(existsSync(testDomainDir)).toBe(true);
      expect(statSync(testDomainDir).isDirectory()).toBe(true);

      const testFiles = (readdirSync(testDomainDir, { recursive: true }) as string[]).filter(
        (f) => typeof f === "string" && (f.endsWith(".test.ts") || f.endsWith(".ts")),
      );
      expect(testFiles.length).toBeGreaterThan(0);
    }
  });

  it("verifies Lane 9 domains contain explicit named facades across all clusters", () => {
    const lane9Domains = [
      "installer",
      "capture",
      "watchdog",
      "scheduler",
      "scenarios",
      "docs",
    ];

    for (const domain of lane9Domains) {
      const facadePath = join(testsDir, domain, "index.ts");
      expect(existsSync(facadePath)).toBe(true);
    }
  });
});
