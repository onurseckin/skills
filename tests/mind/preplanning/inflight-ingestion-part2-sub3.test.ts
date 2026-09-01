import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  InFlightIngestionEngine,
  UserIntentExtractionEngine,
  createInFlightSnapshot,
  extractUserIntent,
  inspectInFlightWork,
  integrateUserIntentIntoRoadmap,
  listInFlightSnapshots,
  loadInFlightSnapshot,
  parseDiffSummary,
  parseGitStashes,
  parseGitStatusOutput,
  saveInFlightSnapshot,
  structureUserIntentAsBacklogDeliverable,
  toCanonicalDomainCategory,
  type GitRunner,
  type InFlightSnapshot,
  type InFlightSnapshotOptions,
  type IntentCategory,
  type IntentDomain,
  type SaveSnapshotOptions,
} from "../../../olt/scripts/src/mind/preplanning/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("In-Flight Work Ingestion & Intent Extraction Engine Suite", () => {
  describe("UserIntentExtractionEngine & Priority 1 Binding", () => {
    it("extracts structured user intent, classifies category/domain, and extracts symbols", () => {
      const mockSnapshot: InFlightSnapshot = {
        snapshotId: "snap_20260901_test1",
        createdAt: "2026-09-01T10:00:00.000Z",
        repoRoot: "/test/repo",
        branch: "feature/intent-wave",
        headCommit: "abcdef1234567890",
        uncommittedFiles: [
          {
            path: "olt/scripts/src/mind/preplanning/intent-extraction.ts",
            status: "added",
            staged: false,
            unstaged: true,
            sizeBytes: 1200,
            fileHash: "hash1",
            indexStatus: "?",
            workTreeStatus: "?",
          },
        ],
        diffSummary: { insertions: 150, deletions: 10, filesChanged: 1 },
        rawDiff: [
          "diff --git a/olt/scripts/src/mind/preplanning/intent-extraction.ts b/olt/scripts/src/mind/preplanning/intent-extraction.ts",
          "+export class UserIntentExtractionEngine {",
          "+  public extractIntent(): void {}",
          "+}",
          "+export interface UserIntentRecord {}",
          "+export function extractUserIntent(): void {}",
        ].join("\n"),
        stagedDiff: "",
        unstagedDiff: "",
        untrackedFileContents: {
          "olt/scripts/src/mind/preplanning/intent-extraction.ts":
            "export class UserIntentExtractionEngine {}\nexport interface UserIntentRecord {}",
        },
        stashes: [
          {
            index: 0,
            selector: "stash@{0}",
            hash: "123",
            message: "Implement user intent engine",
            date: "2026-09-01",
          },
        ],
        metadata: {},
      };

      const engine = new UserIntentExtractionEngine();
      const intent = engine.extractIntent(mockSnapshot);

      expect(intent.priority).toBe("P1");
      expect(intent.category).toBe("FEATURE");
      expect(intent.primarySymbolsAffected).toContain("UserIntentExtractionEngine");
      expect(intent.primarySymbolsAffected).toContain("UserIntentRecord");
      expect(intent.title).toContain("Implement user intent engine");
      expect(intent.statement.length).toBeGreaterThan(20);
      expect(intent.rationale.length).toBeGreaterThan(20);
      expect(intent.suggestedAcceptanceCriteria.length).toBeGreaterThanOrEqual(3);
      expect(intent.suggestedTestScope.some((s) => s.includes("intent-extraction.test.ts"))).toBe(
        true,
      );

      // Verify Priority 1 deliverable structuring
      const deliverable = engine.structureAsBacklogDeliverable(intent);
      expect(deliverable.priority).toBe("P1");
      expect(deliverable.deliverableId.startsWith("deliv_p1_")).toBe(true);
      expect(deliverable.backlogItem.priority).toBe("P1");
      expect(deliverable.backlogItem.status).toBe("PENDING");
      expect(deliverable.backlogItem.title).toBe(intent.title);
      expect(deliverable.backlogItem.content).toContain(intent.statement);
      expect(deliverable.acceptanceCriteria).toEqual(intent.suggestedAcceptanceCriteria);

      // Verify Roadmap integration as expedited P1 blueprint
      const integration = engine.integrateIntoRoadmap(intent);
      expect(integration.roadmapAction).toBe("CREATE_EXPEDITED_PLAN");
      expect(integration.targetPlanPath).toContain("plans/plan-p1-");
      expect(integration.deliverable.priority).toBe("P1");
    });

    it("correctly maps all intent domains to canonical DomainCategory", () => {
      const domains: IntentDomain[] = [
        "UI/UX",
        "Backend/API",
        "Core Engine",
        "Testing",
        "Tooling",
        "Docs",
        "Architecture",
      ];

      for (const dom of domains) {
        const canonical = toCanonicalDomainCategory(dom);
        expect(["core", "validation", "tooling", "engine", "reporting"]).toContain(canonical);
      }
    });

    it("integrates user intent into existing roadmap cluster when matched", () => {
      const mockSnapshot: InFlightSnapshot = {
        snapshotId: "snap_20260901_test2",
        createdAt: "2026-09-01T10:00:00.000Z",
        repoRoot: "/test/repo",
        branch: "feature/engine",
        headCommit: "abcdef1234567890",
        uncommittedFiles: [
          {
            path: "olt/scripts/src/engine/runner.ts",
            status: "modified",
            staged: true,
            unstaged: false,
            sizeBytes: 500,
            fileHash: "hash2",
            indexStatus: "M",
            workTreeStatus: " ",
          },
        ],
        diffSummary: { insertions: 20, deletions: 5, filesChanged: 1 },
        rawDiff:
          "diff --git a/olt/scripts/src/engine/runner.ts b/olt/scripts/src/engine/runner.ts\n+export function runNextTick() {}\n",
        stagedDiff: "",
        unstagedDiff: "",
        untrackedFileContents: {},
        stashes: [],
        metadata: {},
      };

      const intent = extractUserIntent(mockSnapshot, { explicitDomain: "Core Engine" });
      expect(intent.canonicalDomain).toBe("engine");

      const existingRoadmap = {
        clusters: [
          {
            cluster_id: "cluster-engine-001",
            domain: "engine",
            plan_path: "plans/plan-engine-001.md",
          },
        ],
      };

      const integration = integrateUserIntentIntoRoadmap(intent, existingRoadmap);
      expect(integration.roadmapAction).toBe("UPDATE_CLUSTER");
      expect(integration.clusterId).toBe("cluster-engine-001");
      expect(integration.notes.some((n) => n.includes("cluster-engine-001"))).toBe(true);
    });

    it("extracts various categories correctly (BUG_FIX, REFACTOR, UX_POLISH, TESTING, INFRASTRUCTURE)", () => {
      const categories: IntentCategory[] = [
        "BUG_FIX",
        "REFACTOR",
        "UX_POLISH",
        "TESTING",
        "INFRASTRUCTURE",
      ];

      for (const cat of categories) {
        const mockSnapshot: InFlightSnapshot = {
          snapshotId: `snap_cat_${cat}`,
          createdAt: "2026-09-01T10:00:00.000Z",
          repoRoot: "/test/repo",
          branch: "main",
          headCommit: "abcdef1234567890",
          uncommittedFiles: [
            {
              path: "src/file.ts",
              status: "modified",
              staged: false,
              unstaged: true,
              sizeBytes: 100,
              fileHash: "h",
              indexStatus: " ",
              workTreeStatus: "M",
            },
          ],
          diffSummary: { insertions: 10, deletions: 5, filesChanged: 1 },
          rawDiff: "+export function doWork() {}",
          stagedDiff: "",
          unstagedDiff: "",
          untrackedFileContents: {},
          stashes: [],
          metadata: {},
        };

        const intent = extractUserIntent(mockSnapshot, { explicitCategory: cat });
        expect(intent.category).toBe(cat);
        expect(intent.priority).toBe("P1");
      }
    });
  });
});
