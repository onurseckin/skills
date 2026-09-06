import { describe, expect, test } from "bun:test";
import {
  ECOSYSTEM_31_ROLES,
  validateDomChannel,
  validateVisualChannel,
  validateDualChannel,
  get31AgentEcosystem,
  type DomElementSnapshot,
} from "../../olt/scripts/src/mind/implement-dual-channel-ui-validation-system-full-31-agent-ecosystem-overhaul-fb-1788281631793-qnza5.ts";

describe("Dual-Channel UI Validation System & Full 31-Agent Ecosystem", () => {
  test("defines exactly 31 roles in the ecosystem", () => {
    expect(ECOSYSTEM_31_ROLES.length).toBe(31);
    const ecosystem = get31AgentEcosystem();
    expect(ecosystem.length).toBe(31);
    const mindDescriptor = ecosystem.find((e) => e.role === "mind");
    expect(mindDescriptor !== undefined).toBe(true);
    if (mindDescriptor) {
      expect(mindDescriptor.category).toBe("supervisor");
      expect(mindDescriptor.tier).toBe(1);
    }
  });

  test("validates DOM channel with visible elements cleanly", () => {
    const snapshots: readonly DomElementSnapshot[] = [
      { tagName: "div", id: "app", classes: ["container"], visible: true },
      { tagName: "button", id: "btn-submit", classes: ["primary"], visible: true },
    ];
    const domVerdict = validateDomChannel(snapshots);
    expect(domVerdict.valid).toBe(true);
    expect(domVerdict.elementCount).toBe(2);
    expect(domVerdict.issues.length).toBe(0);
  });

  test("flags DOM channel issues when elements are empty or all hidden", () => {
    const emptyVerdict = validateDomChannel([]);
    expect(emptyVerdict.valid).toBe(false);
    expect(emptyVerdict.issues.length).toBeGreaterThan(0);

    const hiddenSnapshots: readonly DomElementSnapshot[] = [
      { tagName: "div", classes: ["hidden"], visible: false },
    ];
    const hiddenVerdict = validateDomChannel(hiddenSnapshots);
    expect(hiddenVerdict.valid).toBe(false);
  });

  test("validates visual channel against WCAG AA contrast and CLS", () => {
    const passingVisual = validateVisualChannel(7.0, 0.02, 92);
    expect(passingVisual.valid).toBe(true);
    expect(passingVisual.issues.length).toBe(0);

    const failingVisual = validateVisualChannel(3.2, 0.25, 55);
    expect(failingVisual.valid).toBe(false);
    expect(failingVisual.issues.length).toBe(3);
  });

  test("computes dual channel composite verdict correctly", () => {
    const snapshots: readonly DomElementSnapshot[] = [
      { tagName: "main", classes: ["content"], visible: true },
    ];
    const dualResult = validateDualChannel(snapshots, {
      contrastRatio: 6.0,
      layoutShift: 0.01,
      aestheticScore: 84,
    });
    expect(dualResult.valid).toBe(true);
    expect(dualResult.compositeScore).toBeGreaterThan(50);
  });
});
