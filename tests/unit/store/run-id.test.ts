import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { normalizeRunId } from "../../../olt/scripts/src/engine/store/run-id.ts";

describe("normalizeRunId", () => {
  test("returns a bare run id unchanged", () => {
    expect(normalizeRunId("2026-08-20-fine-grained-curriculum-orchestration")).toBe(
      "2026-08-20-fine-grained-curriculum-orchestration",
    );
  });

  test("strips exactly one leading .capsules/ prefix, the documented form every other command uses", () => {
    expect(normalizeRunId(".olt/capsules/2026-08-20-fine-grained-curriculum-orchestration")).toBe(
      "2026-08-20-fine-grained-curriculum-orchestration",
    );
  });

  test("trims surrounding whitespace before checking for the prefix", () => {
    expect(normalizeRunId("  .capsules/my-run  ")).toBe("my-run");
  });

  test("rejects a value that still contains a path separator after stripping the one prefix", () => {
    // This is the exact shape the forensics run produced: a run id built by joining an
    // already-prefixed `.capsules/<run-id>` argument onto `.capsules/` a second time would have
    // been caught here, at the point that would otherwise perform that join.
    expect(() => normalizeRunId(".olt/capsules/.capsules/2026-08-20-run")).toThrow(HarnessError);
    expect(() => normalizeRunId(".olt/capsules/.capsules/2026-08-20-run")).toThrow(/run_id/i);
  });

  test("rejects a bare value containing a path separator with no .capsules/ prefix involved", () => {
    expect(() => normalizeRunId("sub/dir")).toThrow(/run_id/i);
  });

  test("rejects blank input", () => {
    expect(() => normalizeRunId("")).toThrow(/run_id/i);
    expect(() => normalizeRunId("   ")).toThrow(/run_id/i);
  });

  test("rejects a value that is only the prefix, leaving nothing after it", () => {
    expect(() => normalizeRunId(".capsules/")).toThrow(/run_id/i);
  });
});
