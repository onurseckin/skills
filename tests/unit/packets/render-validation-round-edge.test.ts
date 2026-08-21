import { describe, expect, test } from "bun:test";
import { renderValidationRound } from "../../../orchestrating-long-tasks/scripts/src/packets/render-validation-round.ts";

describe("renderValidationRound fencing edge cases", () => {
  test("widens the code fence so it never collides with backticks already in the content", () => {
    const markdown = renderValidationRound({
      round: 2,
      previous_round: { round: 1 },
      prove_these_hold: [],
      commands_already_run: [
        {
          command_id: "C-1",
          exit_code: 0,
          gate_id: null,
          argv: ["bun", "test"],
          cwd_relative: ".",
          actor: "worker",
          finished_at: "2026-08-13T12:00:00.000Z",
          stdout: { text: "output containing ``` a fence already", truncated: false },
        },
      ],
      gates: [],
      repository_delta: {
        full: {
          anchor: { captured_at: "2026-08-13T12:06:00.000Z", head_commit: "a".repeat(40) },
          argv: ["diff", "HEAD"],
          truncated: true,
          text: "```diff\n+ already fenced content\n```",
        },
      },
    });
    // The widened fence (4+ backticks) must fully wrap the embedded triple-backtick content.
    expect(markdown).toMatch(/````text\noutput containing ``` a fence already\n````/u);
    expect(markdown).toMatch(/````diff\n```diff\n\+ already fenced content\n```\n````/u);
    expect(markdown).toContain("Measured with `git diff HEAD`.");
    expect(markdown).toContain("The diff below is the first part of a longer one.");
  });

  test("a command with no gate binding and a null exit code reports its raw status instead", () => {
    const markdown = renderValidationRound({
      round: 2,
      previous_round: { round: 1 },
      prove_these_hold: [],
      commands_already_run: [
        {
          command_id: "C-2",
          exit_code: null,
          status: "timed_out",
          gate_id: null,
          argv: ["bun", "test"],
          cwd_relative: ".",
          actor: "worker",
          finished_at: "2026-08-13T12:00:00.000Z",
        },
      ],
      gates: [],
      repository_delta: {},
    });
    expect(markdown).toContain("`C-2` — timed_out");
    expect(markdown).toContain("no gate binding");
  });
});
