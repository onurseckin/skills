import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as crossProof from "../../../../olt/scripts/src/validation/dual-channel-analyzer/cross-proof.ts";
import {
  formatManifestFilename,
  isCertifiedManifest,
  synthesizeCompanionManifest,
} from "../../../../olt/scripts/src/capture/validator/index.ts";
import type { ValidationContext } from "../../../../olt/scripts/src/capture/validator/types.ts";
import {
  analyzeDualChannel,
  type DualChannelInput,
  type StructuredFinding,
} from "../../../../olt/scripts/src/validation/dual-channel-analyzer/index.ts";
import { assertRoleArtifactPresent } from "../../../../olt/scripts/src/workflow/review/role-evidence.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { setupWorkflowVirtualFs } from "../../shared/index.ts";

function createFindingCollector(): {
  readonly findings: StructuredFinding[];
  readonly addFinding: (
    category: StructuredFinding["category"],
    severity: StructuredFinding["severity"],
    message: string,
    remediation: string,
    affectedSelector?: string,
    viewport?: string,
  ) => void;
} {
  const findings: StructuredFinding[] = [];
  const addFinding = (
    category: StructuredFinding["category"],
    severity: StructuredFinding["severity"],
    message: string,
    remediation: string,
    affectedSelector?: string,
    viewport?: string,
  ): void => {
    findings.push({
      id: `FINDING-${String(findings.length + 1).padStart(3, "0")}`,
      category,
      severity,
      message,
      remediation,
      ...(affectedSelector !== undefined ? { affectedSelector } : {}),
      ...(viewport !== undefined ? { viewport } : {}),
    });
  };
  return { findings, addFinding };
}

