import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createSyntheticPngBuffer } from "../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";
import {
  analyzeDualChannel,
  type DualChannelInput,
} from "../../../olt/scripts/src/validation/dual-channel-analyzer/index.ts";
import {
  cleanupVirtualValidationFS,
  scratchRoot,
  setupVirtualValidationFS,
} from "../validation-fixture.ts";

describe("Semantic Depth Quality Checks (Part 2)", () => {
  beforeEach(() => {
    setupVirtualValidationFS();
  });

  afterEach(() => {
    cleanupVirtualValidationFS();
  });

  it("passes analyzeDualChannel when requireSemanticDepth is active and manifests provide deep quantitative proof", () => {
    const semanticDepthDir = scratchRoot("dual-channel-semantic-depth", "depth");
    const desktopPath = join(semanticDepthDir, "header-desktop.png");
    const tabletPath = join(semanticDepthDir, "header-tablet.png");
    const mobilePath = join(semanticDepthDir, "header-mobile.png");
    const desktopBuf = createSyntheticPngBuffer(1440, 900, 4096);
    const tabletBuf = createSyntheticPngBuffer(768, 1024, 3072);
    const mobileBuf = createSyntheticPngBuffer(390, 844, 2048);
    const vfs = setupVirtualValidationFS();
    vfs.writeFileSync(desktopPath, desktopBuf);
    vfs.writeFileSync(tabletPath, tabletBuf);
    vfs.writeFileSync(mobilePath, mobileBuf);

    const input: DualChannelInput = {
      writeScope: ["src/components/Header.tsx"],
      requireSemanticDepth: true,
      screenshots: [
        {
          name: "header-desktop.png",
          path: desktopPath,
          viewport: "desktop",
          sizeBytes: desktopBuf.byteLength,
        },
        {
          name: "header-tablet.png",
          path: tabletPath,
          viewport: "tablet",
          sizeBytes: tabletBuf.byteLength,
        },
        {
          name: "header-mobile.png",
          path: mobilePath,
          viewport: "mobile",
          sizeBytes: mobileBuf.byteLength,
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
