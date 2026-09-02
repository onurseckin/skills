import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  initializeMindLifecycle,
  MANDATORY_MIND_COMPANION_AUDITORS,
  createMandatoryMindCompanionGrants,
  bootstrapMindLifecycleWithCompanions,
  deployMandatoryMindCompanions,
  verifyMindCompanionBootstrapping,
  assertMindCompanionBootstrapping,
} from "../../../../olt/scripts/src/mind/lifecycle/mind-init.ts";
import { loadRun } from "../../../../olt/scripts/src/engine/store/index.ts";

const SAMPLE_CHARTER = `identity: "mind-gen-1"
goals:
  - id: "G1"
    statement: "Achieve zero technical deficit"
  - id: "G2"
    statement: "Maintain 100 percent test coverage"
non_goals:
  - "Direct production database migrations"
repo_roots:
  - "."
budgets:
  pulses_per_day: 50
  wall_clock_ms_per_day: 18000000
  max_agents_in_flight: 4
  max_rounds_per_objective: 5
  base_interval_ms: 15000
  max_interval_ms: 60000
  max_pause_interval_ms: 120000
  pulse_deadline_ms: 45000
  max_open_proposals: 6
  quiet_hours: false
`;

const MINIMAL_CHARTER = `identity: "mind-minimal"
goals:
  - id: "G1"
    statement: "Basic Goal"
non_goals:
  - "Out of scope items"
repo_roots:
  - "."
`;

