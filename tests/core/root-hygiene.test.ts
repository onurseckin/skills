import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { RootDirectoryHygieneGuard } from "../../olt/scripts/src/authority/guards/index.ts";
import { VerbatimRoleInjector } from "../../olt/scripts/src/authority/verbatim-role-injector.ts";
import { findAgentManifestPath } from "../../olt/scripts/src/cli/commands/agent-brief.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { resolvePolicyPath } from "../../olt/scripts/src/core/index.ts";
import { resolveOrGenerateCharter } from "../../olt/scripts/src/mind/lifecycle/mind-init-flow.ts";
import { indexCharterDocuments } from "../../olt/scripts/src/mind/memory/core/indexer.ts";
import { resolveAgentsDirectory } from "../../olt/scripts/src/reporting/doctor/agent-canonical-engine.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Root Directory Hygiene Invariants (.olt vs olt)", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  function withTestDir(fn: (testDir: string) => void): void {
    const testDir = `/virtual/test-hygiene-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    vfs.mkdirSync(testDir, { recursive: true });
    try {
      fn(testDir);
    } finally {
      vfs.rmSync(testDir, { recursive: true, force: true });
    }
  }

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
      vfs.mkdirSync(dotOltAgents, { recursive: true });
      vfs.mkdirSync(unhiddenAgents, { recursive: true });

      const resolved = resolveAgentsDirectory(testDir);
      expect(resolved).toBe(dotOltAgents);
      expect(resolved.includes("/.olt/agents")).toBe(true);
    });
  });

  it("resolves manifest path from .olt/agents with precedence over fallback paths", () => {
    withTestDir((testDir) => {
      const dotOltAgents = join(testDir, ".olt", "agents");
      const unhiddenAgents = join(testDir, "olt", "agents");
      vfs.mkdirSync(dotOltAgents, { recursive: true });
      vfs.mkdirSync(unhiddenAgents, { recursive: true });
      vfs.writeFileSync(join(dotOltAgents, "implementer.yaml"), "role: implementer\ntier: 3\n");
      vfs.writeFileSync(join(unhiddenAgents, "implementer.yaml"), "role: rogue\ntier: 1\n");

      const resolved = VerbatimRoleInjector.resolveManifestPath(testDir, "implementer");
      expect(resolved).toBe(join(dotOltAgents, "implementer.yaml"));
      expect(resolved.includes("/.olt/agents/")).toBe(true);
    });
  });

  it("never resolves agents directory from a consumer repo with only unhidden olt/agents", () => {
    withTestDir((testDir) => {
      const unhiddenAgents = join(testDir, "olt", "agents");
      vfs.mkdirSync(unhiddenAgents, { recursive: true });
      vfs.writeFileSync(join(unhiddenAgents, "implementer.yaml"), "role: rogue\ntier: 1\n");

      const resolved = resolveAgentsDirectory(testDir);
      expect(resolved).not.toBe(unhiddenAgents);
      expect(resolved.startsWith(join(testDir, "olt"))).toBe(false);
    });
  });

  it("never trusts a consumer repo's unhidden olt/agents/mind.yaml as the charter source", () => {
    withTestDir((testDir) => {
      const unhiddenMindDir = join(testDir, "olt", "agents");
      const unhiddenMind = join(unhiddenMindDir, "mind.yaml");
      vfs.mkdirSync(unhiddenMindDir, { recursive: true });
      vfs.writeFileSync(unhiddenMind, "identity:\n  name: rogue-charter\n");

      const result = resolveOrGenerateCharter(testDir);
      expect(result.fullPath).not.toBe(unhiddenMind);
      expect(result.fullPath.startsWith(join(testDir, "olt"))).toBe(false);
      expect(result.text).not.toContain("rogue-charter");
    });
  });

  it("skips a consumer repo's unhidden olt/references directory when indexing charter documents", () => {
    withTestDir((testDir) => {
      const unhiddenRefs = join(testDir, "olt", "references");
      vfs.mkdirSync(unhiddenRefs, { recursive: true });
      vfs.writeFileSync(join(unhiddenRefs, "rogue-standard.md"), "# Rogue Standard\n");

      const documents = indexCharterDocuments(testDir);
      expect(documents.some((doc) => doc.id === "reference-rogue-standard")).toBe(false);
    });
  });

  it("throws instead of resolving an agent manifest from a consumer repo's unhidden olt/agents", () => {
    withTestDir((testDir) => {
      const role = "totally-fake-role-xyz";
      const unhiddenAgents = join(testDir, "olt", "agents");
      vfs.mkdirSync(unhiddenAgents, { recursive: true });
      vfs.writeFileSync(join(unhiddenAgents, `${role}.yaml`), "role: rogue\n");

      expect(() => findAgentManifestPath(role, testDir)).toThrow(HarnessError);
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
