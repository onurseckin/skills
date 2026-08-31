import { describe, expect, it } from "bun:test";
import { deconstructPromptBytes } from "../../../olt/scripts/src/critic/critic-ops.ts";

describe("critic-ops: deconstructPromptBytes", () => {
  it("returns empty array for empty or whitespace-only prompt", () => {
    expect(deconstructPromptBytes("")).toEqual([]);
    expect(deconstructPromptBytes("   \n\n  \t  \n  ")).toEqual([]);
  });

  it("parses single clause", () => {
    const res = deconstructPromptBytes("Single clause prompt.");
    expect(res).toEqual([
      {
        id: "req-1",
        clause: "Single clause prompt.",
        verified: false,
      },
    ]);
  });

  it("splits paragraphs separated by double newlines or CRLF", () => {
    const prompt =
      "First paragraph with [link](http://example.com).\n\nSecond paragraph.\r\n\r\nThird paragraph.";
    const res = deconstructPromptBytes(prompt);
    expect(res).toHaveLength(3);
    expect(res[0]).toEqual({
      id: "req-1",
      clause: "First paragraph with [link](http://example.com).",
      verified: false,
    });
    expect(res[1]).toEqual({
      id: "req-2",
      clause: "Second paragraph.",
      verified: false,
    });
    expect(res[2]).toEqual({
      id: "req-3",
      clause: "Third paragraph.",
      verified: false,
    });
  });

  it("handles multiple consecutive newlines without creating empty clauses", () => {
    const prompt = "Clause 1\n\n\n\n\nClause 2\r\n\r\n\r\nClause 3";
    const res = deconstructPromptBytes(prompt);
    expect(res).toHaveLength(3);
    expect(res.map((c) => c.clause)).toEqual(["Clause 1", "Clause 2", "Clause 3"]);
    expect(res.map((c) => c.id)).toEqual(["req-1", "req-2", "req-3"]);
  });
});
