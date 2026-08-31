import { describe, expect, test } from "bun:test";
import {
  computeLcaDirectory,
  partitionFindingsIntoScopes,
  type FindingDetail,
} from "../../olt/scripts/src/workflow/scope-partitioner.ts";
import { analyzeScopeIndependence } from "../../olt/scripts/src/graph/scope-analyzer.ts";

describe("Scope Partitioner Algorithm", () => {
  describe("computeLcaDirectory", () => {
    test("returns '.' for empty paths", () => {
      expect(computeLcaDirectory([])).toBe(".");
    });

    test("returns parent directory for a single file path", () => {
      expect(computeLcaDirectory(["src/components/Drawer/Drawer.tsx"])).toBe(
        "src/components/Drawer",
      );
      expect(computeLcaDirectory(["package.json"])).toBe("package.json");
    });

    test("returns shared LCA directory for multiple files in same folder", () => {
      expect(
        computeLcaDirectory(["src/engine/layout/hierarchical.ts", "src/engine/layout/clamping.ts"]),
      ).toBe("src/engine/layout");
    });

    test("returns common ancestor directory for sibling directories", () => {
      expect(
        computeLcaDirectory(["src/components/Drawer/Drawer.tsx", "src/components/Modal/Modal.tsx"]),
      ).toBe("src/components");
    });
  });

  describe("partitionFindingsIntoScopes", () => {
    test("returns empty array for empty findings", () => {
      expect(partitionFindingsIntoScopes([])).toEqual([]);
    });

    test("partitions disjoint findings into distinct repair clusters", () => {
      const findings: FindingDetail[] = [
        {
          id: "F-DRAWER-01",
          severity: "critical",
          file_paths: ["src/components/EdgeDetailDrawer/EdgeDrawer.tsx"],
          observation: "TS2322 in drawer toggle handler",
          remediation: "Add onToggle to props",
        },
        {
          id: "F-LAYOUT-01",
          severity: "important",
          file_paths: ["src/engine/layout/hierarchical.ts"],
          observation: "Negative coordinate clamping bug",
          remediation: "Clamp coordinates to zero",
        },
      ];

      const clusters = partitionFindingsIntoScopes(findings, 1);
      expect(clusters).toHaveLength(2);

      const drawerCluster = clusters.find(
        (c) => c.taskId === "repair-R1-src-components-EdgeDetailDrawer",
      );
      const layoutCluster = clusters.find((c) => c.taskId === "repair-R1-src-engine-layout");

      expect(drawerCluster).toBeDefined();
      expect(drawerCluster?.writeScope).toEqual(["src/components/EdgeDetailDrawer"]);
      expect(drawerCluster?.findings).toHaveLength(1);
      expect(drawerCluster?.effort).toBe(2);

      expect(layoutCluster).toBeDefined();
      expect(layoutCluster?.writeScope).toEqual(["src/engine/layout"]);
      expect(layoutCluster?.findings).toHaveLength(1);
      expect(layoutCluster?.effort).toBe(2);

      // Verify that the resulting clusters have zero collisions in analyzeScopeIndependence
      const analysis = analyzeScopeIndependence(
        clusters.map((c) => ({
          taskId: c.taskId,
          writeScope: c.writeScope,
        })),
      );
      expect(analysis.collisions).toHaveLength(0);
    });

    test("merges parent-child overlapping scopes into parent scope", () => {
      const findings: FindingDetail[] = [
        {
          id: "F-PARENT-01",
          severity: "important",
          file_paths: ["src/components/Button.tsx"],
          observation: "Button variant missing",
          remediation: "Add secondary variant",
        },
        {
          id: "F-CHILD-01",
          severity: "critical",
          file_paths: ["src/components/EdgeDetailDrawer/EdgeDrawer.tsx"],
          observation: "Drawer type error",
          remediation: "Fix props",
        },
      ];

      const clusters = partitionFindingsIntoScopes(findings, 2);
      // Because src/components and src/components/EdgeDetailDrawer overlap, they must merge into src/components
      expect(clusters).toHaveLength(1);
      expect(clusters[0]!.taskId).toBe("repair-R2-src-components");
      expect(clusters[0]!.writeScope).toEqual(["src/components"]);
      expect(clusters[0]!.findings).toHaveLength(2);
      expect(clusters[0]!.effort).toBe(3);
    });

    test("handles root level files gracefully", () => {
      const findings: FindingDetail[] = [
        {
          id: "F-ROOT-01",
          severity: "critical",
          file_paths: ["package.json"],
          observation: "Dependency version mismatch",
          remediation: "Bump dependency",
        },
        {
          id: "F-CORE-01",
          severity: "important",
          file_paths: ["src/core/index.ts"],
          observation: "Missing export",
          remediation: "Export module",
        },
      ];

      const clusters = partitionFindingsIntoScopes(findings, 1);
      expect(clusters.length).toBeGreaterThanOrEqual(1);
      const analysis = analyzeScopeIndependence(
        clusters.map((c) => ({
          taskId: c.taskId,
          writeScope: c.writeScope,
        })),
      );
      expect(analysis.collisions).toHaveLength(0);
    });

    test("groups multiple findings with exact same LCA directory into a single cluster", () => {
      const findings: FindingDetail[] = [
        {
          id: "F-1",
          severity: "minor",
          file_paths: ["src/utils/a.ts"],
          observation: "obs 1",
          remediation: "rem 1",
        },
        {
          id: "F-2",
          severity: "minor",
          file_paths: ["src/utils/b.ts"],
          observation: "obs 2",
          remediation: "rem 2",
        },
      ];

      const clusters = partitionFindingsIntoScopes(findings, 1);
      expect(clusters).toHaveLength(1);
      expect(clusters[0]!.writeScope).toEqual(["src/utils"]);
      expect(clusters[0]!.findings).toHaveLength(2);
    });

    test("merges child scope when child is processed before parent scope", () => {
      const findings: FindingDetail[] = [
        {
          id: "F-CHILD",
          severity: "critical",
          file_paths: ["src/components/EdgeDetailDrawer/EdgeDrawer.tsx"],
          observation: "child obs",
          remediation: "child rem",
        },
        {
          id: "F-PARENT",
          severity: "important",
          file_paths: ["src/components/Button.tsx"],
          observation: "parent obs",
          remediation: "parent rem",
        },
      ];

      const clusters = partitionFindingsIntoScopes(findings, 1);
      expect(clusters).toHaveLength(1);
      expect(clusters[0]!.writeScope).toEqual(["src/components"]);
      expect(clusters[0]!.findings).toHaveLength(2);
    });
  });
});
