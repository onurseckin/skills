import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import type { DefectEntry } from "../../../../olt/scripts/src/mind/defects/index.ts";
import {
  filterOpenDefects,
  isDefectEntry,
  mapCategoryToIssueType,
  mapDefectSeverityToDiscoverySeverity,
  mapDefectSeverityToPriority,
  mapDefectToDiscoveryItem,
  sanitizeSlug,
  scanDefectRemediations,
} from "../../../../olt/scripts/src/mind/tasks/discovery/scanners/remediation-scanner.ts";

describe("Remediation Scanner Engine (in-memory virtual)", () => {
  const virtualDir = `${process.cwd()}/.olt/virtual-remediation-scanner`;
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    mockDirs.add(virtualDir);

    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return mockFiles.has(s) || mockDirs.has(s);
      }),
    );

    spies.push(
      spyOn(fs, "readdirSync").mockImplementation((p: fs.PathLike, options?: unknown) => {
        const pathStr = String(p);
        const dirNames: string[] = [];
        for (const dir of mockDirs) {
          if (dir.startsWith(pathStr) && dir !== pathStr) {
            const top = dir.slice(pathStr.length).replace(/^\/+/, "").split("/")[0];
            if (top && !dirNames.includes(top)) dirNames.push(top);
          }
        }
        const fileNames: string[] = [];
        for (const file of mockFiles.keys()) {
          if (file.startsWith(pathStr)) {
            const top = file.slice(pathStr.length).replace(/^\/+/, "").split("/")[0];
            if (top && !dirNames.includes(top) && !fileNames.includes(top)) fileNames.push(top);
          }
        }
        const withFileTypes =
          typeof options === "object" &&
          options !== null &&
          Boolean((options as { withFileTypes?: boolean }).withFileTypes);
        if (withFileTypes) {
          return [
            ...dirNames.map((name) => ({ name, isDirectory: () => true, isFile: () => false })),
            ...fileNames.map((name) => ({ name, isDirectory: () => false, isFile: () => true })),
          ] as unknown as fs.Dirent[];
        }
        return [...dirNames, ...fileNames] as unknown as fs.Dirent[];
      }),
    );

    spies.push(
      spyOn(fs, "readFileSync").mockImplementation((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        const val = mockFiles.get(s);
        if (val !== undefined) return val;
        throw new Error(`ENOENT: no such file, open '${s}'`);
      }),
    );

    spies.push(
      spyOn(fs, "statSync").mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (mockDirs.has(s))
          return { isDirectory: () => true, isFile: () => false } as unknown as fs.Stats;
        if (mockFiles.has(s))
          return { isDirectory: () => false, isFile: () => true } as unknown as fs.Stats;
        return { isDirectory: () => false, isFile: () => false } as unknown as fs.Stats;
      }),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  const sampleOpenDefect: DefectEntry = {
    id: "defect-boundary-001",
    type: "main_thread_direct_execution",
    category: "boundary_violation",
    severity: "critical",
    status: "open",
    observation: "Interactive main thread modified source code directly",
    remediation: "Delegate all modifications to Tier 3 Implementers",
    timestamp: "2026-08-29T10:00:00.000Z",
    context: { file: "olt/scripts/src/engine.ts", line: 42 },
  };

  const sampleResolvedDefect: DefectEntry = {
    id: "defect-code-002",
    type: "implicit_any",
    category: "code_defect",
    severity: "high",
    status: "resolved",
    observation: "Implicit any in parser helper",
    remediation: "Add strict type annotations",
    timestamp: "2026-08-29T10:05:00.000Z",
    resolution: { task_id: "task-fix-any", test_assertion: "bun test" },
  };

  const sampleWontfixDefect: DefectEntry = {
    id: "defect-doc-003",
    type: "missing_doc",
    category: "documentation",
    severity: "low",
    status: "wontfix",
    observation: "Missing internal readme",
    remediation: "Document internal architecture",
    timestamp: "2026-08-29T10:10:00.000Z",
  };

  it("identifies valid DefectEntry objects and rejects invalid structures", () => {
    expect(isDefectEntry(sampleOpenDefect)).toBe(true);
    expect(isDefectEntry(sampleResolvedDefect)).toBe(true);
    expect(isDefectEntry(null)).toBe(false);
    expect(isDefectEntry(undefined)).toBe(false);
    expect(isDefectEntry("not-an-object")).toBe(false);
    expect(isDefectEntry(123)).toBe(false);
    expect(isDefectEntry({})).toBe(false);
    expect(isDefectEntry({ id: "d1" })).toBe(false);
    expect(isDefectEntry({ status: "open" })).toBe(false);
  });

  it("filters open defects excluding resolved and wontfix states", () => {
    const list: DefectEntry[] = [
      sampleOpenDefect,
      sampleResolvedDefect,
      sampleWontfixDefect,
      { ...sampleOpenDefect, id: "d-reopened", status: "reopened" },
      { ...sampleOpenDefect, id: "d-in-progress", status: "in_progress" },
      { ...sampleOpenDefect, id: "d-closed", status: "closed" },
      { ...sampleOpenDefect, id: "d-declined", status: "declined" },
    ];
    const openOnly = filterOpenDefects(list);
    expect(openOnly.length).toBe(3);
    expect(openOnly.map((d) => d.id)).toEqual([
      "defect-boundary-001",
      "d-reopened",
      "d-in-progress",
    ]);
  });

  it("maps defect severities to task priorities and discovery severities", () => {
    expect(mapDefectSeverityToPriority("critical")).toBe("CRITICAL");
    expect(mapDefectSeverityToPriority("high")).toBe("HIGH");
    expect(mapDefectSeverityToPriority("warning")).toBe("MEDIUM");
    expect(mapDefectSeverityToPriority("medium")).toBe("MEDIUM");
    expect(mapDefectSeverityToPriority("low")).toBe("LOW");
    expect(mapDefectSeverityToPriority("info")).toBe("BACKGROUND");
    expect(mapDefectSeverityToPriority(undefined)).toBe("HIGH");

    expect(mapDefectSeverityToDiscoverySeverity("critical")).toBe("CRITICAL");
    expect(mapDefectSeverityToDiscoverySeverity("high")).toBe("HIGH");
    expect(mapDefectSeverityToDiscoverySeverity("warning")).toBe("MEDIUM");
    expect(mapDefectSeverityToDiscoverySeverity("medium")).toBe("MEDIUM");
    expect(mapDefectSeverityToDiscoverySeverity("low")).toBe("LOW");
    expect(mapDefectSeverityToDiscoverySeverity("info")).toBe("BACKGROUND");
    expect(mapDefectSeverityToDiscoverySeverity(undefined)).toBe("HIGH");
  });

  it("maps defect categories to defect remediation issue types", () => {
    expect(mapCategoryToIssueType("boundary_violation")).toBe("BOUNDARY_VIOLATION");
    expect(mapCategoryToIssueType("model_reasoning_error")).toBe("MODEL_REASONING_ERROR");
    expect(mapCategoryToIssueType("code_defect")).toBe("CODE_DEFECT");
    expect(mapCategoryToIssueType("documentation")).toBe("DOCUMENTATION");
    expect(mapCategoryToIssueType("security_risk")).toBe("SECURITY_RISK");
    expect(mapCategoryToIssueType("modularity_violation")).toBe("MODULARITY_VIOLATION");
    expect(mapCategoryToIssueType("unknown_custom_category")).toBe("UNRESOLVED_DEFECT");
  });

  it("transforms DefectEntry into a canonical DiscoveryItem", () => {
    const item = mapDefectToDiscoveryItem(sampleOpenDefect);
    expect(item.id).toBe("defect-defect-boundary-001");
    expect(item.category).toBe("DEFECT_REMEDIATION");
    expect(item.priority).toBe("CRITICAL");
    expect(item.targetFiles).toEqual(["olt/scripts/src/mind/", "tests/mind/"]);
    expect(item.writeScope).toEqual(["olt/scripts/src/mind/", "tests/mind/"]);
    expect(item.charterGoals).toEqual(["G1"]);
    expect(item.sourceType).toBe("defect_remediation");
    expect(item.sourceReference).toBe("defect-boundary-001");
    expect(item.remediation).toBe("Delegate all modifications to Tier 3 Implementers");
  });

  it("scans defects from in-memory array with category filters and limits", () => {
    const defects: DefectEntry[] = [
      sampleOpenDefect,
      sampleResolvedDefect,
      sampleWontfixDefect,
      {
        id: "defect-sec-004",
        category: "security_risk",
        severity: "critical",
        status: "open",
        observation: "Unvalidated input in shell runner",
        remediation: "Sanitize arguments",
      },
    ];

    const resultAll = scanDefectRemediations({ defects });
    expect(resultAll.totalDefects).toBe(4);
    expect(resultAll.openDefects.length).toBe(2);
    expect(resultAll.resolvedDefects.length).toBe(1);
    expect(resultAll.findings.length).toBe(2);

    const f1 = resultAll.findings[0];
    expect(f1?.defectId).toBe("defect-boundary-001");
    expect(f1?.issueType).toBe("BOUNDARY_VIOLATION");

    const resultFiltered = scanDefectRemediations({
      defects,
      includeCategories: ["security_risk"],
    });
    expect(resultFiltered.findings.length).toBe(1);
    expect(resultFiltered.findings[0]?.defectId).toBe("defect-sec-004");

    const resultExcluded = scanDefectRemediations({
      defects,
      excludeCategories: ["boundary_violation"],
    });
    expect(resultExcluded.findings.length).toBe(1);
    expect(resultExcluded.findings[0]?.defectId).toBe("defect-sec-004");

    const resultLimited = scanDefectRemediations({ defects, maxFindings: 1 });
    expect(resultLimited.findings.length).toBe(1);

    const resultWithResolved = scanDefectRemediations({ defects, includeResolved: true });
    expect(resultWithResolved.findings.length).toBe(3);
  });

  it("scans defect records from capsule directory on disk", () => {
    const capsuleDir = join(virtualDir, "capsule-alpha");
    mockDirs.add(capsuleDir);

    const defectJsonl = [
      JSON.stringify(sampleOpenDefect),
      JSON.stringify(sampleResolvedDefect),
    ].join("\n");
    mockFiles.set(join(capsuleDir, "defects.jsonl"), `${defectJsonl}\n`);

    const result = scanDefectRemediations({ capsulesDir: capsuleDir });
    expect(result.totalDefects).toBe(2);
    expect(result.openDefects.length).toBe(1);
    expect(result.resolvedDefects.length).toBe(1);
    expect(result.findings.length).toBe(1);
    expect(result.findings[0]?.defectId).toBe("defect-boundary-001");
    expect(result.capsulesScanned).toContain(capsuleDir);
  });

  it("sanitizes slugs correctly", () => {
    expect(sanitizeSlug("Defect: Boundary-Violation #42")).toBe("defect-boundary-violation-42");
    expect(sanitizeSlug("---hello---world---")).toBe("hello-world");
  });

  it("verifies static invariants of pure functions", () => {
    expect(typeof filterOpenDefects).toBe("function");
    expect(typeof isDefectEntry).toBe("function");
    expect(typeof mapCategoryToIssueType).toBe("function");
    expect(typeof mapDefectSeverityToDiscoverySeverity).toBe("function");
    expect(typeof mapDefectSeverityToPriority).toBe("function");
    expect(typeof mapDefectToDiscoveryItem).toBe("function");
    expect(typeof sanitizeSlug).toBe("function");
    expect(typeof scanDefectRemediations).toBe("function");
  });
});
