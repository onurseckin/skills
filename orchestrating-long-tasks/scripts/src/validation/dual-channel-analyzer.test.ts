import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import { analyzeDualChannel, validateCompanionManifestCriteria } from "./dual-channel-analyzer.ts";
import type { DualChannelInput, StructuredFinding } from "./dual-channel-types.ts";

describe("Dual-Channel Visual Validation & Screenshot Size Enforcement", () => {
  it("rejects screenshots smaller than 1024 bytes (e.g., 67-byte minimal stub)", () => {
    const input: DualChannelInput = {
      writeScope: ["src/components/Dashboard.tsx"],
      screenshots: [
        {
          name: "dashboard-desktop.png",
          path: "/tmp/dashboard-desktop.png",
          viewport: "desktop",
          sizeBytes: 67, // dummy stub
        },
        {
          name: "dashboard-mobile.png",
          path: "/tmp/dashboard-mobile.png",
          viewport: "mobile",
          sizeBytes: 0, // 0-byte stub
        },
      ],
    };

    const result = analyzeDualChannel(input);
    expect(result.isUiTask).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.mode).toBe("rejected");

    const sizeFindings = result.findings.filter(
      (f) => f.category === "invalid_screenshot_size" || f.category === "zero_byte_screenshot",
    );
    expect(sizeFindings.length).toBeGreaterThanOrEqual(2);
    expect(sizeFindings.some((f) => f.message.includes("< 1024 bytes"))).toBe(true);
  });

  it("accepts screenshots >= 1024 bytes with full viewport coverage", () => {
    const input: DualChannelInput = {
      writeScope: ["src/components/Dashboard.tsx"],
      screenshots: [
        {
          name: "dashboard-desktop.png",
          path: "/tmp/dashboard-desktop.png",
          viewport: "desktop",
          sizeBytes: 2048,
        },
        {
          name: "dashboard-tablet.png",
          path: "/tmp/dashboard-tablet.png",
          viewport: "tablet",
          sizeBytes: 1536,
        },
        {
          name: "dashboard-mobile.png",
          path: "/tmp/dashboard-mobile.png",
          viewport: "mobile",
          sizeBytes: 1024,
        },
      ],
    };

    const result = analyzeDualChannel(input);
    expect(result.isUiTask).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.mode).toBe("screenshot_gap_filled");
    expect(result.findings.filter((f) => f.severity === "error")).toHaveLength(0);
    expect(result.proofs).toHaveLength(3);
  });

  it("skips visual validation for non-UI tasks", () => {
    const input: DualChannelInput = {
      writeScope: ["src/database/schema.sql", "src/backend/service.go"],
    };

    const result = analyzeDualChannel(input);
    expect(result.isUiTask).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.mode).toBe("non_ui_skipped");
  });
});

