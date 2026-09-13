import { describe, expect, test } from "bun:test";
import {
  checkOpticalDoctor,
  detectSuperficialChecklists,
  detectSyntheticJsonEvasion,
  detectViewportReviewDefects,
  verifyOpticalReview,
  type OpticalDoctorCheckOptions,
  type OpticalReviewToolCall,
} from "../../../../olt/scripts/src/reporting/doctor/optical/index.ts";

const VALID_TOOL_CALLS: readonly OpticalReviewToolCall[] = [
  {
    tool: "view_file",
    args: { AbsolutePath: "/evidence/screenshots/mobile_390.png" },
  },
  {
    tool: "view_file",
    args: { AbsolutePath: "/evidence/screenshots/tablet_768.png" },
  },
  {
    tool: "view_file",
    args: { AbsolutePath: "/evidence/screenshots/desktop_1440.png" },
  },
  {
    tool: "view_file",
    args: { AbsolutePath: "/evidence/screenshots/desktop_1920.png" },
  },
];

const GENUINE_HUMAN_REVIEW = `
Upon opening the primary dashboard across the rendered screenshots, the immediate visceral impression is one of calm, professional competence. The navigation bar anchors the upper frame with crisp typography, and the active persona can immediately locate the primary search field and task management controls without visual hunting or cognitive confusion.

When walking through the responsive journey from small to large screens, the interface adapts with fluid grace. In the mobile 390px viewport, the horizontal navigation collapses neatly into a touch-friendly bottom sheet drawer, preserving generous breathing room around the primary call-to-action button. The headline wraps naturally across two lines without awkward hyphenation or descender clipping, maintaining excellent optical harmony. Text readability remains pristine under natural lighting conditions.

Moving upward to the tablet 768px layout, the grid expands effortlessly into a two-column arrangement. Negative space between the metric summary cards and the activity graph creates clear visual hierarchy, allowing the user's eye to navigate the operational flow smoothly. The tactile touch target bounds remain comfortably spaced, preventing accidental taps or awkward finger reaching.

Finally, spanning out to desktop 1440px and the wide 1920px canvas, the layout avoids the common trap of excessive horizontal stretching. The main content container remains bounded with proportional margins, preventing line lengths from exceeding comfortable reading measures. Typography contrast remains legible and sharp, and subtle elevation shadows gently lift floating action surfaces. The visual weight is distributed harmoniously across both header and footer regions.

In conclusion, the visual surface achieves genuine product excellence. The responsive transitions are seamless, the typography rhythm is disciplined, and the overall experience is comfortable, elegant, and production ready across all form factors.
`.trim();

