import { describe, expect, it } from "bun:test";
import {
  isSubTaskTerminal,
  type BranchSubTask,
} from "../../../olt/scripts/src/core/contracts/index.ts";

describe("Branch Lifecycle: Sub-Task Submission & Terminal States", () => {
  it("recognizes submitted and abandoned as terminal sub-task states", () => {
    const subSubmitted: BranchSubTask = {
      id: "S-1",
      label: "Parser",
      write_scope: ["src/parser"],
      status: "submitted",
    };
    expect(isSubTaskTerminal(subSubmitted)).toBe(true);

    const subAbandoned: BranchSubTask = {
      id: "S-2",
      label: "Lexer",
      write_scope: ["src/lexer"],
      status: "abandoned",
    };
    expect(isSubTaskTerminal(subAbandoned)).toBe(true);

    const subClaimed: BranchSubTask = {
      id: "S-3",
      label: "Tokens",
      write_scope: ["src/tokens"],
      status: "claimed",
    };
    expect(isSubTaskTerminal(subClaimed)).toBe(false);
  });
});
