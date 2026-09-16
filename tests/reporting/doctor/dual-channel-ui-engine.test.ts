import { describe, expect, test } from "bun:test";
import {
  checkDualChannelUi,
  type DualChannelUiCheckOptions,
} from "../../../olt/scripts/src/reporting/doctor/dual-channel-ui-engine.ts";

describe("Doctor UI Engine Sentinel: checkDualChannelUi", () => {
  test("passes cleanly on non-UI tasks without dual-channel requirements", () => {
    const options: DualChannelUiCheckOptions = {
      tasks: {
        "task-backend-1": {
          id: "task-backend-1",
          status: "done",
          write_scope: ["src/backend/service.ts"],
          label: "Update user authentication service",
        },
      },
    };
    const result = checkDualChannelUi(options);
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  test("skips cancelled and abandoned UI tasks", () => {
    const options: DualChannelUiCheckOptions = {
      tasks: {
        "task-cancelled-ui": {
          id: "task-cancelled-ui",
          status: "cancelled",
          write_scope: ["src/ui/Button.tsx"],
          label: "Cancelled button component",
        },
        "task-abandoned-ui": {
          id: "task-abandoned-ui",
          status: "abandoned",
          write_scope: ["src/components/Modal.tsx"],
          label: "Abandoned modal",
        },
      },
    };
    const result = checkDualChannelUi(options);
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  test("emits UI_MISSING_DUAL_CHANNEL_VALIDATION when both headless and optical validation are missing", () => {
    const options: DualChannelUiCheckOptions = {
      tasks: {
        "task-ui-unvalidated": {
          id: "task-ui-unvalidated",
          status: "submitted",
          write_scope: ["src/ui/Header.tsx"],
          label: "Build responsive navigation header",
        },
      },
    };
    const result = checkDualChannelUi(options);
    expect(result.passed).toBe(false);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.code).toBe("UI_MISSING_DUAL_CHANNEL_VALIDATION");
    expect(finding.severity).toBe("ERROR");
    expect(finding.engine).toBe("checkDualChannelUi");
    expect(finding.message).toContain("task-ui-unvalidated");
  });

  test("emits UI_MISSING_OPTICAL_VALIDATOR when UI task has passed headless tests but lacks optical review artifact", () => {
    const options: DualChannelUiCheckOptions = {
      tasks: {
        "task-ui-headless-only": {
          id: "task-ui-headless-only",
          status: "validated",
          write_scope: ["src/components/Sidebar.tsx"],
          label: "Implement collapsible sidebar",
          headless_passed: true,
          screenshots: [{ path: "/screenshots/sidebar-desktop.png", bytes: 45000 }],
        },
      },
    };
    const result = checkDualChannelUi(options);
    expect(result.passed).toBe(false);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.code).toBe("UI_MISSING_OPTICAL_VALIDATOR");
    expect(finding.severity).toBe("ERROR");
    expect(finding.engine).toBe("checkDualChannelUi");
    expect(finding.message).toContain(
      "passed headless tests but lacks an optical visual review report artifact",
    );
  });

  test("emits UI_MISSING_HEADLESS_VALIDATOR when optical review exists but headless tests are missing", () => {
    const options: DualChannelUiCheckOptions = {
      tasks: {
        "task-ui-optical-only": {
          id: "task-ui-optical-only",
          status: "validated",
          write_scope: ["src/ui/Card.tsx"],
          label: "Style interactive metric card",
          optical_report: "reports/task-ui-optical-only-optical.md",
        },
      },
    };
    const result = checkDualChannelUi(options);
    expect(result.passed).toBe(false);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.code).toBe("UI_MISSING_HEADLESS_VALIDATOR");
    expect(finding.severity).toBe("ERROR");
  });

  test("passes when both Channel 1 (headless tests) and Channel 2 (optical visual review artifact) are satisfied", () => {
    const options: DualChannelUiCheckOptions = {
      tasks: {
        "task-ui-compliant": {
          id: "task-ui-compliant",
          status: "validated",
          write_scope: ["src/ui/Dashboard.tsx"],
          label: "Primary operations dashboard",
          headless_passed: true,
          optical_report: "reports/task-ui-compliant-visual.md",
          screenshots: [{ path: "/screenshots/dash.png", bytes: 50000 }],
        },
      },
    };
    const result = checkDualChannelUi(options);
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  test("recognizes optical report from options.artifacts list", () => {
    const options: DualChannelUiCheckOptions = {
      tasks: {
        "task-ui-art": {
          id: "task-ui-art",
          status: "done",
          write_scope: ["src/views/Settings.tsx"],
          headless_passed: true,
        },
      },
      artifacts: ["/evidence/reports/task-ui-art-optical-review.md"],
    };
    const result = checkDualChannelUi(options);
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  test("preserves WCAG theme contrast evaluation alongside DAG task auditing", () => {
    const options: DualChannelUiCheckOptions = {
      themeElements: [
        {
          selector: ".low-contrast-button",
          theme: "dark",
          foregroundColor: "#777777",
          backgroundColor: "#666666",
        },
      ],
      tasks: {
        "task-ui-ok": {
          id: "task-ui-ok",
          status: "done",
          write_scope: ["src/ui/Form.tsx"],
          headless_passed: true,
          optical_passed: true,
        },
      },
    };
    const result = checkDualChannelUi(options);
    expect(result.passed).toBe(false);
    const contrastFinding = result.findings.find((f) => f.code === "DUAL_CHANNEL_CONTRAST_DEFECT");
    expect(contrastFinding).toBeDefined();
  });

  test("rejects mock optical reports placed in scratch/ or tmp/ paths", () => {
    const options: DualChannelUiCheckOptions = {
      tasks: {
        "task-ui-scratch-evasion": {
          id: "task-ui-scratch-evasion",
          status: "validated",
          write_scope: ["src/ui/Profile.tsx"],
          label: "User profile screen",
          headless_passed: true,
          optical_report: "scratch/mock-optical.md",
        },
      },
      artifacts: [
        "/tmp/task-ui-scratch-evasion-optical.md",
        "scratch/task-ui-scratch-evasion-review.md",
      ],
    };
    const result = checkDualChannelUi(options);
    expect(result.passed).toBe(false);
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.code).toBe("UI_MISSING_OPTICAL_VALIDATOR");
    expect(finding.severity).toBe("ERROR");
  });

  test("assertDualUiGateApproval rejects default fallback critique and superficial summaries", async () => {
    const { assertDualUiGateApproval } =
      await import("../../../olt/scripts/src/cli/commands/task-review-helpers.ts");

    expect(() =>
      assertDualUiGateApproval(
        "task-ui-fallback",
        true,
        {
          touchTargets: [{ selector: "button.cta", width: 48, height: 48 }],
          overflowElements: [{ selector: "main", scrollWidth: 390, clientWidth: 390 }],
        },
        {
          critique: "Visual qualitative inspection completed.",
          canExecuteShell: false,
        },
      ),
    ).toThrow("Validator critique is a default fallback or superficial summary");

    expect(() =>
      assertDualUiGateApproval(
        "task-ui-short",
        true,
        {
          touchTargets: [{ selector: "button.cta", width: 48, height: 48 }],
        },
        {
          critique: "too short",
          canExecuteShell: false,
        },
      ),
    ).toThrow("Validator critique is a default fallback or superficial summary");
  });
});
