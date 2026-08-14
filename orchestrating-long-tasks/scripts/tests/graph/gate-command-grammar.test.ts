import { describe, expect, test } from "bun:test";
import { validateGraph } from "../../src/graph/index.ts";
import { validPlanningDocuments } from "./fixtures.ts";

const weakIssue = "gates[0].command must perform substantive verification";

function commandIssues(command: string[]): string[] {
  const { graph, requirements } = validPlanningDocuments();
  (graph.gates as Record<string, unknown>[])[0]!.command = command;
  return validateGraph(graph, requirements);
}

function expectWeak(commands: string[][]): void {
  for (const command of commands) expect(commandIssues(command)).toContain(weakIssue);
}

function expectStrong(commands: string[][]): void {
  for (const command of commands) expect(commandIssues(command)).toEqual([]);
}

describe("strict gate command grammar", () => {
  test("rejects non-proof modes for every command family", () => {
    expectWeak([
      ["node", "scripts/check.js", "--help"],
      ["node", "--test", "--test-only", "tests/check.test.js"],
      ["node", "--test", "--test-name-pattern=missing", "tests/check.test.js"],
      ["node", "--test", "--test-shard=1/999", "tests/check.test.js"],
      ["bun", "test", "tests", "--pass-with-no-tests"],
      ["bun", "test", "--only", "tests/check.test.ts"],
      ["bun", "test", "--test-name-pattern=missing", "tests/check.test.ts"],
      ["bun", "test", "--filter=missing", "tests/check.test.ts"],
      ["deno", "test", "tests/check_test.ts", "--watch"],
      ["deno", "test", "--filter=missing", "tests/check_test.ts"],
      ["python3", "-m", "pytest", "--collect-only", "tests"],
      ["cargo", "test", "--no-run"],
      ["jest", "--listTests"],
      ["jest", "--testNamePattern=missing", "tests"],
      ["jest", "--testPathPatterns=missing", "tests/check.test.ts"],
      ["jest", "missing"],
      ["vitest", "--watch", "tests"],
      ["vitest", "run", "--testNamePattern=missing", "tests"],
      ["vitest", "run", "missing"],
      ["go", "test", "-run=^$", "./..."],
      ["go", "test", "-skip=.", "./..."],
      ["go", "test", "-list=.", "./..."],
      ["go", "test", "-count=0", "./..."],
      ["cargo", "test", "missing"],
      ["dotnet", "test", "--filter=missing"],
      ["custom-check", "--dry-run"],
      ["custom-check", "--version"],
      ["npm", "test", "--ignore-scripts"],
      ["npm", "test", "-hdetails"],
      ["npm", "test", "--", "--testNamePattern=missing"],
      ["npm", "run", "lint", "--", "--fix"],
      ["pnpm", "test", "-t", "missing"],
      ["yarn", "build", "--mode", "development"],
      ["bun", "run", "verify", "--", "--filter=missing"],
    ]);
  });

  test("rejects runtime modes outside the file-backed grammar", () => {
    expectWeak([
      ["node", "--test"],
      ["node", "--require=scripts/preload.js", "scripts/check.js"],
      ["bun", "test"],
      ["bun", "-r/dev/null", "--pass-with-no-tests"],
      ["deno", "test"],
      ["deno", "-c=/dev/null", "--help"],
      ["python3", "-B", "scripts/check.py"],
      ["pypy3.10", "-c", "print('passed')"],
      ["ruby", "-we", "scripts/check.rb"],
      ["perl", "-pe", "scripts/check.pl"],
      ["php", "-B", "echo 'before';"],
      ["php", "-R", "echo 'row';"],
      ["php", "-E", "echo 'after';"],
    ]);
  });

  test("accepts only explicit file-backed runtime forms", () => {
    expectStrong([
      ["node", "scripts/check.ts"],
      ["node", "--test", "--test-reporter=spec", "tests/check.test.js"],
      ["bun", "scripts/check.ts"],
      ["bun", "test", "--coverage", "tests/check.test.ts"],
      ["bun", "run", "verify"],
      ["deno", "test", "--allow-read", "tests/check_test.ts"],
      ["deno", "run", "--allow-read", "scripts/check.ts"],
      ["python3", "scripts/check.py"],
      ["pypy3.10", "-m", "pytest", "-q", "tests"],
      ["ruby", "scripts/check.rb"],
      ["perl", "scripts/check.pl"],
      ["php", "scripts/check.php"],
    ]);
  });

  test("rejects unknown bare executables and non-verification tool forms", () => {
    expectWeak([
      ["custom-check", "src/check.ts"],
      ["grep", "-e", "TODO", "src/check.ts"],
      ["git", "status"],
      ["git", "diff"],
      ["git", "diff", "--check", "HEAD", "HEAD"],
      ["git", "diff", "--check", "main", "main"],
      ["git", "diff", "--check", "HEAD..HEAD"],
      ["git", "diff", "--check", "HEAD...HEAD"],
      ["git", "diff", "--check", "HEAD"],
      ["git", "diff", "--check", "HEAD~1", "HEAD"],
      ["git", "diff", "--check", "HEAD", "--", "src"],
      ["git", "diff", "--check", "--", "src"],
      ["git", "diff", "--check", "--cached"],
      ["git", "diff", "--check", "--check"],
      ["cargo", "metadata"],
      ["go", "env"],
      ["dotnet", "--info"],
      ["eslint", "--fix", "src/check.ts"],
      ["prettier", "--write", "src/check.ts"],
      ["prettier", "--check", "--write", "src/check.ts"],
      ["oxfmt", "src/check.ts"],
      ["oxfmt", "--check", "--write", "src/check.ts"],
      ["npm", "run"],
      ["npm", "run", "env"],
    ]);
  });

  test("accepts recognized tools and repository-local executable paths", () => {
    expectStrong([
      ["git", "diff", "--check"],
      ["git", "diff", "--cached", "--check"],
      ["Env.EXE", "GIT.EXE", "diff", "--check"],
      ["COMMAND.EXE", "git", "diff", "--cached", "--check"],
      ["cargo", "test", "--workspace"],
      ["go", "test", "./..."],
      ["dotnet", "test"],
      ["pytest", "-q", "tests"],
      ["jest", "tests/check.test.ts"],
      ["vitest", "run", "tests/check.test.ts"],
      ["eslint", "src/check.ts"],
      ["tsc", "--noEmit"],
      ["oxlint", "src"],
      ["biome", "check", "src"],
      ["prettier", "--check", "src"],
      ["oxfmt", "--check", "src"],
      ["npm", "run", "lint"],
      ["pnpm", "test"],
      ["yarn", "build"],
      ["./scripts/check", "src/check.ts"],
      ["scripts/check", "src/check.ts"],
    ]);
  });
});