describe("UI Optical Doctor Engine & Check Suite", () => {
  test("passes cleanly on genuine human-grade prose across all 4 canonical viewports", () => {
    const options: OpticalDoctorCheckOptions = {
      toolCalls: VALID_TOOL_CALLS,
      reviewProse: GENUINE_HUMAN_REVIEW,
      screenshotFileSizes: {
        "/evidence/screenshots/mobile_390.png": 45000,
        "/evidence/screenshots/tablet_768.png": 95000,
        "/evidence/screenshots/desktop_1440.png": 150000,
        "/evidence/screenshots/desktop_1920.png": 210000,
      },
    };

    const result = checkOpticalDoctor(options);
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.engine).toBe("optical-doctor");

    const health = verifyOpticalReview(options.toolCalls ?? [], options.reviewProse ?? "", [
      "/evidence/screenshots/mobile_390.png",
      "/evidence/screenshots/tablet_768.png",
      "/evidence/screenshots/desktop_1440.png",
      "/evidence/screenshots/desktop_1920.png",
    ]);
    expect(health.healthy).toBe(true);
    expect(health.violations).toHaveLength(0);
  });

  test("rejects checklist boilerplate, bulleted rubrics, task lists, and tables", () => {
    const bulletRubric = `
Here is my review of the screens:
- APCA: Pass
- Touch target: OK
- Visual layout: Pass
- Spacing: 16px verified
The layout looks fine on all screen sizes including mobile, tablet, and desktop viewports with 390px and 1440px.
`;
    const headingChecklist = `
### 1. Visual Layout
Looks good on mobile, tablet, and desktop.
### 2. Optical Spacing
Padding is fine across all screens.
`;
    const tableChecklist = `
| Dimension | Status |
| Visual layout | Pass |
| APCA | Pass |
Mobile and tablet are reviewed.
`;
    const taskListChecklist = `
- [x] Visual Layout
- [x] APCA
- [x] Touch Target
Reviewed mobile, tablet, desktop.
`;
    const legacyAxisTag = `Reviewing Axis 1 and Landmark 2 for mobile and desktop screens.`;

    const r1 = detectSuperficialChecklists(bulletRubric);
    expect(r1.length).toBeGreaterThanOrEqual(1);
    expect(r1.some((f) => f.code === "BANNED_CHECKLIST_BOILERPLATE")).toBe(true);

    const r2 = detectSuperficialChecklists(headingChecklist);
    expect(r2.length).toBeGreaterThanOrEqual(1);
    expect(r2.some((f) => f.code === "SUPERFICIAL_CHECKLIST_PARROTING")).toBe(true);

    const r3 = detectSuperficialChecklists(tableChecklist);
    expect(r3.length).toBeGreaterThanOrEqual(1);
    expect(r3.some((f) => f.code === "BANNED_CHECKLIST_BOILERPLATE")).toBe(true);

    const r4 = detectSuperficialChecklists(taskListChecklist);
    expect(r4.length).toBeGreaterThanOrEqual(1);
    expect(r4.some((f) => f.code === "BANNED_CHECKLIST_BOILERPLATE")).toBe(true);

    const r5 = detectSuperficialChecklists(legacyAxisTag);
    expect(r5.length).toBeGreaterThanOrEqual(1);
    expect(r5.some((f) => f.code === "BANNED_CHECKLIST_BOILERPLATE")).toBe(true);
  });

  test("flags synthetic JSON evasion, embedded JSON stubs, and JSON code blocks", () => {
    const wholeBodyJson = JSON.stringify({
      layoutOverflows: [],
      textClippings: [],
      touchTargetCollisions: [],
      status: "pass",
    });
    const embeddedJson = `
The screens look good overall for mobile, tablet, and desktop.
{"layoutOverflows": [], "textClippings": [], "status": "pass"}
Verified across all 4 viewports.
`;
    const codeBlockJson = "```json\n" + wholeBodyJson + "\n```";

    const f1 = detectSyntheticJsonEvasion(wholeBodyJson);
    expect(f1.length).toBeGreaterThanOrEqual(1);
    expect(f1[0]?.code).toBe("SYNTHETIC_JSON_EVASION");
    expect(f1[0]?.severity).toBe("ERROR");

    const f2 = detectSyntheticJsonEvasion(embeddedJson);
    expect(f2.length).toBeGreaterThanOrEqual(1);
    expect(f2[0]?.code).toBe("SYNTHETIC_JSON_EVASION");

    const f3 = detectSyntheticJsonEvasion(codeBlockJson);
    expect(f3.length).toBeGreaterThanOrEqual(1);
    expect(f3[0]?.code).toBe("SYNTHETIC_JSON_EVASION");

    const fullResult = checkOpticalDoctor({
      toolCalls: VALID_TOOL_CALLS,
      reviewProse: wholeBodyJson,
    });
    expect(fullResult.passed).toBe(false);
    expect(fullResult.findings.some((f) => f.code === "SYNTHETIC_JSON_EVASION")).toBe(true);
  });

  test("flags missing canonical viewports, uninspected surfaces, and duplicate tool calls", () => {
    // 0 tool calls
    const resNoCalls = checkOpticalDoctor({
      toolCalls: [],
      reviewProse: GENUINE_HUMAN_REVIEW,
    });
    expect(resNoCalls.passed).toBe(false);
    expect(resNoCalls.findings.some((f) => f.code === "UNINSPECTED_SURFACE_APPROVAL")).toBe(true);

    // Missing mobile viewport
    const resMissingMobile = checkOpticalDoctor({
      toolCalls: [
        { tool: "view_file", args: { AbsolutePath: "/evidence/screenshots/tablet_768.png" } },
        { tool: "view_file", args: { AbsolutePath: "/evidence/screenshots/desktop_1440.png" } },
        { tool: "view_file", args: { AbsolutePath: "/evidence/screenshots/desktop_1920.png" } },
      ],
      reviewProse: GENUINE_HUMAN_REVIEW,
    });
    expect(resMissingMobile.passed).toBe(false);
    const missingMobileFinding = resMissingMobile.findings.find(
      (f) => f.code === "MISSING_VIEWPORT_INSPECTION" && f.details?.missingViewport === "mobile",
    );
    expect(missingMobileFinding).toBeDefined();

    // Duplicate calls on same file (does not satisfy 4 viewports)
    const resDuplicates = checkOpticalDoctor({
      toolCalls: [
        { tool: "view_file", args: { AbsolutePath: "/evidence/screenshots/mobile_390.png" } },
        { tool: "view_file", args: { AbsolutePath: "/evidence/screenshots/mobile_390.png" } },
        { tool: "view_file", args: { AbsolutePath: "/evidence/screenshots/mobile_390.png" } },
        { tool: "view_file", args: { AbsolutePath: "/evidence/screenshots/mobile_390.png" } },
      ],
      reviewProse: GENUINE_HUMAN_REVIEW,
    });
    expect(resDuplicates.passed).toBe(false);
    expect(
      resDuplicates.findings.filter((f) => f.code === "MISSING_VIEWPORT_INSPECTION").length,
    ).toBeGreaterThanOrEqual(3);
  });

  test("enforces substantive word count floor and rejects markdown code fence padding", () => {
    // Too short (< 250 words)
    const shortProse =
      "The mobile, tablet, and desktop screens look completely fine and ready to ship.";
    const resShort = checkOpticalDoctor({
      toolCalls: VALID_TOOL_CALLS,
      reviewProse: shortProse,
    });
    expect(resShort.passed).toBe(false);
    expect(resShort.findings.some((f) => f.code === "INSUFFICIENT_CRITIQUE_DEPTH")).toBe(true);

    // Padded with markdown code fence (code dump padding attack)
    const codeDump = "```typescript\n" + "const x = 1;\n".repeat(80) + "```\n";
    const paddedProse = shortProse + "\n\n" + codeDump;
    const resPadded = checkOpticalDoctor({
      toolCalls: VALID_TOOL_CALLS,
      reviewProse: paddedProse,
    });
    expect(resPadded.passed).toBe(false);
    expect(resPadded.findings.some((f) => f.code === "INSUFFICIENT_CRITIQUE_DEPTH")).toBe(true);

    // Degenerate single-word repetition loop (e.g. 260 repetitions of 'pass')
    const degenerateLoop = ("pass ".repeat(260) + "mobile tablet desktop 1440 390 768").trim();
    const resDegenerate = checkOpticalDoctor({
      toolCalls: VALID_TOOL_CALLS,
      reviewProse: degenerateLoop,
    });
    expect(resDegenerate.passed).toBe(false);
    expect(resDegenerate.findings.some((f) => f.code === "DEGENERATE_REPETITION_DETECTED")).toBe(
      true,
    );
  });

  test("flags empty or corrupt screenshot files (< 1024 bytes)", () => {
    const resEmptyPng = checkOpticalDoctor({
      toolCalls: VALID_TOOL_CALLS,
      reviewProse: GENUINE_HUMAN_REVIEW,
      screenshotFileSizes: {
        "/evidence/screenshots/mobile_390.png": 0,
        "/evidence/screenshots/tablet_768.png": 512,
        "/evidence/screenshots/desktop_1440.png": 45000,
        "/evidence/screenshots/desktop_1920.png": 50000,
      },
    });

    expect(resEmptyPng.passed).toBe(false);
    const corruptFindings = resEmptyPng.findings.filter(
      (f) => f.code === "SCREENSHOT_PAYLOAD_EMPTY_OR_CORRUPT",
    );
    expect(corruptFindings).toHaveLength(2);
  });

  test("guarantees ZERO false positives on genuine conversational design vocabulary", () => {
    const conversationalProse = `
The primary action button lacks adequate touch target clearance on mobile, crowding awkwardly against the navigation bar.
Visual contrast between the muted subtitle and dark card background is slightly strained, but layout hierarchy remains clear.
The vertical axis of the form feels unbalanced due to excessive top padding.
Optical spacing between the secondary input fields feels proportional and well-weighted across desktop screens.
`;
    const findings = detectSuperficialChecklists(conversationalProse);
    expect(findings).toHaveLength(0);
  });

  test("flags deficient narrative coverage when review skips mobile, tablet, or desktop", () => {
    const desktopOnlyProse = GENUINE_HUMAN_REVIEW.replace(
      /mobile|390px|phone/gi,
      "container",
    ).replace(/tablet|768px|ipad/gi, "section");

    const defects = detectViewportReviewDefects({
      toolCalls: VALID_TOOL_CALLS,
      reviewProse: desktopOnlyProse,
    });

    expect(defects.some((f) => f.code === "DEFICIENT_VIEWPORT_COVERAGE")).toBe(true);
  });

  test("verifies path normalization across Windows backslashes and case differences", () => {
    const windowsToolCalls: readonly OpticalReviewToolCall[] = [
      { tool: "view_file", args: { AbsolutePath: "C:\\Evidence\\Screenshots\\Mobile_390.PNG" } },
      { tool: "view_file", args: { AbsolutePath: "C:\\Evidence\\Screenshots\\Tablet_768.PNG" } },
      { tool: "view_file", args: { AbsolutePath: "C:\\Evidence\\Screenshots\\Desktop_1440.PNG" } },
      { tool: "view_file", args: { AbsolutePath: "C:\\Evidence\\Screenshots\\Desktop_1920.PNG" } },
    ];

    const result = checkOpticalDoctor({
      toolCalls: windowsToolCalls,
      reviewProse: GENUINE_HUMAN_REVIEW,
    });

    expect(result.findings.filter((f) => f.code === "MISSING_VIEWPORT_INSPECTION")).toHaveLength(0);
    expect(result.passed).toBe(true);
  });
});
