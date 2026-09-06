import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RootDirectoryHygieneGuard } from "../../olt/scripts/src/authority/guards/index.ts";
import { VerbatimRoleInjector } from "../../olt/scripts/src/authority/verbatim-role-injector.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { resolvePolicyPath } from "../../olt/scripts/src/core/index.ts";
import { resolveAgentsDirectory } from "../../olt/scripts/src/reporting/doctor/agent-canonical-engine.ts";

function withTestDir(fn: (testDir: string) => void): void {
  const testDir = join(
    tmpdir(),
    `test-hygiene-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  );
  mkdirSync(testDir, { recursive: true });
  try {
    fn(testDir);
  } finally {
    rmSync(testDir, { force: true, recursive: true });
  }
}

describe("Root Directory Hygiene Invariants (.olt vs olt)", () => {
  it("resolves policy path strictly to .olt/policy.json in consumer repos", () => {
    withTestDir((testDir) => {
      const policyPath = resolvePolicyPath(testDir);
      expect(policyPath).toBe(join(testDir, ".olt", "policy.json"));
      expect(policyPath.includes("/olt/")).toBe(false);
    });
  });

  it("strictly prefers .olt/agents over adversarial unhidden olt/agents in consumer repos", () => {
    withTestDir((testDir) => {
      const dotOltAgents = join(testDir, ".olt", "agents");
      const unhiddenAgents = join(testDir, "olt", "agents");
      mkdirSync(dotOltAgents, { recursive: true });
      mkdirSync(unhiddenAgents, { recursive: true });

      const resolved = resolveAgentsDirectory(testDir);
      expect(resolved).toBe(dotOltAgents);
      expect(resolved.includes("/.olt/agents")).toBe(true);
    });
  });

  it("resolves manifest path from .olt/agents with precedence over fallback paths", () => {
    withTestDir((testDir) => {
      const dotOltAgents = join(testDir, ".olt", "agents");
      const unhiddenAgents = join(testDir, "olt", "agents");
      mkdirSync(dotOltAgents, { recursive: true });
      mkdirSync(unhiddenAgents, { recursive: true });
      writeFileSync(join(dotOltAgents, "implementer.yaml"), "role: implementer\ntier: 3\n");
      writeFileSync(join(unhiddenAgents, "implementer.yaml"), "role: rogue\ntier: 1\n");

      const resolved = VerbatimRoleInjector.resolveManifestPath(testDir, "implementer");
      expect(resolved).toBe(join(dotOltAgents, "implementer.yaml"));
      expect(resolved.includes("/.olt/agents/")).toBe(true);
    });
  });

  it("throws HarnessError when attempting to write defects.jsonl in unhidden olt/", () => {
    withTestDir((testDir) => {
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(
          testDir,
          join(testDir, "olt", "defects.jsonl"),
        );
      }).toThrow(HarnessError);
    });
  });

  it("throws HarnessError for unapproved loose root-level scripts and text files", () => {
    withTestDir((testDir) => {
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(testDir, join(testDir, "script.sh"));
      }).toThrow(HarnessError);
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(testDir, join(testDir, "unapproved.txt"));
      }).toThrow(HarnessError);
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(testDir, join(testDir, "temp.log"));
      }).toThrow(HarnessError);
    });
  });

  it("throws HarnessError for path traversal attempts escaping .olt directory", () => {
    withTestDir((testDir) => {
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(
          testDir,
          join(testDir, ".olt", "..", "unhidden.txt"),
        );
      }).toThrow(HarnessError);
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(
          testDir,
          join(testDir, "..", "escaped-outside.ts"),
        );
      }).toThrow(HarnessError);
    });
  });

  it("allows legitimate .olt paths such as scratch, capsules, and mailboxes", () => {
    withTestDir((testDir) => {
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(
          testDir,
          join(testDir, ".olt", "scratch", "fix.ts"),
        );
      }).not.toThrow();
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(
          testDir,
          join(testDir, ".olt", "capsules", "run-1", "state.json"),
        );
      }).not.toThrow();
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(
          testDir,
          join(testDir, ".olt", "mailboxes", "coordinator", "inbox.jsonl"),
        );
      }).not.toThrow();
    });
  });

  it("blocks foreign repository write attempts to unhidden olt runtime files and directories", () => {
    withTestDir((testDir) => {
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(
          testDir,
          join(testDir, "olt", "coverage", "run.log"),
        );
      }).toThrow(HarnessError);
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(
          testDir,
          join(testDir, "olt", "quarantine", "dump.json"),
        );
      }).toThrow(HarnessError);
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(testDir, join(testDir, "olt", "test.log"));
      }).toThrow(HarnessError);
    });
  });

  it("allows standard repository root metadata files", () => {
    withTestDir((testDir) => {
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(testDir, join(testDir, "package.json"));
      }).not.toThrow();
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(testDir, join(testDir, "tsconfig.json"));
      }).not.toThrow();
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(testDir, join(testDir, "README.md"));
      }).not.toThrow();
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(testDir, join(testDir, "bun.lock"));
      }).not.toThrow();
    });
  });

  it("blocks write attempts to non-standard top-level directories in consumer repos", () => {
    withTestDir((testDir) => {
      expect(() => {
        RootDirectoryHygieneGuard.assertAllowedWritePath(
          testDir,
          join(testDir, "unapproved_dir", "file.ts"),
        );
      }).toThrow(HarnessError);
    });
  });
});
