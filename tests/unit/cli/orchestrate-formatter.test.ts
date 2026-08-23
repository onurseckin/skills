import { describe, expect, test } from "bun:test";
import { formatOrchestrateBrief } from "../../../olt/scripts/src/cli/formatters/index.ts";

describe("formatOrchestrateBrief", () => {
  test("reports a derived run id as derived and tells the caller how to pin it", () => {
    const md = formatOrchestrateBrief({
      runId: "run-abc123",
      runRoot: "/capsules/run-abc123",
      promptSha256: "a".repeat(64),
      promptBytes: 512,
      runIdWasDerived: true,
    });

    expect(md).toContain("### Orchestration Opened: run-abc123");
    expect(md).toContain("`/capsules/run-abc123`");
    expect(md).toContain(`\`${"a".repeat(64)}\` (512 bytes, captured verbatim)`);
    expect(md).toContain("derived from the prompt; pass `--run` next time to choose your own.");
    expect(md).not.toContain("the one you supplied");
  });

  test("reports a caller-supplied run id without the derivation note", () => {
    const md = formatOrchestrateBrief({
      runId: "my-run",
      runRoot: "/capsules/my-run",
      promptSha256: "b".repeat(64),
      promptBytes: 10,
      runIdWasDerived: false,
    });

    expect(md).toContain("- **Run id**: the one you supplied.");
    expect(md).not.toContain("derived from the prompt");
  });
});