describe("Companion Manifest 4-Pillar Criteria Enforcement", () => {
  const findingsCollector = () => {
    const findings: StructuredFinding[] = [];
    const addFinding = (
      category: StructuredFinding["category"],
      severity: StructuredFinding["severity"],
      message: string,
      remediation: string,
      affectedSelector?: string,
      viewport?: string,
    ) => {
      findings.push({
        id: `VF-${findings.length + 1}`,
        category,
        severity,
        message,
        remediation,
        ...(affectedSelector !== undefined ? { affectedSelector } : {}),
        ...(viewport !== undefined ? { viewport } : {}),
      });
    };
    return { findings, addFinding };
  };

  it("validates a compliant companion manifest covering all 4 mandatory pillars", () => {
    const manifest = {
      schema: "companion.manifest.v1",
      screenId: "dashboard",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          name: "APCA Contrast",
          passed: true,
          details: "All text elements meet APCA Lc lightness contrast thresholds.",
          evidence: "Evaluated 25 text nodes with 0 violations.",
        },
        {
          id: "CRIT-COGN-FITTS",
          pillar: "cognitive",
          name: "Fitts's Law Target Acquisition",
          passed: true,
          details: "Primary call to action targets maintain ID <= 5.5.",
          evidence: "Average target acquisition ID = 3.2.",
        },
        {
          id: "CRIT-PROD-GEIST-TOKENS",
          pillar: "product",
          name: "Geist Design System Tokens",
          passed: true,
          details: "Typography, spacing, and borders adhere to token scales.",
          evidence: "Validated 42 token usages.",
        },
        {
          id: "CRIT-UX-FOCUS-TRAP",
          pillar: "ux",
          name: "WAI-ARIA Focus Trap",
          passed: true,
          details: "Modal and dialog containers constrain tab cycle traversal.",
          evidence: "Verified keyboard navigation focus cycling.",
        },
      ],
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifest, addFinding);

    expect(outcome.valid).toBe(true);
    expect(outcome.evaluatedCriteriaCount).toBe(4);
    expect(outcome.passedCriteriaCount).toBe(4);
    expect(findings.filter((f) => f.severity === "error")).toHaveLength(0);
  });

  it("rejects companion manifest if any of the 4 mandatory pillars is missing", () => {
    const manifestMissingUx = {
      screenId: "dashboard",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          passed: true,
          details: "Pass",
          evidence: "Evidence",
        },
        {
          id: "CRIT-COGN-COWAN",
          pillar: "cognitive",
          passed: true,
          details: "Pass",
          evidence: "Evidence",
        },
        {
          id: "CRIT-PROD-GEIST",
          pillar: "product",
          passed: true,
          details: "Pass",
          evidence: "Evidence",
        },
        // UX Ergonomics pillar missing!
      ],
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifestMissingUx, addFinding);

    expect(outcome.valid).toBe(false);
    const pillarErrors = findings.filter((f) => f.category === "missing_pillar_criteria");
    expect(pillarErrors.length).toBeGreaterThanOrEqual(1);
    expect(pillarErrors.some((f) => f.message.includes("UX Ergonomics"))).toBe(true);
  });

  it("rejects criteria missing explicit boolean passed property", () => {
    const manifest = {
      screenId: "dashboard",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          // missing passed!
          details: "Pass",
          evidence: "Evidence",
        },
        {
          id: "CRIT-COGN-COWAN",
          pillar: "cognitive",
          passed: true,
          details: "Pass",
          evidence: "Ev",
        },
        { id: "CRIT-PROD-GEIST", pillar: "product", passed: true, details: "Pass", evidence: "Ev" },
        { id: "CRIT-UX-FOCUS", pillar: "ux", passed: true, details: "Pass", evidence: "Ev" },
      ],
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifest, addFinding);

    expect(outcome.valid).toBe(false);
    const critErrors = findings.filter((f) => f.category === "invalid_manifest_criterion");
    expect(critErrors.some((f) => f.message.includes("Missing explicit boolean 'passed'"))).toBe(
      true,
    );
  });

  it("rejects criteria with empty details and empty evidence", () => {
    const manifest = {
      screenId: "dashboard",
      viewport: "desktop",
      criteria: [
        { id: "CRIT-MECH-APCA", pillar: "mechanical", passed: true, details: "", evidence: "   " },
        {
          id: "CRIT-COGN-COWAN",
          pillar: "cognitive",
          passed: true,
          details: "Pass",
          evidence: "Ev",
        },
        { id: "CRIT-PROD-GEIST", pillar: "product", passed: true, details: "Pass", evidence: "Ev" },
        { id: "CRIT-UX-FOCUS", pillar: "ux", passed: true, details: "Pass", evidence: "Ev" },
      ],
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifest, addFinding);

    expect(outcome.valid).toBe(false);
    const critErrors = findings.filter((f) => f.category === "invalid_manifest_criterion");
    expect(critErrors.some((f) => f.message.includes("non-empty 'details' or 'evidence'"))).toBe(
      true,
    );
  });

  it("rejects manifest if any criterion failed (passed: false)", () => {
    const manifest = {
      screenId: "dashboard",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          passed: false,
          details: "APCA contrast Lc=38.2 below required threshold 60.0",
          evidence: "Contrast failure on selector .btn-secondary",
        },
        {
          id: "CRIT-COGN-COWAN",
          pillar: "cognitive",
          passed: true,
          details: "Pass",
          evidence: "Ev",
        },
        { id: "CRIT-PROD-GEIST", pillar: "product", passed: true, details: "Pass", evidence: "Ev" },
        { id: "CRIT-UX-FOCUS", pillar: "ux", passed: true, details: "Pass", evidence: "Ev" },
      ],
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifest, addFinding);

    expect(outcome.valid).toBe(false);
    const failedErrors = findings.filter((f) => f.category === "manifest_criterion_failed");
    expect(failedErrors).toHaveLength(1);
    expect(failedErrors[0]?.message).toContain("CRIT-MECH-APCA");
  });
});

