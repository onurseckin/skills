import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { generateSummarySuite } from "../../orchestrating-long-tasks/scripts/src/summary/generate-summary.ts";
import { assetUrlCounts } from "../unit/summary/graph-fixtures.ts";
import { buildCompletenessRun } from "../unit/summary/completeness-run-fixture.ts";
import { buildRunReportCapsule } from "../unit/summary/markdown-run-report-fixture.ts";

const CAPSULE_BUILD_TIMEOUT_MS = 300_000;

describe("a fixed set of freshly built, disk-backed capsules", () => {
  let capsules: string[] = [];
  const roots: string[] = [];

  beforeAll(async () => {
    const completeness = await buildCompletenessRun("topology-capsule-completeness");
    const runReport = await buildRunReportCapsule();
    roots.push(completeness.repo, runReport.repo);
    capsules = [completeness.run, runReport.run];
  }, CAPSULE_BUILD_TIMEOUT_MS);

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  test(
    "every checked-in capsule exports a graph with singly-owned assets",
    () => {
      expect(capsules.length).toBeGreaterThan(0);
      for (const capsulePath of capsules) {
        const suite = generateSummarySuite({ capsulePath, writeToDisk: false });
        expect(suite.graph.nodes.length).toBeGreaterThan(0);
        expect(suite.graph.edges.length).toBeGreaterThan(0);
        for (const [url, count] of assetUrlCounts(suite.graph)) {
          expect(`${url}:${count}`).toBe(`${url}:1`);
        }
        expect(JSON.stringify(suite.graph)).not.toContain('"mediaAssets"');
      }
    },
    CAPSULE_BUILD_TIMEOUT_MS,
  );
});
