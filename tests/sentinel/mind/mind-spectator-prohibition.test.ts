import { describe, expect, test } from "bun:test";
import { mindProfile } from "../../../olt/scripts/src/sentinel/profiles/tier0/mind.ts";
import type {
  EvaluationContext,
  SentinelViolation,
} from "../../../olt/scripts/src/sentinel/types.ts";

describe("Mind Sentinel Profile: Spectator Prohibition", () => {
  test("MIND_LOG_TAILING_FORBIDDEN: forbids tail, tail -f, less +F, and adversarial permutations", () => {
    const forbiddenCommands = [
      "tail file.log",
      "tail -n 100 file.log",
      "tail -f file.log",
      "tail -F debug.log",
      "tailf file.log",
      "less +F file.log",
      "/usr/bin/tail -f /var/log/syslog",
      "/bin/tailf /app.log",
      "/usr/local/bin/tail -n 50 app.log",
      "cat app.log && tail -f error.log",
      "echo 'done'; less +F run.log",
      "git status || tail app.log",
      "ps aux | grep node | tail -n 20",
      "echo $(tail -n 5 debug.log)",
      "BACKTRACE=`tail -n 10 trace.log`",
      "tail   -F   logfile.log",
      "tail   -n   10   server.log",
      "tail\t-f\tapp.log",
    ];

    for (const cmd of forbiddenCommands) {
      const context: EvaluationContext = {
        executed_commands: [cmd],
      };

      const violations = mindProfile.evaluate(context);
      const tailViolation = violations.find(
        (v: SentinelViolation) => v.code === "MIND_LOG_TAILING_FORBIDDEN",
      );

      expect(tailViolation).toBeDefined();
      expect(tailViolation?.severity).toBe("CRITICAL");
      expect(tailViolation?.message).toBe("Mind must not act as a spectator log-tailing agent.");
      expect(tailViolation?.remediation_cmd).toBe("Terminate tail process.");
      expect(tailViolation?.documentation_ref).toBeDefined();
    }
  });

  test("triggers violation when forbidden command is embedded in multi-command list", () => {
    const context: EvaluationContext = {
      executed_commands: [
        "git status",
        "cat output.log",
        "grep error log.txt",
        "tail -f daemon.log",
        "ls -la",
      ],
    };

    const violations = mindProfile.evaluate(context);
    const tailViolation = violations.find(
      (v: SentinelViolation) => v.code === "MIND_LOG_TAILING_FORBIDDEN",
    );

    expect(tailViolation).toBeDefined();
    expect(tailViolation?.severity).toBe("CRITICAL");
  });

  test("allows legitimate non-tail commands and token sub-word matches", () => {
    const legitimateCommands = [
      "cat file.log",
      "grep error file.log",
      "head -n 20 file.log",
      "less file.log",
      "tailing_script.sh",
      "node detail_reporter.js",
      "cocktail --mix",
      "tailscale status",
      "echo 'not tailing'",
    ];

    for (const cmd of legitimateCommands) {
      const context: EvaluationContext = {
        executed_commands: [cmd],
      };

      const violations = mindProfile.evaluate(context);
      const tailViolation = violations.find(
        (v: SentinelViolation) => v.code === "MIND_LOG_TAILING_FORBIDDEN",
      );

      expect(tailViolation).toBeUndefined();
    }
  });

  test("handles empty and undefined executed_commands safely without throwing", () => {
    expect(() => mindProfile.evaluate({})).not.toThrow();
    expect(() => mindProfile.evaluate({ executed_commands: [] })).not.toThrow();
    const emptyResult = mindProfile.evaluate({ executed_commands: [] });
    expect(emptyResult.find((v) => v.code === "MIND_LOG_TAILING_FORBIDDEN")).toBeUndefined();
  });

  test("forbids multiline and escaped line continuation tail commands", () => {
    const multilineCommands = [
      "echo 'starting service'\ntail -f app.log",
      "tail \\\n-f server.log",
      "cat debug.txt\n/usr/bin/tail -n 50 err.log",
      "export ENV=prod\nless +F system.log",
    ];

    for (const cmd of multilineCommands) {
      const context: EvaluationContext = {
        executed_commands: [cmd],
      };

      const violations = mindProfile.evaluate(context);
      const tailViolation = violations.find(
        (v: SentinelViolation) => v.code === "MIND_LOG_TAILING_FORBIDDEN",
      );

      expect(tailViolation).toBeDefined();
      expect(tailViolation?.severity).toBe("CRITICAL");
    }
  });

  test("evaluates compound violations concurrently without masking", () => {
    const context: EvaluationContext = {
      modified_files: ["src/core/engine.ts", "docs/architecture.md"],
      executed_commands: ["tail -f /var/log/syslog"],
    };

    const violations = mindProfile.evaluate(context);
    const codes = violations.map((v) => v.code);

    expect(codes).toContain("MIND_DIRECT_CODE_MUTATION");
    expect(codes).toContain("MIND_LOG_TAILING_FORBIDDEN");
    expect(violations.filter((v) => v.severity === "CRITICAL").length).toBe(2);
  });
});
