import { describe, expect, test } from "bun:test";
import { codesOf, collectEngineVerdicts, errorCodesOf, messagesOf, verdictOf } from "./harness.ts";

export const engineVerdictsWorkspaceSuiteName =
  "Doctor engine verdicts - source purity, mock mutation, hygiene and git index";

const TAINTED_SOURCE = [
  "// @" + "ts-ignore",
  "let loose: " + "any = 1;",
  "export const escaped = loose as " + "any;",
  "",
].join("\n");

const HOLLOW_TEST = [
  'import { expect, test } from "bun:test";',
  "",
  'test("does nothing at all", ' + "() => {});",
  "",
  'test("asserts a tautology", () => {',
  "  expect(true)." + "toBe(true);",
  "});",
  "",
].join("\n");

describe(engineVerdictsWorkspaceSuiteName, () => {
  test("checkAstPurity reports suppression directives and any usage inside the write scope", async () => {
    const verdicts = await collectEngineVerdicts({
      label: "ast-purity-breach",
      repoFiles: { "src/tainted.ts": TAINTED_SOURCE },
      writeScope: ["src/tainted.ts"],
    });

    const purity = verdictOf(verdicts, "checkAstPurity");
    expect(purity.passed).toBe(false);
    expect(errorCodesOf(verdicts, "checkAstPurity").length).toBeGreaterThanOrEqual(3);
    expect(new Set(errorCodesOf(verdicts, "checkAstPurity"))).toEqual(
      new Set(["AST_PURITY_VIOLATION"]),
    );

    const violationTypes = purity.findings.map(
      (finding) => (finding.details as { violationType?: string } | undefined)?.violationType,
    );
    expect(violationTypes).toContain("COMPILER_SUPPRESSION_DIRECTIVE");
    expect(violationTypes).toContain("EXPLICIT_ANY");
    expect(violationTypes).toContain("ANY_TYPE_ASSERTION");
    expect(messagesOf(verdicts, "checkAstPurity")).toContain("src/tainted.ts");

    expect(verdictOf(verdicts, "checkAntiMockMutation").passed).toBe(true);
  });

  test("checkAntiMockMutation reports hollow test bodies and tautological assertions", async () => {
    const verdicts = await collectEngineVerdicts({
      label: "anti-mock-breach",
      repoFiles: { "tests/hollow.test.ts": HOLLOW_TEST },
      testPaths: ["tests/hollow.test.ts"],
    });

    const antiMock = verdictOf(verdicts, "checkAntiMockMutation");
    expect(antiMock.passed).toBe(false);
    expect(codesOf(verdicts, "checkAntiMockMutation")).toContain("ANTI_MOCK_EMPTY_TEST_BODY");
    expect(codesOf(verdicts, "checkAntiMockMutation")).toContain("ANTI_MOCK_TRIVIAL_ASSERTION");
    expect(messagesOf(verdicts, "checkAntiMockMutation")).toContain("tests/hollow.test.ts");

    expect(verdictOf(verdicts, "checkAstPurity").passed).toBe(true);
  });

  test("checkRepositoryHygiene reports loose scratch scripts and unapproved root entries", async () => {
    const verdicts = await collectEngineVerdicts({
      label: "hygiene-breach",
      repoFiles: {
        "fix-doctor-bug.ts": "export const patch = 1;\n",
        "leftover.data": "raw bytes",
        "junkdir/notes.txt": "scratch",
      },
    });

    const hygiene = verdictOf(verdicts, "checkRepositoryHygiene");
    expect(hygiene.passed).toBe(false);
    expect(codesOf(verdicts, "checkRepositoryHygiene")).toContain("UNCONFINED_SCRATCH_SCRIPT");
    expect(codesOf(verdicts, "checkRepositoryHygiene")).toContain("UNAPPROVED_ROOT_FILE");
    expect(codesOf(verdicts, "checkRepositoryHygiene")).toContain("UNAPPROVED_ROOT_DIR");
    expect(messagesOf(verdicts, "checkRepositoryHygiene")).toContain("fix-doctor-bug.ts");
    expect(messagesOf(verdicts, "checkRepositoryHygiene")).toContain("junkdir");

    expect(verdictOf(verdicts, "checkGitIndexIntegrity").passed).toBe(true);
  });

  test("checkGitIndexIntegrity reports an index lock held by a dead process", async () => {
    const verdicts = await collectEngineVerdicts({
      label: "git-index-stale-lock",
      repoFiles: { ".git/index.lock": "9999999\n" },
    });

    const gitIndex = verdictOf(verdicts, "checkGitIndexIntegrity");
    expect(gitIndex.passed).toBe(false);
    expect(errorCodesOf(verdicts, "checkGitIndexIntegrity")).toEqual([
      "GIT_STALE_INDEX_LOCK_DETECTED",
    ]);
    expect(messagesOf(verdicts, "checkGitIndexIntegrity")).toContain("9999999");

    expect(verdictOf(verdicts, "checkRepositoryHygiene").passed).toBe(true);
  });
});
