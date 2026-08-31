import type { CoordinatorPushbackInput } from "../../../olt/scripts/src/task/pushback.ts";

export function createSamplePushbackInput(
  overrides: Partial<CoordinatorPushbackInput> = {},
): CoordinatorPushbackInput {
  return {
    taskId: "task-pushback-sample",
    validatorId: "validator-domain-01",
    validatorDomain: "tests",
    cause: "procedural",
    observation: "Missing unit test assertions for error paths",
    remediation: "Add boundary test assertions for invalid arguments",
    ...overrides,
  };
}
