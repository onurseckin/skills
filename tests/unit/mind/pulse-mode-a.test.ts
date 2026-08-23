import { describe, it, expect } from "bun:test";
import { formatPulseDirective } from "../../../olt/scripts/src/cli/commands/mind-pulse.ts";

describe("formatPulseDirective", () => {
  it("injects Mode A discovery mandate when active runs and backlog are zero", () => {
    // Check if the current formatPulseDirective takes these params or something similar
    // We will update this test accordingly if formatPulseDirective signature is different.
    const output = formatPulseDirective({ activeRuns: 0, pendingBacklog: 0 });
    expect(output).toContain("MODE A AUTONOMOUS DISCOVERY REQUIRED");
    expect(output).toContain("CLOSING_FORBIDDEN_FOR_MIND");
  });
});
