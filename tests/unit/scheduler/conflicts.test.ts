import { describe, expect, test } from "bun:test";
import {
  ownershipConflicts,
  scopeConflict,
} from "../../../orchestrating-long-tasks/scripts/src/scheduler/conflicts.ts";
import { proposeBatch } from "../../../orchestrating-long-tasks/scripts/src/scheduler/propose-batch.ts";
import { topologyState } from "./fixtures.ts";

describe("scope conflicts", () => {
  test("treats a scope as owning everything beneath it", () => {
    expect(scopeConflict(["src/a"], ["src/a/b"])).toBeTrue();
    expect(scopeConflict(["src/a/b"], ["src/a"])).toBeTrue();
    expect(scopeConflict(["src/a"], ["src/a"])).toBeTrue();
    expect(scopeConflict(["src/a"], ["src/b"])).toBeFalse();
    expect(scopeConflict(["src/a"], ["src/ab"])).toBeFalse();
  });

  test("resolves the glob scopes real capsules declare", () => {
    expect(scopeConflict(["docs/**"], ["docs/concepts/**"])).toBeTrue();
    expect(scopeConflict(["docs/concepts/**"], ["docs/**"])).toBeTrue();
    expect(scopeConflict([".capsules/**"], [".capsules/x"])).toBeTrue();
    expect(scopeConflict(["docs/**"], ["docs"])).toBeTrue();
    expect(scopeConflict(["docs/api/**"], ["docs/concepts/**"])).toBeFalse();
    expect(scopeConflict(["docs/**"], ["src/**"])).toBeFalse();
  });

  test("matches a single segment for * and any remainder for **", () => {
    expect(scopeConflict(["src/*/index.ts"], ["src/a/index.ts"])).toBeTrue();
    expect(scopeConflict(["src/*/index.ts"], ["src/a/main.ts"])).toBeFalse();
    expect(scopeConflict(["src/*"], ["src/a/b/c"])).toBeTrue();
    expect(scopeConflict(["src/**/index.ts"], ["src/a/b/index.ts"])).toBeTrue();
    expect(scopeConflict(["**"], ["anything/at/all"])).toBeTrue();
  });

  test("conflicts when any pair of listed scopes overlaps", () => {
    expect(scopeConflict(["src/a", "docs/**"], ["tests/**", "docs/concepts/guide.md"])).toBeTrue();
    expect(scopeConflict(["src/a"], [])).toBeFalse();
    expect(scopeConflict([], ["src/a"])).toBeFalse();
  });

  test("reports owners of overlapping globs as ownership conflicts", () => {
    const conflicts = ownershipConflicts(
      { id: "T-1", status: "leased", write_scope: ["docs/**"] },
      [
        { id: "T-2", status: "running", write_scope: ["docs/concepts/**"] },
        { id: "T-3", status: "running", write_scope: ["src/**"] },
        { id: "T-4", status: "done", write_scope: ["docs/api/**"] },
      ],
    );
    expect(conflicts).toEqual(["T-2"]);
  });
});

describe("sub-segment glob conflicts", () => {
  test("a glob inside a segment still names the files it matches", () => {
    expect(scopeConflict(["src/*.ts"], ["src/foo.ts"])).toBeTrue();
    expect(scopeConflict(["src/foo.ts"], ["src/*.ts"])).toBeTrue();
    expect(scopeConflict(["src/foo.*"], ["src/foo.ts"])).toBeTrue();
    expect(scopeConflict(["src/*-test.ts"], ["src/unit-test.ts"])).toBeTrue();
    expect(scopeConflict(["src/a*"], ["src/ab"])).toBeTrue();
    expect(scopeConflict(["docs/*/index.md"], ["docs/api/index.md"])).toBeTrue();
    expect(scopeConflict(["src/**/*.spec.ts"], ["src/a/b/queue.spec.ts"])).toBeTrue();
  });

  test("disjoint sub-segment globs stay disjoint", () => {
    expect(scopeConflict(["src/*.ts"], ["src/foo.md"])).toBeFalse();
    expect(scopeConflict(["src/*.ts"], ["src/*.tsx"])).toBeFalse();
    expect(scopeConflict(["src/a*"], ["src/b"])).toBeFalse();
    expect(scopeConflict(["src/*-test.ts"], ["src/unit-spec.ts"])).toBeFalse();
    expect(scopeConflict(["docs/*/index.md"], ["docs/api/guide.md"])).toBeFalse();
  });

  test("two sub-segment globs conflict when one string satisfies both", () => {
    expect(scopeConflict(["src/queue-*.ts"], ["src/*-formatter.ts"])).toBeTrue();
    expect(scopeConflict(["src/a*b"], ["src/b*a"])).toBeFalse();
  });

  test("overlapping sub-segment globs are reported as ownership conflicts", () => {
    const conflicts = ownershipConflicts(
      { id: "T-1", status: "leased", write_scope: ["src/*.ts"] },
      [
        { id: "T-2", status: "running", write_scope: ["src/foo.ts"] },
        { id: "T-3", status: "running", write_scope: ["src/foo.md"] },
      ],
    );
    expect(conflicts).toEqual(["T-2"]);
  });

  test("star-dense patterns terminate instead of exploding", () => {
    const started = Date.now();
    expect(
      scopeConflict(["src/a*a*a*a*a*a*a*a*a*b"], ["src/aaaaaaaaaaaaaaaaaaaaaaaaaaaa"]),
    ).toBeFalse();
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("retry_ready dispatch", () => {
  test("two released tasks with overlapping scopes do not veto each other", () => {
    const state = topologyState();
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    tasks["t-beta"]!.status = "retry_ready";
    tasks["t-beta-sub"]!.status = "retry_ready";

    // Nested scopes still serialize the pair, but one of them must still be dispatchable.
    const batch = proposeBatch(state, 4).map((task) => task.id);
    expect(batch).toEqual(["t-alpha", "t-beta"]);
  });

  test("a live lease still reserves the scope against a released task", () => {
    const state = topologyState();
    const tasks = state.tasks as Record<string, Record<string, unknown>>;
    tasks["t-beta"]!.status = "leased";
    tasks["t-beta-sub"]!.status = "retry_ready";

    expect(proposeBatch(state, 4).map((task) => task.id)).toEqual(["t-alpha"]);
  });
});
