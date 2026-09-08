import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  auditCommitMessage,
  computeIsMain,
  formatViolationReport,
  main,
  runCommitMsgGuard,
} from "../../../scripts/git/index.ts";

const MESSAGE_PATH = "/virtual/repo/.git/COMMIT_EDITMSG";

const FORBIDDEN_MESSAGES: ReadonlyArray<readonly [string, string]> = [
  ["co-authored-by claude", "feat(x): thing\n\nCo-Authored-By: Claude <noreply@anthropic.com>"],
  ["co-authored-by lowercase key", "fix: thing\n\nco-authored-by: Claude Opus 5 <a@b.com>"],
  ["co-authored-by anthropic", "fix: thing\n\nCo-Authored-By: Somebody <noreply@anthropic.com>"],
  ["co-authored-by copilot", "fix: thing\n\nCo-Authored-By: GitHub Copilot <c@github.com>"],
  ["co-authored-by cursor", "fix: thing\n\nCo-Authored-By: Cursor Agent <c@cursor.sh>"],
  ["co-authored-by gemini", "fix: thing\n\nCo-Authored-By: Gemini <g@google.com>"],
  ["co-authored-by gpt", "fix: thing\n\nCo-Authored-By: GPT-5 <g@openai.com>"],
  ["co-authored-by codex", "fix: thing\n\nCo-Authored-By: Codex <c@openai.com>"],
  ["claude-session trailer", "fix: thing\n\nClaude-Session: https://claude.ai/code/session_01"],
  ["generated with bracketed claude code", "fix: thing\n\nGenerated with [Claude Code](https://x)"],
  ["generated with claude", "fix: thing\n\nGenerated with Claude Code"],
  ["robot emoji generated with", "fix: thing\n\n\u{1F916} Generated with [Some Tool](https://x)"],
  ["assisted-by vendor", "fix: thing\n\nAssisted-By: Claude Code"],
  ["co-created-with vendor", "fix: thing\n\nCo-Created-With: Gemini 3 Pro"],
  [
    "hash-commented co-authored-by claude",
    "feat: thing\n\n# Co-Authored-By: Claude <noreply@anthropic.com>",
  ],
  ["hash-commented generated with claude", "feat: thing\n\n# Generated with Claude Code"],
  [
    "hash-commented claude-session",
    "feat: thing\n\n# Claude-Session: https://claude.ai/code/session_01",
  ],
];

const LEGAL_MESSAGES: ReadonlyArray<readonly [string, string]> = [
  [
    "subject naming Claude Code as a host",
    "feat: read real host telemetry from Claude Code transcripts",
  ],
  [
    "body naming a claude manifest",
    "fix(agents): repair manifest\n\nagents/claude.yaml declares none",
  ],
  ["empty message", ""],
  ["whitespace-only message", "\n\n   \n"],
  ["human co-author", "feat: thing\n\nCo-Authored-By: Jane Doe <jane@example.com>"],
  ["prose about a cursor position", "fix: keep the cursor position stable while gpt tokens stream"],
  ["commented human co-author", "feat: thing\n\n# Co-Authored-By: Jane Doe <jane@example.com>"],
  [
    "git commentary lines",
    "feat: thing\n\n# Please enter the commit message for your changes.\n# Lines starting with '#' will be ignored.",
  ],
  [
    "verbose diff below the scissors line with genuine git preamble",
    "feat: thing\n\n# ------------------------ >8 ------------------------\n# Do not modify or remove the line above.\n# Everything below it will be ignored.\ndiff --git a/f.txt b/f.txt\n+Co-Authored-By: Claude <noreply@anthropic.com>",
  ],
];

