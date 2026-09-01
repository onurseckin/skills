/**
 * @file meta-fixture.ts
 * In-memory virtual fixtures and test helpers for Meta Auditor & Planted Audit Suites
 */

export interface MindPlantedFixture {
  readonly repo: string;
  readonly run: string;
  readonly charterPath: string;
  readonly charterSha: string;
}

export class PlantedAuditHarness {
  public createCapsule(
    name: string,
    _overrides: {
      readonly charterGoals?: string[];
      readonly charterContent?: string;
      readonly budget?: Record<string, unknown>;
      readonly registerAuditorAgent?: boolean;
      readonly registerMindAgent?: boolean;
    } = {},
  ): MindPlantedFixture {
    const repo = `${process.cwd()}/.olt/virtual-planted-audit-${name}`;
    const run = `${repo}/.olt/capsules/planted-run-${name}`;
    const charterPath = `${repo}/olt/agents/mind.yaml`;
    const charterSha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    return { repo, run, charterPath, charterSha };
  }

  public cleanup(): void {
    // Zero disk allocations to clean up in in-memory mode
  }
}
