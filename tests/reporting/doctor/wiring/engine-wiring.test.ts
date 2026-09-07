import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  ACCEPTED_ENGINE_WIRING_DEFECTS,
  auditEngineWiring,
  defectKey,
  formatEngineWiringReport,
  loadEngineWiringDocuments,
} from "../../../../olt/scripts/src/reporting/doctor/wiring/index.ts";

export const engineWiringSuiteName =
  "Doctor engine wiring guard - exported-but-never-invoked and invoked-but-cannot-fail";

const repoRoot = resolve(import.meta.dir, "../../../..");
const documents = loadEngineWiringDocuments(repoRoot);
const report = auditEngineWiring(documents);

describe(engineWiringSuiteName, () => {
  test("the engine universe is derived from source and is not empty", () => {
    expect(documents.length).toBeGreaterThan(500);
    expect(report.exportedEngines.length).toBeGreaterThanOrEqual(20);
    expect(report.exportedEngines).toContain("checkPlanningDag");
    expect(report.exportedEngines).toContain("checkEpistemicConfidence");
    expect(report.invokedEngines.length).toBeLessThan(report.exportedEngines.length);
    expect(report.invokedEngines).toContain("checkPlanningDag");
  });

  test("checkEpistemicConfidence is reported as exported but never invoked", () => {
    const defect = report.defects.find((entry) => entry.engine === "checkEpistemicConfidence");
    expect(defect).toBeDefined();
    expect(defect?.condition).toBe("exported-but-never-invoked");
    expect(defect?.declaredAt).toMatch(
      /^olt\/scripts\/src\/reporting\/doctor\/epistemic-engine\.ts:\d+$/u,
    );
    expect(report.invokedEngines).not.toContain("checkEpistemicConfidence");
  });

  test("checkDualChannelUi is reported as invoked but unable to fail", () => {
    const defect = report.defects.find((entry) => entry.engine === "checkDualChannelUi");
    expect(defect).toBeDefined();
    expect(defect?.condition).toBe("invoked-but-cannot-fail");
    expect(defect?.evidence).toMatch(/diagnostic-collector\.ts:\d+/u);
    expect(defect?.evidence).toContain("zero arguments");
  });

  test("checkCliRegistryTaxonomy is invoked with zero arguments yet is not a defect", () => {
    const zeroArgumentSites = report.invocations.filter(
      (invocation) =>
        invocation.name === "checkCliRegistryTaxonomy" && invocation.argumentCount === 0,
    );
    expect(zeroArgumentSites.length).toBeGreaterThan(0);
    expect(report.defects.map((entry) => entry.engine)).not.toContain("checkCliRegistryTaxonomy");
  });

  test("every reported defect names its engine, condition and declaration site", () => {
    expect(report.defects.length).toBeGreaterThanOrEqual(2);
    for (const defect of report.defects) {
      expect(defect.engine.length).toBeGreaterThan(0);
      expect(["exported-but-never-invoked", "invoked-but-cannot-fail"]).toContain(defect.condition);
      expect(defect.declaredAt).toMatch(/^olt\/scripts\/.+\.ts:\d+$/u);
      expect(defect.evidence.length).toBeGreaterThan(0);
    }
  });

  test("no wiring defect exists outside the accepted baseline", () => {
    const introduced = report.introduced.map(defectKey);
    expect(introduced).toEqual([]);
    expect(report.passed).toBe(true);
  });

  test("the baseline holds exactly the defects that are still present", () => {
    const observed = report.defects.map(defectKey).sort();
    expect(observed).toEqual([...ACCEPTED_ENGINE_WIRING_DEFECTS].sort());
    expect(report.resolved).toEqual([]);
  });

  test("the rendered report names both known instances", () => {
    const rendered = formatEngineWiringReport(report);
    expect(rendered).toContain("checkEpistemicConfidence [exported-but-never-invoked]");
    expect(rendered).toContain("checkDualChannelUi [invoked-but-cannot-fail]");
    expect(rendered).toContain("Status: passed");
  });
});
