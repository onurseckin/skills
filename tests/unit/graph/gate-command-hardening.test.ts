import { describe, expect, test } from "bun:test";
import { validateGraph } from "../../../olt/scripts/src/graph/validate-graph.ts";
import { validPlanningDocuments } from "./fixtures.ts";

const weakIssue = "gates[0].command must perform substantive verification";
const pathFormMarker = "must be a repository-relative path";

function commandIssues(command: string[]): string[] {
  const { graph, requirements } = validPlanningDocuments();
  (graph.gates as Record<string, unknown>[])[0]!.command = command;
  return validateGraph(graph, requirements);
}

function expectRejected(command: string[]): void {
  const issues = commandIssues(command);
  expect(issues.some((issue) => issue === weakIssue || issue.includes(pathFormMarker))).toBe(true);
}

describe("gate command argv hardening", () => {
  test("rejects unsafe paths in operands and long-option payloads", () => {
    for (const command of [
      ["node", "--require=/dev/null", "scripts/check.js"],
      ["node", "scripts/check.js", "--output=../result.json"],
      ["bun", "scripts/check.ts", "--preload=/dev/null"],
      ["deno", "test", "--config=../deno.json"],
      ["custom-check", "/tmp/result.json"],
      ["custom-check", "--config=../../config.json"],
      ["custom-check", "--output=NUL"],
      ["env", "--chdir=/tmp", "git", "diff", "--check"],
      ["env", "-C", "../work", "git", "diff", "--check"],
      ["env", "OUTPUT=/dev/null", "./scripts/check"],
      ["env", "--argv0=/tmp/check", "./scripts/check"],
      ["env", "-u/dev/null", "./scripts/check"],
      ["env", "-u", "/dev/null", "./scripts/check"],
      ["/usr/bin/git", "diff", "--check"],
      ["/usr/bin/test", "-f", "package.json"],
      ["../scripts/check", "src/check.ts"],
      ["./scripts/NUL/check", "src/check.ts"],
      ["scripts/NUL/check", "src/check.ts"],
      ["node", "scripts/NUL/check.ts"],
      ["./scripts/check", "scripts/NUL/data"],
      ["./scripts/check", "-qr/dev/null"],
      ["./scripts/check", "-qo/dev/null"],
      ["./scripts/check", "-qo=/dev/null"],
      ["./scripts/check", "-qf../outside"],
      ["./scripts/check", "--config=config/check.json"],
      ["./scripts/check", "-Irelative/path"],
      ["node", "scripts/check.js", "-qo=relative/path"],
      ["bun", "scripts/check.ts", "--config=config/check.json"],
      ["python3", "scripts/check.py", "-qf../outside"],
      ["ruby", "scripts/check.rb", "--output=artifacts/result.json"],
      ["node", "scripts/CON /check.ts"],
      ["node", "scripts/NUL.../check.ts"],
      ["./scripts/check", "scripts/AUX. /data"],
      ["./scripts/check", "C:package.json"],
      ["./scripts/check", "C:../outside"],
      ["C:scripts/check", "src/check.ts"],
      ["eslint", "--config=C:eslint.config.js", "src/check.ts"],
      ["node", "scripts/.. /check.ts"],
      ["node", "scripts/. /check.ts"],
      ["node", "scripts/.../check.ts"],
      ["./scripts/check", "-cpackage.json"],
      ["./scripts/check", "--configpackage.json"],
      ["./scripts/check", "--strict"],
      ["./scripts/check", "-q"],
    ]) {
      expectRejected(command);
    }
  });

  test("rejects targeted interpreter and universal long inline modes", () => {
    for (const command of [
      ["python3", "-c", "print('passed')"],
      ["python", "-cprint('passed')"],
      ["python3", "-Bc", "scripts/check.py"],
      ["python3", "-B", "scripts/check.py"],
      ["ruby", "-e", "puts 'passed'"],
      ["ruby", "-we", "scripts/check.rb"],
      ["ruby", "-w", "scripts/check.rb"],
      ["perl", "-eprint 'passed'"],
      ["perl", "-pe", "scripts/check.pl"],
      ["perl", "-p", "scripts/check.pl"],
      ["php", "-r", "echo 'passed';"],
      ["custom-check", "--eval=1 + 1"],
      ["custom-check", "--print", "constant"],
      ["custom-check", "--command=exit 0"],
    ]) {
      expect(commandIssues(command)).toContain(weakIssue);
    }
  });

  test("does not grant trusted grammar to path-qualified tools or mutable env wrappers", () => {
    for (const command of [
      ["./scripts/git", "diff", "--check"],
      ["scripts/bun", "-e", "process.exit(0)"],
      ["./scripts/test", "-f", "package.json"],
      ["./scripts/pytest", "--pass-with-no-tests", "tests"],
      ["./scripts/env", "git", "diff", "--check"],
      ["env", "PATH=./fixtures", "git", "diff", "--check"],
      ["env", "NODE_OPTIONS=--require=./scripts/noop.js", "node", "scripts/check.js"],
      ["env", "-C", ".", "git", "diff", "--check"],
      ["env", "--chdir=.", "git", "diff", "--check"],
      ["env", "-i", "git", "diff", "--check"],
      ["env", "-u", "NODE_OPTIONS", "git", "diff", "--check"],
    ]) {
      expect(commandIssues(command)).toContain(weakIssue);
    }

    for (const command of [
      ["env", "git", "diff", "--check"],
      ["env", "--", "git", "diff", "--check"],
      ["command", "env", "--", "test", "-f", "package.json"],
    ]) {
      expect(commandIssues(command)).toEqual([]);
    }
  });

  test("rejects reserved basenames instead of treating their paths as custom verifiers", () => {
    for (const command of [
      ["./scripts/true"],
      ["scripts/echo", "passed"],
      ["scripts/sh", "verify"],
      ["scripts/busybox", "verify"],
      ["scripts/git", "verify"],
      ["scripts/bun", "verify"],
      ["scripts/pytest", "tests"],
      ["scripts/python3.13", "scripts/check.py"],
      ["scripts/env", "verify"],
    ]) {
      expect(commandIssues(command)).toContain(weakIssue);
    }
    expect(commandIssues(["scripts/git-check", "src/check.ts"])).toEqual([]);
  });

  test("accepts safe file-backed interpreters and direct verification tools", () => {
    for (const command of [
      ["python3", "scripts/check.py"],
      ["python", "-m", "pytest", "tests"],
      ["ruby", "scripts/check.rb"],
      ["perl", "scripts/check.pl"],
      ["php", "scripts/check.php"],
      ["node", "scripts/NUL-safe/check.ts"],
      ["node", "scripts/NULL/check.ts"],
      ["node", "scripts/console/check.ts"],
      ["./scripts/check", "scripts/NUL-safe/data"],
      ["./scripts/check"],
      ["./scripts/check", "strict", "src/check.ts"],
    ]) {
      expect(commandIssues(command)).toEqual([]);
    }
  });

  test("restricts direct test commands to safe repository file predicates", () => {
    for (const command of [
      ["test", "-f", "/dev/null"],
      ["test", "-f", "../package.json"],
      ["/usr/bin/test", "-f", "package.json"],
      ["test", "-n", "constant"],
      ["test", "package.json"],
      ["test", "1", "-eq", "1"],
      ["[", "-f", "package.json"],
      ["[", "-f", "/dev/null", "]"],
    ]) {
      expectRejected(command);
    }
    for (const command of [
      ["test", "-f", "package.json"],
      ["test", "-h", "links/current"],
      ["[", "-e", "package.json", "]"],
      ["[", "-h", "links/current", "]"],
    ]) {
      expect(commandIssues(command)).toEqual([]);
    }
  });
});