describe("commit message attribution guard (in-memory virtual)", () => {
  let vfsSession: VirtualFSSession;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    vfsSession = createVirtualFSSession(new VirtualMemoryFS());
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vfsSession.cleanup();
  });

  function writeMessage(message: string): void {
    vfsSession.vfs.mkdirSync("/virtual/repo/.git", { recursive: true });
    vfsSession.vfs.writeFileSync(MESSAGE_PATH, message);
  }

  for (const [label, message] of FORBIDDEN_MESSAGES) {
    test(`rejects ${label}`, () => {
      const audit = auditCommitMessage(message);
      expect(audit.passed).toBe(false);
      expect(audit.violations.length).toBeGreaterThan(0);

      writeMessage(message);
      expect(runCommitMsgGuard([MESSAGE_PATH])).toBe(1);
      expect(errorSpy).toHaveBeenCalled();
    });
  }

  for (const [label, message] of LEGAL_MESSAGES) {
    test(`accepts ${label}`, () => {
      const audit = auditCommitMessage(message);
      expect(audit.violations).toEqual([]);
      expect(audit.passed).toBe(true);

      writeMessage(message);
      expect(runCommitMsgGuard([MESSAGE_PATH])).toBe(0);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  }

  test("reports the offending line number, rule, and text", () => {
    const audit = auditCommitMessage(
      "feat: thing\n\nbody line\nCo-Authored-By: Claude <noreply@anthropic.com>\n",
    );
    expect(audit.violations).toHaveLength(1);
    expect(audit.violations[0]?.line).toBe(4);
    expect(audit.violations[0]?.rule).toBe("ai-attribution-trailer");
    expect(audit.violations[0]?.text).toBe("Co-Authored-By: Claude <noreply@anthropic.com>");

    const report = formatViolationReport(audit.violations);
    expect(report).toContain("line 4 [ai-attribution-trailer]");
    expect(report).toContain("AI attribution is forbidden");
  });

  test("collects every distinct forbidden pattern in one audit", () => {
    const audit = auditCommitMessage(
      [
        "feat: thing",
        "",
        "Co-Authored-By: Claude <noreply@anthropic.com>",
        "Claude-Session: https://claude.ai/code/session_01",
        "\u{1F916} Generated with [Claude Code](https://claude.com/claude-code)",
      ].join("\n"),
    );
    expect(audit.violations.map((violation) => violation.rule)).toEqual([
      "ai-attribution-trailer",
      "claude-session-trailer",
      "generated-with-phrase",
    ]);
  });

  test("fails closed when the message path is missing or unreadable", () => {
    expect(runCommitMsgGuard([])).toBe(1);
    expect(runCommitMsgGuard(["--flag-only"])).toBe(1);
    expect(runCommitMsgGuard(["/virtual/repo/.git/ABSENT_MSG"])).toBe(1);
    expect(errorSpy).toHaveBeenCalledTimes(3);
  });

  test("main wraps the guard and computeIsMain detects the entrypoint", () => {
    writeMessage("feat: clean subject");
    expect(main([MESSAGE_PATH])).toBe(0);
    expect(computeIsMain(true, undefined)).toBe(true);
    expect(computeIsMain(false, undefined)).toBe(false);
    expect(computeIsMain(false, "/repo/scripts/git/commit-msg-guard.ts")).toBe(true);
    expect(computeIsMain(false, "/repo/scripts/git/commit-msg-guard")).toBe(true);
    expect(computeIsMain(false, "/repo/scripts/testing/test-runner.ts")).toBe(false);
  });

  test("rejects various commented ai trailers and banners with exact line numbers", () => {
    const audit = auditCommitMessage(
      [
        "feat: clean subject",
        "",
        "# normal comment line",
        "## Co-Authored-By: Claude <noreply@anthropic.com>",
        "# # Assisted-By: GitHub Copilot <c@github.com>",
        "# \u{1F916} Generated with [Claude Code](https://claude.com)",
        "# Co-Created-With: Gemini 3 Pro",
      ].join("\n"),
    );
    expect(audit.passed).toBe(false);
    expect(audit.violations).toHaveLength(4);
    expect(audit.violations[0]?.line).toBe(4);
    expect(audit.violations[0]?.rule).toBe("ai-attribution-trailer");
    expect(audit.violations[1]?.line).toBe(5);
    expect(audit.violations[1]?.rule).toBe("ai-attribution-trailer");
    expect(audit.violations[2]?.line).toBe(6);
    expect(audit.violations[2]?.rule).toBe("generated-with-phrase");
    expect(audit.violations[3]?.line).toBe(7);
    expect(audit.violations[3]?.rule).toBe("ai-attribution-trailer");
  });

  test("rejects attribution smuggled after a bare fake scissors line without git preamble", () => {
    const message =
      "feat: legitimate subject\n\n# ------------------------ >8 ------------------------\nCo-Authored-By: Claude <noreply@anthropic.com>";
    const audit = auditCommitMessage(message);
    expect(audit.passed).toBe(false);
    expect(audit.violations.length).toBeGreaterThan(0);
  });

  test("excludes scissors line variants with genuine git preamble and any content following them", () => {
    const cutLineVariants = [
      "# ------------------------ >8 ------------------------",
      "# ------------------------ 8< ------------------------",
      "# ------ >8 ------",
    ];
    for (const cutLine of cutLineVariants) {
      const message = `feat: clean\n\n${cutLine}\n# Do not modify or remove the line above.\n# Everything below it will be ignored.\ndiff --git a/f.txt b/f.txt\n+Co-Authored-By: Claude <noreply@anthropic.com>`;
      const audit = auditCommitMessage(message);
      expect(audit.passed).toBe(true);
      expect(audit.violations).toEqual([]);
    }
  });
});
