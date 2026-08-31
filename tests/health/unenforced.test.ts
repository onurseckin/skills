import { afterAll, describe, expect, test } from "bun:test";
import { checkDeclarations } from "../../olt/scripts/src/health/unenforced.ts";
import { COMMAND_REGISTRY } from "../../olt/scripts/src/cli/registry/index.ts";
import { cleanupTempRoots, loadTree, tempRoot, writeTree } from "./fixture.ts";

afterAll(cleanupTempRoots);

const ROLE = [
  'name: "validator"',
  'role: "validator"',
  "tier: 3",
  "permissions:",
  "  may:",
  '    - "Review a submitted task"',
  "  must_not:",
  '    - "Validate a task it implemented"',
  "  commands:",
  '    - "task:review"',
  '    - "task:invent"',
  "  spawns: []",
  "instructions: |",
  "  # Validator",
].join("\n");

function keysFor(skillFiles: Record<string, string>, production: Record<string, string>): string[] {
  const skillRoot = writeTree(tempRoot("skill"), skillFiles);
  const tree = loadTree("declared", production);
  return checkDeclarations({
    production: tree.modules,
    skillRoot,
    registryApplies: true,
  }).findings.map((entry) => entry.key);
}

describe("a flag the handler never reads is accepted and dropped", () => {
  const keys = keysFor(
    { "roles/.keep": "" },
    {
      "handler.ts": [
        "export function doctorCommand(flags: Record<string, string>): string {",
        '  return flags["run"] ?? "";',
        "}",
      ].join("\n"),
    },
  );

  test("the unread flag is named with the command that declares it", () => {
    expect(keys).toContain("unread-flag:doctor:source");
    expect(keys).toContain("unread-flag:doctor:home");
  });

  test("a flag the handler does read is not reported", () => {
    expect(keys).not.toContain("unread-flag:doctor:run");
  });

  test("a handler no module exports is reported as uncheckable rather than as clean", () => {
    expect(keys).toContain("handler-unresolved:recover");
  });
});

describe("a flag read through an imported helper is not mistaken for unread", () => {
  const keys = keysFor(
    { "roles/.keep": "" },
    {
      "handler.ts": [
        'import { HOME_FLAG } from "./flag-names.ts";',
        "export function doctorCommand(flags: Record<string, string>): string {",
        "  void HOME_FLAG;",
        '  return flags["run"] ?? "";',
        "}",
      ].join("\n"),
      "flag-names.ts": ['export const HOME_FLAG = "home";'].join("\n"),
    },
  );

  test("the flag named only inside the imported module is not reported unread", () => {
    expect(keys).not.toContain("unread-flag:doctor:home");
  });

  test("a flag neither the handler nor its import mentions is still reported", () => {
    expect(keys).toContain("unread-flag:doctor:source");
  });
});

describe("a config knob nothing reads is a promise the harness does not keep", () => {
  const CONFIG = [
    "export interface HarnessConfig {",
    "  max_repair_rounds: number;",
    "  strict_validation: boolean;",
    "}",
    "",
    "export const DEFAULT_CONFIG: HarnessConfig = {",
    "  max_repair_rounds: 6,",
    "  strict_validation: true,",
    "};",
  ].join("\n");

  const keys = keysFor(
    { "roles/.keep": "" },
    {
      "src/config/index.ts": CONFIG,
      "src/review.ts": [
        "export function budget(config: { max_repair_rounds: number }): number {",
        "  return config.max_repair_rounds;",
        "}",
      ].join("\n"),
    },
  );

  test("the knob no code outside the config module reads is named", () => {
    expect(keys).toContain("unread-config:strict_validation");
  });

  test("a knob the code acts on is not reported", () => {
    expect(keys).not.toContain("unread-config:max_repair_rounds");
  });

  test("a tree with no config module reports no config findings rather than guessing", () => {
    expect(
      keysFor({ "roles/.keep": "" }, { "src/other.ts": "export const a = 1;\n" }).filter((key) =>
        key.startsWith("unread-config:"),
      ),
    ).toEqual([]);
  });
});

