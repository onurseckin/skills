import { describe, expect, it } from "bun:test";
import { evaluateDualUiGates } from "../../../olt/scripts/src/validation/ui/dual-gate-engine.ts";

describe("dual-gate-engine coverage", () => {
  it("bypasses dual UI validation for non-UI tasks cleanly", () => {
    const res = evaluateDualUiGates({ isUiTask: false });
    expect(res.isUiTask).toBe(false);
    expect(res.passed).toBe(true);
    expect(res.mode).toBe("non_ui_skipped");
    expect(res.defects).toEqual([]);
    expect(res.summary).toContain("Dual UI validation bypassed");
    expect(res.mechanicReport.passed).toBe(true);
    expect(res.cognitiveReport.passed).toBe(true);
  });

  it("passes and corroborates when Gate 1 (Mechanic) and Gate 2 (Cognitive) both succeed", () => {
    const res = evaluateDualUiGates({
      isUiTask: true,
      mechanicInput: {
        taskId: "ui-task-1",
        touchTargets: [{ selector: "button.submit", width: 48, height: 48 }],
        overflowElements: [{ selector: ".container", scrollWidth: 390, clientWidth: 390 }],
      },
      cognitiveInput: {
        critique: "The layout demonstrates clear visual hierarchy and balanced spacing rhythm.",
        hierarchyElements: [
          { selector: "h1", tag: "h1", fontSize: 24, fontWeight: 700 },
          { selector: "h2", tag: "h2", fontSize: 18, fontWeight: 600 },
        ],
        spacingElements: [{ selector: ".card", margin: 16, padding: 8 }],
      },
    });

    expect(res.isUiTask).toBe(true);
    expect(res.passed).toBe(true);
    expect(res.mode).toBe("dual_ui_corroborated");
    expect(res.defects.length).toBe(0);
    expect(res.summary).toContain("Dual UI Validation passed");
  });

  it("maps all mechanical defects (touch hitbox, overflow, missing viewports, lifecycle, journeys)", () => {
    const res = evaluateDualUiGates({
      isUiTask: true,
      mechanicInput: {
        requireAllViewports: true,
        viewports: ["mobile", "tablet", "desktop", "desktop-wide"],
        touchTargets: [{ selector: "a.nav-link", width: 30, height: 30 }],
        overflowElements: [
          { selector: "table.grid", scrollWidth: 600, clientWidth: 390, viewport: "mobile" },
        ],
        lifecycleInvariants: {
          fontsReady: false,
          networkIdle: false,
          layoutQuiet: false,
          freshContextPerViewport: false,
          hydrationComplete: false,
        },
        journeys: [
          {
            name: "checkout flow",
            viewport: "mobile",
            passed: false,
            durationMs: 400,
            error: "Timed out after 5000ms",
          },
          { name: "guest checkout", viewport: "tablet", passed: false, durationMs: 250 },
        ],
      },
      cognitiveInput: {
        critique:
          "The optical scale exhibits clear heading hierarchy across the entire visual layout.",
      },
    });

    expect(res.passed).toBe(false);
    expect(res.mode).toBe("cognitive_only");

    const mechDefects = res.defects.filter((d) => d.pillar === "mechanical");
    expect(mechDefects.length).toBeGreaterThanOrEqual(10);

    const touchDefect = mechDefects.find((d) => d.category === "touch-hitbox");
    expect(touchDefect?.id).toBe("ui-mech-touch-a-nav-link");
    expect(touchDefect?.severity).toBe("important");
    expect(touchDefect?.remediation).toContain(">= 44x44pt");

    const overflowDefect = mechDefects.find((d) => d.category === "horizontal-overflow");
    expect(overflowDefect?.id).toBe("ui-mech-overflow-table-grid");
    expect(overflowDefect?.severity).toBe("critical");
    expect(overflowDefect?.remediation).toContain("Prevent horizontal overflow on viewport mobile");

    const missingVpDefect = mechDefects.find((d) => d.id === "ui-mech-missing-viewport-desktop");
    expect(missingVpDefect?.category).toBe("viewport-matrix");
    expect(missingVpDefect?.severity).toBe("critical");
    expect(missingVpDefect?.message).toContain(
      "Missing required canonical viewport tier 'desktop'",
    );

    const lifecycleDefects = mechDefects.filter((d) => d.category === "browser-lifecycle");
    expect(lifecycleDefects.length).toBe(5);
    expect(lifecycleDefects[0]?.id).toBe("ui-mech-lifecycle-violation");
    expect(lifecycleDefects[0]?.severity).toBe("critical");

    const journeyDefectWithError = mechDefects.find(
      (d) => d.id === "ui-mech-journey-checkout-flow",
    );
    expect(journeyDefectWithError?.message).toContain(
      "failed on viewport 'mobile': Timed out after 5000ms",
    );
    expect(journeyDefectWithError?.remediation).toContain(
      "Fix failing Playwright user journey 'checkout flow'",
    );

    const journeyDefectWithoutError = mechDefects.find(
      (d) => d.id === "ui-mech-journey-guest-checkout",
    );
    expect(journeyDefectWithoutError?.message).toBe(
      "Playwright user journey 'guest checkout' failed on viewport 'tablet'",
    );
  });

  it("maps all cognitive defects (shell hardlock, superficial, descender, hierarchy, harmony)", () => {
    const res = evaluateDualUiGates({
      isUiTask: true,
      mechanicInput: {
        taskId: "ui-task-valid",
        touchTargets: [{ selector: "button.ok", width: 44, height: 44 }],
        overflowElements: [{ selector: ".main", scrollWidth: 390, clientWidth: 390 }],
      },
      cognitiveInput: {
        canExecuteShell: true,
        attemptedShellCommands: ["bash -c 'ls -la'"],
        critique: "looks good",
        textElements: [
          {
            selector: "p.desc",
            text: "happy typing jump",
            fontSize: 18,
            lineHeight: 12,
            paddingBottom: 0,
            overflowClipped: true,
          },
        ],
        hierarchyElements: [
          { selector: "h1.sub", tag: "h1", fontSize: 12, fontWeight: 400 },
          { selector: "h2.main", tag: "h2", fontSize: 28, fontWeight: 700 },
        ],
        spacingElements: [{ selector: "div.irregular", margin: 13, padding: 7 }],
      },
    });

    expect(res.passed).toBe(false);
    expect(res.mode).toBe("mechanic_only");

    const cogDefects = res.defects.filter((d) => d.pillar === "cognitive");
    expect(cogDefects.length).toBeGreaterThanOrEqual(5);

    const shellDefects = cogDefects.filter((d) => d.category === "shell-command-hardlock");
    expect(shellDefects.length).toBe(2);
    expect(shellDefects[0]?.id).toBe("ui-cog-shell-hardlock");
    expect(shellDefects[0]?.severity).toBe("critical");
    expect(shellDefects[0]?.remediation).toContain("must execute 0 shell commands");

    const superficialDefect = cogDefects.find((d) => d.category === "superficial-critique");
    expect(superficialDefect?.id).toBe("ui-cog-superficial-critique");
    expect(superficialDefect?.severity).toBe("important");

    const descenderDefect = cogDefects.find((d) => d.category === "descender-integrity");
    expect(descenderDefect?.id).toBe("ui-cog-descender-clipping");
    expect(descenderDefect?.remediation).toContain("Adjust line-height or bottom padding");

    const hierarchyDefect = cogDefects.find((d) => d.category === "optical-hierarchy");
    expect(hierarchyDefect?.id).toBe("ui-cog-optical-hierarchy");
    expect(hierarchyDefect?.remediation).toContain("Restore progressive optical scale hierarchy");

    const harmonyDefect = cogDefects.find((d) => d.category === "aesthetic-harmony");
    expect(harmonyDefect?.id).toBe("ui-cog-aesthetic-harmony");
    expect(harmonyDefect?.remediation).toContain("4pt/8pt harmonic grid");
  });

  it("yields rejected mode and combined summary when both mechanic and cognitive gates fail", () => {
    const res = evaluateDualUiGates({
      isUiTask: true,
      mechanicInput: {
        touchTargets: [{ selector: "button.small", width: 20, height: 20 }],
      },
      cognitiveInput: {
        critique: "LGTM",
      },
    });

    expect(res.passed).toBe(false);
    expect(res.mode).toBe("rejected");
    expect(res.summary).toContain("Dual UI Validation failed [mode: rejected]:");
    expect(res.summary).toContain("[mechanical]");
    expect(res.summary).toContain("[cognitive]");
  });

  it("handles undefined mechanicInput and cognitiveInput gracefully", () => {
    const res = evaluateDualUiGates({ isUiTask: true });
    expect(res.isUiTask).toBe(true);
    expect(res.passed).toBe(false);
    expect(res.cognitiveReport.isSuperficial).toBe(true);
  });
});
