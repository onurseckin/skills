import { describe, expect, it } from "bun:test";
import type { FindingAdder } from "../../olt/scripts/src/validation/channels/dom-violation-extractor.ts";
import {
  METRIC_PATTERN,
  SUPERFICIAL_BOILERPLATE_PATTERNS,
  validateCompanionManifestCriteria,
} from "../../olt/scripts/src/validation/dual-channel-analyzer/manifest-auditor.ts";

interface RecordedFinding {
  category: string;
  severity: "error" | "warning" | "info";
  message: string;
  remediation: string;
  affectedSelector?: string | undefined;
  viewport?: string | undefined;
}

function createRecorder(): { findings: RecordedFinding[]; addFinding: FindingAdder } {
  const findings: RecordedFinding[] = [];
  const addFinding: FindingAdder = (category, severity, message, remediation, sel, vp) => {
    findings.push({
      category,
      severity,
      message,
      remediation,
      affectedSelector: sel,
      viewport: vp,
    });
  };
  return { findings, addFinding };
}

describe("ManifestAuditor Comprehensive Coverage", () => {
  it("exports metric and boilerplate regex patterns", () => {
    expect(METRIC_PATTERN.test("100%")).toBe(true);
    expect(METRIC_PATTERN.test("42px")).toBe(true);
    expect(SUPERFICIAL_BOILERPLATE_PATTERNS.has("looks good")).toBe(true);
  });

  it("rejects non-object manifests and manifests with missing screenId or viewport", () => {
    const rec1 = createRecorder();
    const res1 = validateCompanionManifestCriteria(null, rec1.addFinding);
    expect(res1.valid).toBe(false);
    expect(rec1.findings.some((f) => f.category === "invalid_manifest")).toBe(true);

    const rec2 = createRecorder();
    const res2 = validateCompanionManifestCriteria({ screenId: "dashboard" }, rec2.addFinding, {
      requireSemanticDepth: false,
    });
    expect(res2.valid).toBe(false);
    expect(rec2.findings.some((f) => f.category === "invalid_manifest")).toBe(true);
  });

  it("rejects manifests with empty criteria lists", () => {
    const rec = createRecorder();
    const manifest = { screenId: "home", viewport: "desktop", criteria: [] };
    const res = validateCompanionManifestCriteria(manifest, rec.addFinding);
    expect(res.valid).toBe(false);
    expect(rec.findings.some((f) => f.category === "missing_manifest_criteria")).toBe(true);
  });

  it("validates criteria format: checks invalid items, missing passed boolean, and empty details", () => {
    const rec = createRecorder();
    const manifest = {
      screenId: "settings",
      viewport: "desktop",
      criteria: [
        "not-an-object",
        { id: "CRIT-MECH-01", pillar: "mechanical", details: "valid details" },
        { id: "CRIT-COGN-01", pillar: "cognitive", passed: true, details: "   " },
      ],
    };
    const res = validateCompanionManifestCriteria(manifest, rec.addFinding);
    expect(res.valid).toBe(false);
    expect(rec.findings.filter((f) => f.category === "invalid_manifest_criterion").length).toBe(3);
  });

  it("evaluates criteria across all 4 mandatory pillars successfully with semantic depth", () => {
    const rec = createRecorder();
    const manifest = {
      screen_id: "checkout",
      viewport: "mobile",
      criteria: [
        {
          id: "CRIT-MECH-01",
          passed: true,
          details: "DOM verified with 0 layout shift and paint stability",
          evidence: "Measured 0px CLS and 100% paint stability on mobile",
        },
        {
          id: "CRIT-COGN-01",
          passed: true,
          details: "Information hierarchy verified with distinct levels",
          evidence: "5 visual hierarchy zones verified with 16px contrast",
        },
        {
          id: "CRIT-PROD-01",
          passed: true,
          details: "Payment CTA latency meets requirements reliably",
          evidence: "45ms median response time across 100 test runs",
        },
        {
          id: "CRIT-UX-01",
          passed: true,
          details: "Tap targets meet ergonomics specifications",
          evidence: "Target dimensions are 48px by 48px with 12px margin",
        },
      ],
    };
    const res = validateCompanionManifestCriteria(manifest, rec.addFinding, 0, {
      requireSemanticDepth: true,
    });
    expect(res.valid).toBe(true);
    expect(res.evaluatedCriteriaCount).toBe(4);
    expect(res.passedCriteriaCount).toBe(4);
    expect(res.pillarsPresent.length).toBe(4);
  });

  it("flags missing mandatory pillars and failed criteria", () => {
    const rec = createRecorder();
    const manifest = {
      screenId: "profile",
      viewport: "tablet",
      criteria: [
        { id: "CRIT-MECH-01", pillar: "mechanical", passed: true, evidence: "Clean render" },
        { id: "CRIT-UX-01", pillar: "ux", passed: false, details: "Touch target small" },
      ],
    };
    const res = validateCompanionManifestCriteria(manifest, rec.addFinding);
    expect(res.valid).toBe(false);
    expect(rec.findings.some((f) => f.category === "manifest_criterion_failed")).toBe(true);
    expect(rec.findings.some((f) => f.category === "missing_pillar_criteria")).toBe(true);
  });

  it("extracts criteria from alternative properties: evaluatedCriteria, allCriteria, and pillars object", () => {
    const recPillars = createRecorder();
    const manifestPillars = {
      screenId: "analytics",
      viewport: "desktop",
      pillars: {
        mechanical: { criteria: [{ id: "CRIT-MECH-1", passed: true, details: "OK mech" }] },
        cognitive: { evaluatedCriteria: [{ id: "CRIT-COGN-1", passed: true, details: "OK cogn" }] },
        product: { criteria: [{ id: "CRIT-PROD-1", passed: true, details: "OK prod" }] },
        ux: { criteria: [{ id: "CRIT-UX-1", passed: true, details: "OK ux" }] },
      },
    };
    const resPillars = validateCompanionManifestCriteria(manifestPillars, recPillars.addFinding);
    expect(resPillars.evaluatedCriteriaCount).toBe(4);

    const recAll = createRecorder();
    const manifestAll = {
      screenId: "reports",
      viewport: "desktop",
      allCriteria: [{ id: "CRIT-MECH-2", pillar: "mechanical", passed: true, evidence: "100%" }],
    };
    const resAll = validateCompanionManifestCriteria(manifestAll, recAll.addFinding);
    expect(resAll.evaluatedCriteriaCount).toBe(1);
  });

  it("audits cognitive analysis questionnaire including failed questions and semantic depth", () => {
    const recFail = createRecorder();
    const manifestFail = {
      screenId: "search",
      viewport: "desktop",
      criteria: [
        { id: "CRIT-MECH-1", passed: true, details: "mech ok" },
        { id: "CRIT-COGN-1", passed: true, details: "cogn ok" },
        { id: "CRIT-PROD-1", passed: true, details: "prod ok" },
        { id: "CRIT-UX-1", passed: true, details: "ux ok" },
      ],
      cognitiveAnalysis: {
        questions: [{ id: "Q-SEARCH-01", passed: false, observation: "Query input obscured" }],
      },
    };
    const resFail = validateCompanionManifestCriteria(manifestFail, recFail.addFinding);
    expect(resFail.valid).toBe(false);

    const recPass = createRecorder();
    const manifestPass = {
      screenId: "search",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-1",
          passed: true,
          details: "99.9% render score confirmed on display",
          evidence: "99.9% render score verified across viewport",
        },
        {
          id: "CRIT-COGN-1",
          passed: true,
          details: "3 step workflow sequence clearly indicated",
          evidence: "Step indicator verified at 100% with 3 items",
        },
        {
          id: "CRIT-PROD-1",
          passed: true,
          details: "12ms latency confirmed for filter query",
          evidence: "Measured 12ms filter latency across 500 items",
        },
        {
          id: "CRIT-UX-1",
          passed: true,
          details: "52px button size across interactive UI",
          evidence: "Dimensions measured exactly at 52px width",
        },
      ],
      cognitiveAnalysis: {
        questions: [
          {
            id: "Q-SEARCH-02",
            passed: true,
            observation: "Search autocomplete delivers suggestions within 20ms",
            evidence: "Measured 20ms response across 50 simulated keystrokes",
          },
        ],
      },
    };
    const resPass = validateCompanionManifestCriteria(manifestPass, recPass.addFinding, {
      requireSemanticDepth: true,
    });
    expect(resPass.valid).toBe(true);
  });
});
