import type { PreEnhancementTaskInput } from "../../../olt/scripts/src/plan/pre-enhancer.ts";

export function createSampleTaskInput(
  overrides: Partial<PreEnhancementTaskInput> = {},
): PreEnhancementTaskInput {
  return {
    taskId: "task-p74-proactive-plan-pre-enhancer",
    label: "Proactive Plan Pre-Enhancer & Discriminating Gate Compiler",
    writeScope: ["olt/scripts/src/plan/pre-enhancer.ts", "tests/plan/pre-enhancer/pre-enhancer-core.test.ts"],
    dependencies: ["task-p72-hyper-active-mind-cognition"],
    gateCommand: "bun test tests/plan/pre-enhancer/pre-enhancer-core.test.ts",
    effort: 3,
    priority: 50,
    requirementIds: ["req-track2"],
    description:
      "Pre-compile discriminating unit test assertions and clean AST boundaries before task claim",
    ...overrides,
  };
}

export function createCleanTypeScriptCode(): string {
  return `
    export interface UserProfile {
      readonly id: string;
      readonly active: boolean;
    }
    export function validateProfile(profile: UserProfile): boolean {
      if (profile.id.length === 0) {
        return false;
      }
      return profile.active;
    }
  `;
}