describe("a role contract that grants a command the CLI does not have binds nothing", () => {
  const keys = keysFor({ "agents/validator.yaml": ROLE }, {});

  test("the missing command is named", () => {
    expect(keys).toContain("role-command-missing:agents/validator.yaml:task:invent");
  });

  test("a granted command the registry defines is not reported", () => {
    expect(keys).not.toContain("role-command-missing:agents/validator.yaml:task:review");
  });

  test("a well-formed contract is not reported as unreadable", () => {
    expect(keys.some((key) => key.startsWith("role-unparseable:"))).toBe(false);
  });

  test("a contract the binding loader refuses to read is reported", () => {
    const broken = "invalid: yaml: content: [";
    expect(keysFor({ "agents/validator.yaml": broken }, {})).toContain(
      "role-unparseable:agents/validator.yaml",
    );
  });

  test("a role outside the vocabulary the code enforces is reported", () => {
    expect(
      keysFor({ "agents/ghost.yaml": ROLE.replace('role: "validator"', 'role: "archivist"') }, {}),
    ).toContain("role-unknown:agents/ghost.yaml");
  });
});

describe("documentation that promises a command nobody implemented", () => {
  test("the invented invocation is reported with the document that prints it", () => {
    const keys = keysFor(
      { "references/guide.md": "Run `bun harness.ts task:invent --run <run>` to finish." },
      {},
    );
    expect(keys).toContain("documented-command-missing:references/guide.md:task:invent");
  });

  test("a real invocation and the built-in help are left alone", () => {
    const keys = keysFor(
      { "references/guide.md": "Run `bun harness.ts task:review` or `bun harness.ts help`." },
      {},
    );
    expect(keys.filter((key) => key.startsWith("documented-command-missing:"))).toEqual([]);
  });
});

describe("the shipped role contracts and documents are consistent with the registry", () => {
  const skillRoot = new URL("../../../olt/", import.meta.url).pathname;
  const findings = checkDeclarations({
    production: new Map(),
    skillRoot,
    registryApplies: true,
  }).findings;

  test("every command a role contract grants exists", () => {
    expect(findings.filter((entry) => entry.key.startsWith("role-command-missing:"))).toEqual([]);
  });

  test("every role contract declares a role the code enforces", () => {
    expect(findings.filter((entry) => entry.key.startsWith("role-unknown:"))).toEqual([]);
  });

  test("the check inspects the whole registry", () => {
    expect(
      checkDeclarations({ production: new Map(), skillRoot, registryApplies: true }).scanned,
    ).toBe(COMMAND_REGISTRY.length);
  });
});

describe("a tree this process is not running is not judged against this process's registry", () => {
  const skillRoot = writeTree(tempRoot("foreign-skill"), {
    "roles/validator.md": ROLE,
    "references/guide.md": "Run `bun harness.ts task:invent`.",
  });
  const tree = loadTree("foreign", {
    "src/config/index.ts": ["export interface HarnessConfig {", "  orphan_knob: string;", "}"].join(
      "\n",
    ),
  });
  const result = checkDeclarations({
    production: tree.modules,
    skillRoot,
    registryApplies: false,
  });
  const keys = result.findings.map((entry) => entry.key);

  test("no handler of the running registry is reported unresolved against a foreign tree", () => {
    expect(keys.filter((key) => key.startsWith("handler-unresolved:"))).toEqual([]);
    expect(keys.filter((key) => key.startsWith("unread-flag:"))).toEqual([]);
  });

  test("a foreign role contract is not measured against this process's command vocabulary", () => {
    expect(keys.filter((key) => key.startsWith("role-command-missing:"))).toEqual([]);
    expect(keys.filter((key) => key.startsWith("documented-command-missing:"))).toEqual([]);
  });

  test("the knobs read from the scanned tree itself are still checked", () => {
    expect(keys).toContain("unread-config:orphan_knob");
  });

  test("what was skipped is declared, and the count reflects what was inspected", () => {
    expect(result.limitations.join(" ")).toContain("were NOT checked");
    expect(result.scanned).toBe(tree.modules.size);
  });
});
