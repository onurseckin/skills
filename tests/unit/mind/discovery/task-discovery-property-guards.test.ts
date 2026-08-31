import { describe, expect, it } from "bun:test";
import {
  filterOpenDefects,
  isDefectEntry,
  mapDefectToDiscoveryItem,
} from "../../../../olt/scripts/src/mind/tasks/discovery/index.ts";
import type { DefectEntry } from "../../../../olt/scripts/src/mind/defects/index.ts";

describe("Defect Remediation Property Guards & Prescribed Remediation", () => {
  it("handles DefectEntry with optional observation and prescribed_remediation fallback in mapDefectToDiscoveryItem", () => {
    const defectWithPrescribedRem: DefectEntry = {
      id: "defect-custom-2026",
      status: "open",
      category: "boundary_violation",
      severity: "high",
      description: "Custom boundary violation without observation field",
      prescribed_remediation: "Apply strict boundary assertions and isolation",
    };

    expect(isDefectEntry(defectWithPrescribedRem)).toBe(true);
    const item = mapDefectToDiscoveryItem(defectWithPrescribedRem);
    expect(item.id).toBe("defect-defect-custom-2026");
    expect(item.category).toBe("DEFECT_REMEDIATION");
    expect(item.title).toContain("Custom boundary violation");
    expect(item.description).toBe("Custom boundary violation without observation field");
    expect(item.remediation).toBe("Apply strict boundary assertions and isolation");
    expect(item.charterGoals).toEqual(["G1"]);
  });

  it("handles DefectEntry with missing observation, missing description, and missing remediation gracefully", () => {
    const bareDefect: DefectEntry = {
      id: "defect-bare-minimal",
      status: "open",
    };

    const item = mapDefectToDiscoveryItem(bareDefect);
    expect(item.id).toBe("defect-defect-bare-minimal");
    expect(item.description).toBe("Unspecified defect");
    expect(item.remediation).toBe("Fix root cause of defect");
  });

  it("filters open defects accurately across statuses", () => {
    const defects: DefectEntry[] = [
      { id: "d1", status: "open" },
      { id: "d2", status: "reopened" },
      { id: "d3", status: "in_progress" },
      { id: "d4", status: "resolved" },
      { id: "d5", status: "closed" },
      { id: "d6", status: "declined" },
    ];

    const openOnly = filterOpenDefects(defects);
    expect(openOnly.length).toBe(3);
    expect(openOnly.map((d) => d.id)).toEqual(["d1", "d2", "d3"]);
  });
});
