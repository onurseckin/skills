import { describe, expect, it } from "bun:test";
import { repositoryEvidenceCommandIds } from "../../../olt/scripts/src/packets/critic-grant.ts";
import type { WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";

describe("Critic Role Grant & Repository Evidence Discovery", () => {
  it("returns empty command list when workflow state has no run gates", () => {
    const state: WorkflowState = {
      gates: [],
      commands: {},
      tasks: {},
      runs: {},
    } as unknown as WorkflowState;
    const commandIds = repositoryEvidenceCommandIds(state);
    expect(commandIds).toEqual([]);
  });
});
