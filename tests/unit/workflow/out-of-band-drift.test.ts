import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import type { RepositoryGitCommand } from "../../../orchestrating-long-tasks/scripts/src/packets/repository-git-command.ts";
import {
  declaredWriteScopeUnion,
  outOfBandPaths,
} from "../../../orchestrating-long-tasks/scripts/src/workflow/submission/out-of-band-drift.ts";
import type { WorkflowState } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { inspection } from "../packets/inspection-fixture.ts";
import { workflowState } from "./test-port.ts";

const now = new Date("2026-08-13T12:31:00.000Z");

const gitReturning =
  (...lines: string[]): RepositoryGitCommand =>
  () => ({ status: 0, bytes: Buffer.from(lines.join("\n"), "utf8") });

function stateWithBaseline(overrides: Partial<WorkflowState> = {}): WorkflowState {
  const state = workflowState();
  const baseline = inspection("baseline");
  state.baseline_repository_inspection_sha256 = baseline.inspection_sha256;
  state.repository_inspections = { [baseline.inspection_sha256]: baseline };
  return { ...state, ...overrides };
}

describe("declaredWriteScopeUnion", () => {
  test("unions and dedupes every task's write_scope", () => {
    const state = workflowState();
    state.tasks["T-2"] = {
      ...state.tasks["T-1"]!,
      id: "T-2",
      write_scope: ["src/other", "src/owned"],
    };
    expect(declaredWriteScopeUnion(state.tasks)).toEqual(["src/owned", "src/other"]);
  });
});

describe("outOfBandPaths", () => {
  test("returns nothing when the run has no recorded baseline inspection", () => {
    const state = workflowState();
    expect(
      outOfBandPaths(state, now, () => {
        throw new Error("must not run git without a baseline");
      }),
    ).toEqual([]);
  });

  test("returns nothing when every changed path is covered by a declared write_scope", () => {
    const state = stateWithBaseline();
    const result = outOfBandPaths(
      state,
      now,
      gitReturning("src/owned/a.ts", "src/owned/nested/b.ts"),
    );
    expect(result).toEqual([]);
  });

  test("surfaces changed paths outside the union of every task's write_scope, sorted", () => {
    const state = stateWithBaseline();
    state.tasks["T-2"] = { ...state.tasks["T-1"]!, id: "T-2", write_scope: ["src/other"] };
    const result = outOfBandPaths(
      state,
      now,
      gitReturning("src/owned/a.ts", "unrelated/z.ts", "config/rogue.json"),
    );
    expect(result).toEqual(["config/rogue.json", "unrelated/z.ts"]);
  });

  test("returns nothing when the anchored read is unavailable", () => {
    const state = stateWithBaseline();
    const result = outOfBandPaths(state, now, () => {
      throw new HarnessError("INTEGRITY", "repository Git command failed: fatal: bad object");
    });
    expect(result).toEqual([]);
  });
});