describe("Mind Init Lifecycle Suite (mind-init.ts)", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `mind-init-cov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  describe("Mind Companion Re-exports & Utilities", () => {
    it("exports mandatory companion auditor definitions and roles", () => {
      expect(MANDATORY_MIND_COMPANION_AUDITORS).toBeArray();
      expect(MANDATORY_MIND_COMPANION_AUDITORS).toContain("mind-auditor");
      expect(MANDATORY_MIND_COMPANION_AUDITORS).toContain("skill-auditor");
    });

    it("creates mandatory companion grants with correct schema and timestamps", () => {
      const grants = createMandatoryMindCompanionGrants("mind-alpha", {
        host: "test-node",
        now: "2026-09-01T12:00:00.000Z",
      });
      expect(grants).toHaveLength(2);
      expect(grants.map((g) => g.role).sort()).toEqual(["mind-auditor", "skill-auditor"]);
      expect(grants[0].parent_agent_id).toBe("mind-alpha");
      expect(grants[0].status).toBe("active");
      expect(grants[0].host).toBe("test-node");
    });

    it("bootstraps, verifies, and asserts companion grants correctly", () => {
      const initialGrants = [
        {
          id: "mind-alpha",
          role: "mind" as const,
          parent_agent_id: null,
          parent_task_id: null,
          host: "test-node",
          granted_at: "2026-09-01T12:00:00.000Z",
          status: "active" as const,
        },
      ];

      const checkBefore = verifyMindCompanionBootstrapping(initialGrants);
      expect(checkBefore.complete).toBe(false);
      expect(checkBefore.missing).toEqual(["mind-auditor", "skill-auditor"]);
      expect(() => assertMindCompanionBootstrapping(initialGrants)).toThrow(HarnessError);

      const bootstrapped = bootstrapMindLifecycleWithCompanions("mind-alpha", initialGrants);
      expect(bootstrapped.length).toBe(3);

      const checkAfter = verifyMindCompanionBootstrapping(bootstrapped);
      expect(checkAfter.complete).toBe(true);
      expect(checkAfter.missing).toEqual([]);
      expect(() => assertMindCompanionBootstrapping(bootstrapped)).not.toThrow();
    });
  });

  describe("Validation Errors & Pre-condition Guards", () => {
    it("throws INVALID_ARGUMENT when repo root does not exist", () => {
      const nonExistent = join(testDir, "does-not-exist");
      expect(() =>
        initializeMindLifecycle({
          repo: nonExistent,
          charter: "charter.yaml",
        }),
      ).toThrow(HarnessError);
    });

    it("throws INVALID_ARGUMENT when repo root is a file rather than directory", () => {
      const filePath = join(testDir, "file-not-dir.txt");
      writeFileSync(filePath, "hello", "utf-8");
      expect(() =>
        initializeMindLifecycle({
          repo: filePath,
          charter: "charter.yaml",
        }),
      ).toThrow(HarnessError);
    });

    it("throws INVALID_ARGUMENT when charter path is missing or empty", () => {
      expect(() =>
        initializeMindLifecycle({
          repo: testDir,
          charter: "",
        }),
      ).toThrow(HarnessError);
    });

    it("throws INVALID_ARGUMENT when charter file does not exist or is a directory", () => {
      const subDir = join(testDir, "some-dir");
      mkdirSync(subDir);
      expect(() =>
        initializeMindLifecycle({
          repo: testDir,
          charter: "some-dir",
        }),
      ).toThrow(HarnessError);
    });

    it("throws INVALID_ARGUMENT when charter file is empty or blank whitespace", () => {
      const emptyCharter = join(testDir, "empty.yaml");
      writeFileSync(emptyCharter, "   \n\t  \n", "utf-8");
      expect(() =>
        initializeMindLifecycle({
          repo: testDir,
          charter: emptyCharter,
        }),
      ).toThrow(HarnessError);
    });

    it("throws INVALID_STATE when capsule directory already exists", () => {
      const charterPath = join(testDir, "charter.yaml");
      writeFileSync(charterPath, SAMPLE_CHARTER, "utf-8");

      const capsuleDir = join(testDir, ".olt", "capsules", "mind-gen-1");
      mkdirSync(capsuleDir, { recursive: true });

      expect(() =>
        initializeMindLifecycle({
          repo: testDir,
          charter: charterPath,
          mindId: "mind-gen-1",
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("Successful Mind Initialization Execution", () => {
    it("initializes mind lifecycle with default parameters and creates policy/capsule", () => {
      const charterPath = join(testDir, "charter.yaml");
      writeFileSync(charterPath, SAMPLE_CHARTER, "utf-8");

      const result = initializeMindLifecycle({
        repo: testDir,
        charter: charterPath,
      });

      expect(result.mind_id).toBe("mind-gen-1");
      expect(result.generation).toBe(1);
      expect(result.charter.goals).toEqual(["G1", "G2"]);
      expect(result.charter.repo_roots).toEqual(["."]);
      expect(result.charter_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(result.governance.ready).toBe(true);
      expect(result.companions.deployed).toBe(true);
      expect(result.markdown).toContain("Mind Initialized: mind-gen-1");

      // Verify files written to disk
      expect(existsSync(join(testDir, ".olt", "policy.json"))).toBe(true);
      expect(existsSync(join(result.run_root, "last_pulse.json"))).toBe(true);

      const loaded = loadRun(result.run_root);
      const state = loaded.state as Record<string, any>;
      expect(state.mind.generation).toBe(1);
      expect(state.budget.pulses_per_day).toBe(50);
      expect(state.budget.quiet_hours).toBe("false");
      expect(state.pulse.counter).toBe(0);
      expect(state.agents.length).toBe(4); // mind + default owner + 2 companions
    });

    it("handles custom generation (> 1), custom mindId, actor matching mindId, and minimal charter", () => {
      const charterPath = join(testDir, "minimal-charter.yaml");
      writeFileSync(charterPath, MINIMAL_CHARTER, "utf-8");

      const result = initializeMindLifecycle({
        repo: testDir,
        charter: charterPath,
        generation: 2,
        mindId: "mind-gen-2",
        actor: "mind-gen-2",
        host: "custom-host-node",
      });

      expect(result.mind_id).toBe("mind-gen-2");
      expect(result.generation).toBe(2);

      const loaded = loadRun(result.run_root);
      const state = loaded.state as Record<string, any>;
      expect(state.mind.generation).toBe(2);
      expect(state.budget.pulses_per_day).toBeNull();
      expect(state.agents.some((g: any) => g.id === "mind-gen-2")).toBe(true);
      expect(state.agents.some((g: any) => g.role === "mind-auditor")).toBe(true);
      expect(state.agents.some((g: any) => g.role === "skill-auditor")).toBe(true);
    });

    it("auto-assigns mindId when generation > 1 and mindId is not passed", () => {
      const charterPath = join(testDir, "charter.yaml");
      writeFileSync(charterPath, SAMPLE_CHARTER, "utf-8");

      const result = initializeMindLifecycle({
        repo: testDir,
        charter: charterPath,
        generation: 3,
      });

      expect(result.mind_id).toBe("mind-gen-3");
      expect(result.generation).toBe(3);
    });

    it("adds distinct actor grant when actor !== mindId", () => {
      const charterPath = join(testDir, "charter.yaml");
      writeFileSync(charterPath, SAMPLE_CHARTER, "utf-8");

      const result = initializeMindLifecycle({
        repo: testDir,
        charter: charterPath,
        mindId: "mind-primary",
        actor: "human-operator-alice",
      });

      const loaded = loadRun(result.run_root);
      const state = loaded.state as Record<string, any>;
      expect(state.agents.some((g: any) => g.id === "human-operator-alice")).toBe(true);
      expect(state.agents.some((g: any) => g.id === "mind-primary")).toBe(true);
    });
  });
});