describe("Semantic Depth Quality Checks & requireSemanticDepth Enforcement", () => {
  const findingsCollector = () => {
    const findings: StructuredFinding[] = [];
    const addFinding = (
      category: StructuredFinding["category"],
      severity: StructuredFinding["severity"],
      message: string,
      remediation: string,
      affectedSelector?: string,
      viewport?: string,
    ) => {
      findings.push({
        id: `VF-${findings.length + 1}`,
        category,
        severity,
        message,
        remediation,
        ...(affectedSelector !== undefined ? { affectedSelector } : {}),
        ...(viewport !== undefined ? { viewport } : {}),
      });
    };
    return { findings, addFinding };
  };

  it("detects boilerplate details and superficial evidence under requireSemanticDepth", () => {
    const manifest = {
      screenId: "checkout",
      viewport: "mobile",
      criteria: [
        {
          id: "CRIT-MECH-OVERFLOW",
          pillar: "mechanical",
          passed: true,
          details: "ok", // boilerplate
          evidence: "375px width verified without horizontal scroll",
        },
        {
          id: "CRIT-COGN-THUMB",
          pillar: "cognitive",
          passed: true,
          details: "Thumb zone", // < 12 characters (superficial)
          evidence: "passed", // boilerplate
        },
        {
          id: "CRIT-PROD-BRAND",
          pillar: "product",
          passed: true,
          details: "Verified brand color palette tokens",
          evidence: "Looks good to reviewer", // missing quantitative metric numbers
        },
        {
          id: "CRIT-UX-CONTRAST",
          pillar: "ux",
          passed: true,
          details: "Evaluated interactive button states",
          evidence: "4.5:1 ratio", // valid with quantitative metric
        },
      ],
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifest, addFinding, {
      requireSemanticDepth: true,
    });

    expect(outcome.valid).toBe(false);
    expect(
      findings.some(
        (f) => f.category === "boilerplate_evidence" && f.message.includes("CRIT-MECH-OVERFLOW"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.category === "superficial_evidence" && f.message.includes("CRIT-COGN-THUMB"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.category === "boilerplate_evidence" && f.message.includes("CRIT-COGN-THUMB"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.category === "missing_evidence_metrics" && f.message.includes("CRIT-PROD-BRAND"),
      ),
    ).toBe(true);
  });

  it("validates cognitiveAnalysis.questions for superficial rationale and missing metrics", () => {
    const manifest = {
      screenId: "settings",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          passed: true,
          details: "APCA lightness contrast exceeds required Lc thresholds.",
          evidence: "Evaluated 12 text surfaces; min Lc = 78.4.",
        },
        {
          id: "CRIT-COGN-FITTS",
          pillar: "cognitive",
          passed: true,
          details: "Fitts Law index of difficulty complies with target bounds.",
          evidence: "Evaluated 8 buttons; min size = 48x48px.",
        },
        {
          id: "CRIT-PROD-DESIGN",
          pillar: "product",
          passed: true,
          details: "Design system spacing tokens conform to 8pt spatial grid.",
          evidence: "100% of padding uses 8px/16px/24px steps.",
        },
        {
          id: "CRIT-UX-KEYBOARD",
          pillar: "ux",
          passed: true,
          details: "Keyboard accessibility preserves visible focus rings.",
          evidence: "Tab index traversal verified across 15 interactive elements.",
        },
      ],
      cognitiveAnalysis: {
        questions: [
          {
            id: "Q-PERC-01-JTBD-ANCHOR",
            passed: true,
            observation: "Good anchor", // < 12 characters -> superficial_evidence
            evidence: "1 headline element detected with font-size 28px.",
          },
          {
            id: "Q-ERGO-02-FITTS",
            passed: true,
            observation: "Interactive targets maintain comfortable touch floor above 44px.",
            evidence: "checked", // boilerplate evidence
          },
          {
            id: "Q-TYPO-01-CONTRAST",
            passed: true,
            observation: "ok", // boilerplate observation
            evidence: "All text elements pass with 100% compliance.",
          },
          {
            id: "Q-RESI-01-STATES",
            passed: true,
            observation: "Interactive state transitions provide immediate tactile visual response.",
            evidence: "No issues with state transitions", // missing metrics
          },
        ],
      },
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifest, addFinding, {
      requireSemanticDepth: true,
    });

    expect(outcome.valid).toBe(false);
    expect(
      findings.some(
        (f) => f.category === "superficial_evidence" && f.message.includes("Q-PERC-01-JTBD-ANCHOR"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.category === "boilerplate_evidence" && f.message.includes("Q-ERGO-02-FITTS"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.category === "boilerplate_evidence" && f.message.includes("Q-TYPO-01-CONTRAST"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.category === "missing_evidence_metrics" && f.message.includes("Q-RESI-01-STATES"),
      ),
    ).toBe(true);
  });

  it("passes analyzeDualChannel when requireSemanticDepth is active and manifests provide deep quantitative proof", () => {
    const input: DualChannelInput = {
      writeScope: ["src/components/Header.tsx"],
      requireSemanticDepth: true,
      screenshots: [
        {
          name: "header-desktop.png",
          path: "/tmp/header-desktop.png",
          viewport: "desktop",
          sizeBytes: 4096,
        },
        {
          name: "header-tablet.png",
          path: "/tmp/header-tablet.png",
          viewport: "tablet",
          sizeBytes: 3072,
        },
        {
          name: "header-mobile.png",
          path: "/tmp/header-mobile.png",
          viewport: "mobile",
          sizeBytes: 2048,
        },
      ],
      manifests: [
        {
          screenId: "header",
          viewport: "desktop",
          criteria: [
            {
              id: "CRIT-MECH-APCA",
              pillar: "mechanical",
              passed: true,
              details: "All navigation links exceed WCAG AAA and APCA lightness contrast criteria.",
              evidence: "Tested 6 text nodes; contrast ratio = 8.2:1 with lightness Lc = 85.3.",
            },
            {
              id: "CRIT-COGN-CHUNKS",
              pillar: "cognitive",
              passed: true,
              details:
                "Navigation menu groups links into 4 distinct semantic items under Cowan limit.",
              evidence: "Total of 4 primary navigation clusters counted across 1280px canvas.",
            },
            {
              id: "CRIT-PROD-TOKENS",
              pillar: "product",
              passed: true,
              details:
                "Header typography styles adhere strictly to Design System font-size tokens.",
              evidence: "Verified 16px body font and 24px title against token scales.",
            },
            {
              id: "CRIT-UX-FOCUS",
              pillar: "ux",
              passed: true,
              details: "Focus-visible ring outline renders with 2px blue offset on tab navigation.",
              evidence: "Keyboard focus traversal validated across 6 elements with 2px outlines.",
            },
          ],
          cognitiveAnalysis: {
            questions: [
              {
                id: "Q-PERC-01-JTBD-ANCHOR",
                passed: true,
                observation:
                  "Primary focal brand anchor is immediately recognizable within first 2.0s glance.",
                evidence: "Logo anchor bounds 180x48px at coordinate (24, 16) in 1280px viewport.",
              },
            ],
          },
        },
      ],
    };

    const result = analyzeDualChannel(input);
    expect(result.isUiTask).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.findings.filter((f) => f.severity === "error")).toHaveLength(0);
  });

  it("fails analyzeDualChannel when requireSemanticDepth is active and manifest has superficial details", () => {
    const input: DualChannelInput = {
      writeScope: ["src/components/Header.tsx"],
      requireSemanticDepth: true,
      screenshots: [
        {
          name: "header-desktop.png",
          path: "/tmp/header-desktop.png",
          viewport: "desktop",
          sizeBytes: 4096,
        },
        {
          name: "header-tablet.png",
          path: "/tmp/header-tablet.png",
          viewport: "tablet",
          sizeBytes: 3072,
        },
        {
          name: "header-mobile.png",
          path: "/tmp/header-mobile.png",
          viewport: "mobile",
          sizeBytes: 2048,
        },
      ],
      manifests: [
        {
          screenId: "header",
          viewport: "desktop",
          criteria: [
            {
              id: "CRIT-MECH-APCA",
              pillar: "mechanical",
              passed: true,
              details: "pass", // superficial boilerplate!
              evidence: "8.2:1 ratio",
            },
            {
              id: "CRIT-COGN-CHUNKS",
              pillar: "cognitive",
              passed: true,
              details: "ok", // superficial boilerplate!
              evidence: "4 items",
            },
            {
              id: "CRIT-PROD-TOKENS",
              pillar: "product",
              passed: true,
              details: "valid", // superficial boilerplate!
              evidence: "16px token",
            },
            {
              id: "CRIT-UX-FOCUS",
              pillar: "ux",
              passed: true,
              details: "done", // superficial boilerplate!
              evidence: "2px outline",
            },
          ],
        },
      ],
    };

    const result = analyzeDualChannel(input);
    expect(result.isUiTask).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.mode).toBe("rejected");
    const boilerplateFindings = result.findings.filter(
      (f) => f.category === "boilerplate_evidence",
    );
    expect(boilerplateFindings.length).toBeGreaterThanOrEqual(4);
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  it("verifies dual-channel test and source files contain zero any and zero suppressions", () => {
    const filesToAudit = [
      "/Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/scripts/src/validation/dual-channel-types.ts",
      "/Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/scripts/src/validation/dual-channel-analyzer.ts",
      "/Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/scripts/src/validation/dual-channel-analyzer.test.ts",
    ];

    const anyPattern = /:\s*any\b|as\s+any\b|<any>/;
    const suppressionPattern = new RegExp("@ts-" + "ignore|@ts-" + "expect-error|@ts-" + "nocheck|eslint-" + "disable|oxlint-" + "disable");

    for (const filePath of filesToAudit) {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Skip comment lines in invariant check itself
        if (line.includes("anyPattern") || line.includes("suppressionPattern") || line.includes("new RegExp")) continue;

        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});

describe("Ultra-Lean Packet Invariants & Fake Completion Purging Verification", () => {
  it("verifies sanitizeLeanContext purges fake completion assumptions and heavy metadata blobs", async () => {
    const { sanitizeLeanContext } = await import("../packets/validator-context.ts");
    expect(typeof sanitizeLeanContext).toBe("function");

    const payload = {
      clean_field: "valid_value",
      assumed_complete: true,
      assumed_completion: "fake_success",
      fake_completion: "done_without_proof",
      historical_completion: "past_success",
      prior_completion_claim: "i_already_finished",
      stale_pass: true,
      unverified_success: "unverified",
      raw_events: [{ event: "big" }],
      raw_metadata: { heavy: true },
      giant_logs: "100MB_log_data",
      dependency_graph_dump: { nodes: [1, 2, 3] },
      nested: {
        safe: "ok",
        fake_completion: "nested_leak",
        stale_evidence: "old",
      },
    };

    const sanitized = sanitizeLeanContext(payload) as Record<string, unknown>;
    expect(sanitized["clean_field"]).toBe("valid_value");
    expect("assumed_complete" in sanitized).toBe(false);
    expect("assumed_completion" in sanitized).toBe(false);
    expect("fake_completion" in sanitized).toBe(false);
    expect("historical_completion" in sanitized).toBe(false);
    expect("prior_completion_claim" in sanitized).toBe(false);
    expect("stale_pass" in sanitized).toBe(false);
    expect("unverified_success" in sanitized).toBe(false);
    expect("raw_events" in sanitized).toBe(false);
    expect("raw_metadata" in sanitized).toBe(false);
    expect("giant_logs" in sanitized).toBe(false);
    expect("dependency_graph_dump" in sanitized).toBe(false);
    const nested = sanitized["nested"] as Record<string, unknown>;
    expect(nested["safe"]).toBe("ok");
    expect("fake_completion" in nested).toBe(false);
    expect("stale_evidence" in nested).toBe(false);
  });
});

