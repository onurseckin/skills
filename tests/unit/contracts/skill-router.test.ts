import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_RESOLVED_CONFIG } from "../../../orchestrating-long-tasks/scripts/src/config/harness-config.ts";
import { COMMAND_REGISTRY } from "../../../orchestrating-long-tasks/scripts/src/cli/registry/index.ts";

const skillRoot = join(import.meta.dir, "../../../orchestrating-long-tasks");
const skillPath = join(skillRoot, "SKILL.md");
const skill = readFileSync(skillPath, "utf8");

// SKILL.md is loaded by every agent in every run before it does anything, so its size is a tax on
// the whole system rather than a style preference.
const LINE_BUDGET = 150;

const linkedPaths = (document: string): string[] => [
  ...[...document.matchAll(/\]\(([^)#]+)\)/gu)].map((match) => match[1]),
  ...[...document.matchAll(/`((?:roles|agents|references)\/[A-Za-z0-9_.-]+)`/gu)].map(
    (match) => match[1],
  ),
];

const namedCommands = (document: string): string[] =>
  [...document.matchAll(/`([a-z][a-z-]*:[a-z][a-z-]*)`/gu)].map((match) => match[1]);

interface Invocation {
  readonly command: string;
  readonly flags: readonly string[];
}

/**
 * Pulls `bun $PINNED <command> --flag ...` out of a document's shell blocks. The router delegates
 * every command sequence to the playbook, so these invocations — not the backticked mentions — are
 * what an agent actually copies, and they are the pairing that drifts when the registry moves.
 */
const shellInvocations = (document: string): Invocation[] => {
  const continued = document.replace(/\\\n\s*/gu, " ");
  return [...continued.matchAll(/^[^\n]*?bun \$PINNED ([a-z][a-z:-]*)([^\n]*)$/gmu)].map(
    (match) => ({
      command: match[1],
      // Everything after a bare `--` is the child argv the harness passes through untouched.
      flags: [...match[2].split(/\s--\s/u)[0].matchAll(/--([a-z][a-z0-9-]*)/gu)].map(
        (flag) => flag[1],
      ),
    }),
  );
};

// `--format` is stripped before dispatch, so no command declares it.
const GLOBAL_FLAGS = new Set(["format"]);

describe("SKILL.md is a router, not a manual", () => {
  test("stays inside the line budget every agent pays for", () => {
    expect(skill.split("\n").length).toBeLessThanOrEqual(LINE_BUDGET);
  });

  test("every document path it names exists", () => {
    const paths = linkedPaths(skill).filter((path) => !path.startsWith("http"));
    expect(paths.length).toBeGreaterThan(20);
    for (const path of paths) expect(existsSync(join(skillRoot, path))).toBe(true);
  });

  test("every command it names resolves in the command registry", () => {
    const known = new Set(COMMAND_REGISTRY.map((spec) => spec.name));
    const named = namedCommands(skill);
    expect(named.length).toBeGreaterThan(15);
    for (const command of named) expect(known).toContain(command);
  });

  test("routes to every role contract and every host persona", () => {
    const roles = readdirSync(join(skillRoot, "roles")).filter((file) => file.endsWith(".md"));
    const personas = readdirSync(join(skillRoot, "agents")).filter((file) =>
      file.endsWith(".yaml"),
    );
    // 11 canonical roles + 5 validator-domain contracts (B12.2's taxonomy, sharing role: validator).
    expect(roles.length).toBe(16);
    for (const role of roles) expect(skill).toContain(`roles/${role}`);
    for (const persona of personas) expect(skill).toContain(`agents/${persona}`);
  });

  test("routes to every reference, so no reference is written and then orphaned", () => {
    // The router is the only entry point an agent has. A reference nothing routes to is a document
    // that will never be opened, which is the same defect as not having written it.
    const unrouted = readdirSync(join(skillRoot, "references")).filter(
      (file) => !skill.includes(`references/${file}`),
    );
    expect(unrouted).toEqual([]);
  });

  test("states what each role must not read, because negative routing is the point", () => {
    expect(skill).toContain("Never read");
    const roleRows = skill
      .split("\n")
      .filter((line) => /^\| `(?:coordinator|planner|implementer|repairer|validator)/u.test(line));
    expect(roleRows.length).toBe(5);
    for (const row of roleRows) expect(row.split("|").length).toBe(6);
  });

  test("delegates command invocations instead of restating them", () => {
    // A copied invocation is a second copy of the playbook with a shorter half-life. The only
    // command line the router may carry is the one that sends an agent to the live manifest.
    const invocations = [...skill.matchAll(/^\s*bun .*$/gmu)].map((match) => match[0].trim());
    expect(invocations).toEqual(["bun orchestrating-long-tasks/scripts/harness.ts help <command>"]);
    expect(skill).not.toContain("$PINNED");
  });

  test("keeps the harness framing that explains the design", () => {
    for (const framing of [
      "Observability over every step",
      "Quality through gating",
      "Attention on the problem",
      "The harness never thinks",
      "No agent needs the whole skill",
    ])
      expect(skill).toContain(framing);
  });
});

describe("the references the router points at", () => {
  const referenceDir = join(skillRoot, "references");

  test("every command the hand-written references name resolves in the registry", () => {
    const known = new Set(COMMAND_REGISTRY.map((spec) => spec.name));
    // cli-capabilities.md is generated from the registry and verified byte-identical elsewhere.
    const handWritten = readdirSync(referenceDir).filter(
      (file) => file.endsWith(".md") && file !== "cli-capabilities.md",
    );
    for (const file of handWritten) {
      const content = readFileSync(join(referenceDir, file), "utf8");
      for (const command of namedCommands(content)) expect(known).toContain(command);
    }
  });

  test("every document path the hand-written references name exists", () => {
    const handWritten = readdirSync(referenceDir).filter(
      (file) => file.endsWith(".md") && file !== "cli-capabilities.md",
    );
    for (const file of handWritten) {
      const content = readFileSync(join(referenceDir, file), "utf8");
      const paths = linkedPaths(content).filter((path) => !path.startsWith("http"));
      for (const path of paths)
        expect(existsSync(join(referenceDir, path)) || existsSync(join(skillRoot, path))).toBe(
          true,
        );
    }
  });

  test("the run playbook is the home for the phase-ordered command sequences", () => {
    const playbook = readFileSync(join(referenceDir, "run-playbook.md"), "utf8");
    for (const phase of [
      "Phase 1 — Capture, enhance, plan, compile",
      "Phase 2 — Continuous dispatch",
      "Phase 3 — Implementation",
      "Phase 4 — Branch and collect",
      "Phase 5 — Independent validation",
      "Phase 6 — Completeness critic and sealing",
      "Phase 7 — Recovery, diagnostics and reporting",
    ])
      expect(playbook).toContain(phase);
  });

  test("every invocation the hand-written references spell out resolves, flags included", () => {
    const specs = new Map<string, (typeof COMMAND_REGISTRY)[number]>();
    for (const spec of COMMAND_REGISTRY) {
      specs.set(spec.name, spec);
      for (const alias of spec.aliases) specs.set(alias, spec);
    }
    const handWritten = readdirSync(referenceDir).filter(
      (file) => file.endsWith(".md") && file !== "cli-capabilities.md",
    );
    const unresolved: string[] = [];
    let checked = 0;
    for (const file of handWritten) {
      for (const invocation of shellInvocations(readFileSync(join(referenceDir, file), "utf8"))) {
        checked += 1;
        const spec = specs.get(invocation.command);
        if (spec === undefined) {
          unresolved.push(`${file}: no such command ${invocation.command}`);
          continue;
        }
        const declared = new Set(spec.flags.map((flag) => flag.name));
        for (const flag of invocation.flags)
          if (!declared.has(flag) && !GLOBAL_FLAGS.has(flag))
            unresolved.push(`${file}: ${invocation.command} does not declare --${flag}`);
      }
    }
    expect(unresolved).toEqual([]);
    // The playbook is the only hand-written reference that spells invocations out; if that stops
    // being true the guard must still be running against something.
    expect(checked).toBeGreaterThan(40);
  });

  test("configuration.md defaults are the defaults the harness actually resolves", () => {
    const rows = readFileSync(join(referenceDir, "configuration.md"), "utf8").split("\n");
    const wrong: string[] = [];
    for (const [key, value] of Object.entries(DEFAULT_RESOLVED_CONFIG)) {
      const row = rows.find((line) => line.startsWith(`| \`${key}\``));
      if (row === undefined) wrong.push(`${key} is not documented`);
      else if (!row.includes(`\`${String(value)}\``))
        wrong.push(`${key} documents a default other than ${String(value)}`);
    }
    expect(wrong).toEqual([]);
  });

  test("configuration.md documents every configurable key with its default", () => {
    const configuration = readFileSync(join(referenceDir, "configuration.md"), "utf8");
    for (const key of [
      "min_adversarial_probes",
      "max_repair_rounds",
      "max_branch_depth",
      "max_agents",
      "max_output_bytes",
      "default_lease_seconds",
      "default_max_parallel",
    ])
      expect(configuration).toContain(key);
    expect(configuration).not.toContain("bun ");
  });
});
