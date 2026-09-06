import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import {
  generateDefectRegressionTest,
  generateRegressionTestSuite,
  type DefectEntry,
  type GeneratedRegressionTest,
} from "../../../mind/defects/index.ts";
import type { AuditedDefect } from "./types.ts";

export interface GenerateTestsResult {
  readonly generatedTestsList: GeneratedRegressionTest[];
  readonly generatedTestSuite: string;
}

export function handleGenerateTests(
  allDefects: readonly AuditedDefect[],
  outputTests?: string,
  dryRun?: boolean,
): GenerateTestsResult {
  const generatedTestsList: GeneratedRegressionTest[] = [];
  const defectEntries: DefectEntry[] = [];
  for (const b of allDefects) {
    const defectEntry: DefectEntry = {
      id: b.id,
      type: b.type,
      severity: b.severity as DefectEntry["severity"],
      timestamp: b.timestamp,
      pid: b.pid,
      agent_id: b.agent_id ?? undefined,
      observation: b.observation,
      remediation: b.remediation,
      context: b.context as DefectEntry["context"],
      status: b.status,
    };

    const generated = generateDefectRegressionTest(defectEntry);
    generatedTestsList.push(generated);
    defectEntries.push(defectEntry);
  }

  const generatedTestSuite = generateRegressionTestSuite(defectEntries);

  if (outputTests !== undefined) {
    const targetPath = resolve(outputTests);
    const normalized = targetPath.replace(/\\/g, "/");
    if (
      normalized.includes("/olt/") ||
      normalized.includes("/src/") ||
      !normalized.includes("/tests/")
    ) {
      throw new HarnessError(
        "PATH_SAFETY",
        `Generated test suites must strictly reside inside tests/ directory and never under olt/ or src/: ${outputTests}`,
      );
    }
    if (!dryRun) {
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, generatedTestSuite, "utf-8");
    }
  }

  return { generatedTestsList, generatedTestSuite };
}