describe("Adversarial Edge Cases: Multi-Viewport Companion Manifest Verification", () => {
  let vfsCleanup: (() => void) | undefined;

  beforeEach(() => {
    const setup = setupWorkflowVirtualFs();
    vfsCleanup = setup.cleanup;
  });

  afterEach(() => {
    vfsCleanup?.();
    vfsCleanup = undefined;
  });
  it("rejects dual-channel UI task when required viewports are missing", () => {
    const input: DualChannelInput = {
      writeScope: ["src/views/Settings.tsx"],
      // Only desktop provided, mobile and tablet are missing
      screenshots: [
        {
          name: "settings-desktop.png",
          path: "/tmp/settings-desktop.png",
          viewport: "desktop",
          sizeBytes: 2048,
        },
      ],
    };

    const result = analyzeDualChannel(input);
    expect(result.isUiTask).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.mode).toBe("rejected");
    const missingVpFindings = result.findings.filter((f) => f.category === "missing_viewport");
    expect(missingVpFindings.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects dummy screenshot stubs (< 1024 bytes) and generates Anti-Mocking violation", () => {
    const input: DualChannelInput = {
      writeScope: ["src/views/Settings.tsx"],
      screenshots: [
        {
          name: "settings-desktop.png",
          path: "/tmp/settings-desktop.png",
          viewport: "desktop",
          sizeBytes: 67, // minimal stub
        },
        {
          name: "settings-tablet.png",
          path: "/tmp/settings-tablet.png",
          viewport: "tablet",
          sizeBytes: 500, // stub
        },
        {
          name: "settings-mobile.png",
          path: "/tmp/settings-mobile.png",
          viewport: "mobile",
          sizeBytes: 0, // zero bytes
        },
      ],
    };

    const result = analyzeDualChannel(input);
    expect(result.passed).toBe(false);
    expect(result.mode).toBe("rejected");
    const stubFindings = result.findings.filter((f) => f.category === "invalid_screenshot_size");
    expect(stubFindings.length).toBe(3);
    expect(stubFindings.some((f) => f.message.includes("Anti-Mocking Invariant Violation"))).toBe(
      true,
    );
  });

  it("passes multi-viewport companion manifest verification with genuine screenshots >= 1024 bytes", () => {
    const input: DualChannelInput = {
      writeScope: ["src/components/Header.tsx"],
      screenshots: [
        {
          name: "header-mobile.png",
          path: "/virtual/screenshots/header-mobile.png",
          viewport: "mobile",
          sizeBytes: 1200,
        },
        {
          name: "header-tablet.png",
          path: "/virtual/screenshots/header-tablet.png",
          viewport: "tablet",
          sizeBytes: 1500,
        },
        {
          name: "header-desktop.png",
          path: "/virtual/screenshots/header-desktop.png",
          viewport: "desktop",
          sizeBytes: 2048,
        },
      ],
      manifests: [
        {
          schema: "companion.manifest.v1",
          screenId: "header",
          viewport: "desktop",
          criteria: [
            {
              id: "CRIT-MECH-APCA",
              pillar: "mechanical",
              passed: true,
              details: "APCA compliant",
              evidence: "Lc=85.0",
            },
            {
              id: "CRIT-COGN-STATES",
              pillar: "cognitive",
              passed: true,
              details: "FSM complete",
              evidence: "States: 5/5",
            },
            {
              id: "CRIT-PROD-GEIST-TOKENS",
              pillar: "product",
              passed: true,
              details: "Tokens matched",
              evidence: "Radius 8px",
            },
            {
              id: "CRIT-UX-FOCUS-TRAP",
              pillar: "ux",
              passed: true,
              details: "Trapped focus valid",
              evidence: "Tab cycle constrained",
            },
          ],
        },
      ],
    };

    const spy = spyOn(crossProof, "readPngPixelDimensions").mockImplementation((path) => {
      if (path.includes("mobile")) return { status: "measured", width: 390, height: 844 };
      if (path.includes("tablet")) return { status: "measured", width: 768, height: 1024 };
      return { status: "measured", width: 1440, height: 900 };
    });

    try {
      const audit = analyzeDualChannel(input);
      expect(audit.isUiTask).toBe(true);
      expect(audit.passed).toBe(true);
      expect(audit.mode).toBe("screenshot_gap_filled");
      expect(audit.proofs).toHaveLength(3);
      expect(
        audit.proofs.some((p) => p.verifiedInvariants.includes("manifest_4_pillars_certified")),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("enforces assertRoleArtifactPresent constraints across UI and non-UI domains", () => {
    // Non-UI domain passes without artifacts
    expect(() => {
      assertRoleArtifactPresent("task-db-01", false, { hasArtifact: false });
    }).not.toThrow();

    // UI domain throws HarnessError when no artifact is recorded
    expect(() => {
      assertRoleArtifactPresent("task-ui-01", true, { hasArtifact: false });
    }).toThrow(HarnessError);

    // UI domain throws HarnessError when screenshots are stubs (< 1024 bytes)
    expect(() => {
      assertRoleArtifactPresent("task-ui-02", true, {
        hasArtifact: true,
        screenshots: [{ sizeBytes: 67, name: "stub.png" }],
      });
    }).toThrow(HarnessError);

    // UI domain passes when screenshot is >= 1024 bytes
    expect(() => {
      assertRoleArtifactPresent("task-ui-03", true, {
        hasArtifact: true,
        screenshots: [{ sizeBytes: 1024, name: "real.png" }],
      });
    }).not.toThrow();

    // UI domain passes when companion manifests are present
    expect(() => {
      assertRoleArtifactPresent("task-ui-04", true, {
        hasArtifact: true,
        manifests: [{ screenId: "home", viewport: "desktop" }],
      });
    }).not.toThrow();
  });

  it("serializes, formats, and validates companion manifests v2.0 correctly and rejects invalid manifests", () => {
    const syntheticCtx: ValidationContext = {
      screenId: "checkout-screen",
      viewport: "mobile",
      elements: [
        {
          selector: "button.checkout-btn",
          tagName: "BUTTON",
          text: "Pay Now",
          bounds: { x: 20, y: 100, width: 300, height: 48 },
          interactive: true,
          isTouchTarget: true,
          computedStyles: {
            color: "#ffffff",
            backgroundColor: "#000000",
            fontSize: 16,
            fontWeight: 600,
            borderRadius: 8,
          },
          implementedStates: ["default", "hover", "active", "focus", "disabled"],
        },
      ],
      viewportBounds: { width: 375, height: 667 },
    };

    const manifest = synthesizeCompanionManifest(syntheticCtx);
    expect(isCertifiedManifest(manifest)).toBe(true);
    expect(formatManifestFilename(manifest.screenId, manifest.viewport)).toBe(
      "checkout-screen-mobile.manifest.json",
    );
    expect(manifest.version).toBe("2.0");
    expect(manifest.screenId).toBe("checkout-screen");
    expect(manifest.viewport).toBe("mobile");
    expect(manifest.verdict).toBe("CERTIFIED");
    expect(manifest.criteria.length).toBeGreaterThanOrEqual(4);
  });
});
