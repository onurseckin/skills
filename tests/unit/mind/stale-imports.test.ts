import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as mindIndex from "../../../olt/scripts/src/mind/index.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

function collectTypeScriptFiles(dirPath: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dirPath);
  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...collectTypeScriptFiles(fullPath));
    } else if (fullPath.endsWith(".ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("mind/index.ts - Stale Relative Imports Remediation", () => {
  test("1. root barrel exports all canonical domain namespaces", () => {
    expect(mindIndex.archival).toBeDefined();
    expect(mindIndex.audit).toBeDefined();
    expect(mindIndex.auditing).toBeDefined();
    expect(mindIndex.brief).toBeDefined();
    expect(mindIndex.briefingBuilder).toBeDefined();
    expect(mindIndex.budget).toBeDefined();
    expect(mindIndex.cadence).toBeDefined();
    expect(mindIndex.charter).toBeDefined();
    expect(mindIndex.cognition).toBeDefined();
    expect(mindIndex.cognitiveFlavor).toBeDefined();
    expect(mindIndex.completedTasks).toBeDefined();
    expect(mindIndex.contracts).toBeDefined();
    expect(mindIndex.core).toBeDefined();
    expect(mindIndex.counterfactual).toBeDefined();
    expect(mindIndex.defectAggregator).toBeDefined();
    expect(mindIndex.defectAudit).toBeDefined();
    expect(mindIndex.defectCore).toBeDefined();
    expect(mindIndex.defectDedup).toBeDefined();
    expect(mindIndex.defects).toBeDefined();
    expect(mindIndex.defectSync).toBeDefined();
    expect(mindIndex.deploy).toBeDefined();
    expect(mindIndex.digest).toBeDefined();
    expect(mindIndex.dynamicRoles).toBeDefined();
    expect(mindIndex.evolution).toBeDefined();
    expect(mindIndex.feedback).toBeDefined();
    expect(mindIndex.feedbackQueue).toBeDefined();
    expect(mindIndex.gates).toBeDefined();
    expect(mindIndex.governance).toBeDefined();
    expect(mindIndex.hyperCognition).toBeDefined();
    expect(mindIndex.interval).toBeDefined();
    expect(mindIndex.lane).toBeDefined();
    expect(mindIndex.lanes).toBeDefined();
    expect(mindIndex.lastPulse).toBeDefined();
    expect(mindIndex.lifecycle).toBeDefined();
    expect(mindIndex.liveness).toBeDefined();
    expect(mindIndex.memory).toBeDefined();
    expect(mindIndex.memoryCore).toBeDefined();
    expect(mindIndex.metaAuditor).toBeDefined();
    expect(mindIndex.mindObserve).toBeDefined();
    expect(mindIndex.observe).toBeDefined();
    expect(mindIndex.preplanning).toBeDefined();
    expect(mindIndex.profiles).toBeDefined();
    expect(mindIndex.proposal).toBeDefined();
    expect(mindIndex.proposals).toBeDefined();
    expect(mindIndex.pulse).toBeDefined();
    expect(mindIndex.pulseReclaim).toBeDefined();
    expect(mindIndex.pushbacks).toBeDefined();
    expect(mindIndex.purpose).toBeDefined();
    expect(mindIndex.questionnaire).toBeDefined();
    expect(mindIndex.quiesce).toBeDefined();
    expect(mindIndex.recycler).toBeDefined();
    expect(mindIndex.rescue).toBeDefined();
    expect(mindIndex.roleAuditing).toBeDefined();
    expect(mindIndex.roles).toBeDefined();
    expect(mindIndex.rotate).toBeDefined();
    expect(mindIndex.rounds).toBeDefined();
    expect(mindIndex.selfEvolution).toBeDefined();
    expect(mindIndex.smartTaskManager).toBeDefined();
    expect(mindIndex.sources).toBeDefined();
    expect(mindIndex.strategicPurpose).toBeDefined();
    expect(mindIndex.taskDiscovery).toBeDefined();
    expect(mindIndex.taskDrainage).toBeDefined();
    expect(mindIndex.taskLookahead).toBeDefined();
    expect(mindIndex.taskQueue).toBeDefined();
    expect(mindIndex.tasks).toBeDefined();
    expect(mindIndex.value).toBeDefined();
    expect(mindIndex.watchdog).toBeDefined();
    expect(mindIndex.watchdogManager).toBeDefined();
    expect(mindIndex.watchdogOps).toBeDefined();
    expect(mindIndex.witness).toBeDefined();
  });

  test("2. previously misrouted barrel exports point to correct implementations", () => {
    expect(typeof mindIndex.hyperCognition.createHyperCognitionEngine).toBe("function");
    expect(typeof mindIndex.hyperCognition.formatHyperCognitionBrief).toBe("function");
    expect(typeof mindIndex.hyperCognition.runAutonomousAuditLoop).toBe("function");
    expect(mindIndex.hyperCognition.COGNITIVE_AUDIT_DIMENSIONS).toBeDefined();

    expect(typeof mindIndex.strategicPurpose.evaluateStrategicCandidateAdmission).toBe("function");
    expect(typeof mindIndex.strategicPurpose.planProactiveRoadmap).toBe("function");
    expect(mindIndex.strategicPurpose.MIND_STRATEGIC_ALTITUDE).toBeDefined();

    expect(typeof mindIndex.value.calculatePulseValue).toBe("function");
    expect(typeof mindIndex.value.calculateNextWakeInterval).toBe("function");
    expect(typeof mindIndex.value.calculateQuiescentBackoffInterval).toBe("function");

    expect(typeof mindIndex.pulseReclaim.reclaimDeadPulse).toBe("function");
    expect(typeof mindIndex.pulseReclaim.resolveLastPulsePath).toBe("function");

    expect(typeof mindIndex.memoryCore.searchMemory).toBe("function");
    expect(typeof mindIndex.memoryCore.buildMemoryIndex).toBe("function");
  });

  test("3. canonical sub-barrels export expected APIs", () => {
    expect(typeof mindIndex.lifecycle.enforceInfiniteMindCadence).toBe("function");
    expect(typeof mindIndex.lifecycle.evaluateStrategicCandidateAdmission).toBe("function");
    expect(typeof mindIndex.lifecycle.createHyperCognitionEngine).toBe("function");
    expect(typeof mindIndex.lifecycle.reclaimDeadPulse).toBe("function");

    expect(typeof mindIndex.tasks.admitTask).toBe("function");
    expect(typeof mindIndex.tasks.discoverTasks).toBe("function");
    expect(typeof mindIndex.tasks.executeAtomicAdmissionToDispatch).toBe("function");

    expect(typeof mindIndex.feedback.admitFeedbackToQueue).toBe("function");
    expect(typeof mindIndex.feedback.readFeedbackQueue).toBe("function");

    expect(typeof mindIndex.defects.computeDefectDiscriminator).toBe("function");
    expect(typeof mindIndex.defects.toAggregatedDefect).toBe("function");
    expect(typeof mindIndex.defects.LiveDefectDeduplicator).toBe("function");
  });

  test("4. all relative imports in tests/unit/mind resolve to existing files", () => {
    const mindTestsDir = join(REPO_ROOT, "tests/unit/mind");
    const testFiles = collectTypeScriptFiles(mindTestsDir);
    expect(testFiles.length).toBeGreaterThan(50);

    const importRegex = /(?:from\s+["'](\.\.?\/[^"']+)["']|import\s+["'](\.\.?\/[^"']+)["'])/gu;

    for (const filePath of testFiles) {
      const content = readFileSync(filePath, "utf-8");
      const stripped = content
        .replace(/`[\s\S]*?`/gu, '""')
        .replace(/"(?:[^"\\]|\\.)*"/gu, (m) => (m.includes("\n") ? '""' : m));

      let match: RegExpExecArray | null = null;
      while ((match = importRegex.exec(stripped)) !== null) {
        const importTarget = match[1] ?? match[2];
        if (importTarget && importTarget.startsWith(".")) {
          const resolved = resolve(dirname(filePath), importTarget);
          const exists =
            existsSync(resolved) ||
            existsSync(resolved + ".ts") ||
            existsSync(join(resolved, "index.ts"));
          expect(exists).toBe(true);
        }
      }
    }
  });

  test("5. strict repository invariants are enforced", () => {
    const filesToCheck = ["olt/scripts/src/mind/index.ts", "tests/unit/mind/stale-imports.test.ts"];

    for (const relPath of filesToCheck) {
      const absPath = join(REPO_ROOT, relPath);
      expect(existsSync(absPath)).toBe(true);

      const content = readFileSync(absPath, "utf-8");
      const lines = content.split("\n");
      expect(lines.length).toBeLessThanOrEqual(300);

      expect(content).not.toContain("@ts" + "-ignore");
      expect(content).not.toContain("@ts" + "-expect-error");
      expect(content).not.toContain("@ts" + "-nocheck");

      const colonAny = new RegExp(":\\s*" + "any\\b", "u");
      const asAny = new RegExp("as\\s+" + "any\\b", "u");
      const bracketAny = new RegExp("<" + "any>", "u");
      expect(colonAny.test(content)).toBe(false);
      expect(asAny.test(content)).toBe(false);
      expect(bracketAny.test(content)).toBe(false);

      const blockComment = new RegExp("/" + "\\*[\\s\\S]*?\\*" + "/", "u");
      const lineComment = new RegExp("/" + "/.*$", "mu");
      expect(blockComment.test(content)).toBe(false);
      expect(lineComment.test(content)).toBe(false);
    }
  });
});
