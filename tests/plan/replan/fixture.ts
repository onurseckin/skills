export function createSampleFinding(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "F-01",
    severity: "critical",
    observation: "Toggle handler drops its callback",
    remediation: "Restore the callback",
    file_paths: ["src/components/EdgeDrawer.tsx"],
    ...overrides,
  };
}

export function createSampleOpenTaskFinding(): Record<string, unknown> {
  return {
    id: "F-VALIDATOR-01",
    requirement_id: "R-9",
    severity: "important",
    observation: "Validator rejected: missing null check",
    remediation: "Add the null check",
    revalidation: "bun gate-t1.ts",
    status: "open",
  };
}
