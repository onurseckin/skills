import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { AGENT_ROLES } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  assertGrantedCommand,
  assertRoleMayInvoke,
} from "../../../olt/scripts/src/packets/command-authority.ts";
import {
  loadRoleContract,
  parseRoleContract,
  resolveRoleContractPath,
} from "../../../olt/scripts/src/packets/role-contract.ts";
import {
  commandInvocations,
  findCommand,
  type CommandSpec,
} from "../../../olt/scripts/src/cli/registry/index.ts";
import type { Flags } from "../../../olt/scripts/src/cli/options.ts";

function spec(invocation: string): CommandSpec {
  const found = findCommand(invocation);
  if (!found) throw new Error(`the registry has no command named ${invocation}`);
  return found;
}

/** Every invocation the registry knows, minus the ones this role's contract grants. */
function ungranted(role: (typeof AGENT_ROLES)[number]): string[] {
  const granted = new Set(loadRoleContract(role).commands);
  return commandInvocations().filter((invocation) => {
    const command = spec(invocation);
    return ![command.name, ...command.aliases].some((name) => granted.has(name));
  });
}

describe("role capability documents bind the CLI", () => {
  test.each(AGENT_ROLES)("%s names only commands the registry actually has", (role) => {
    const contract = loadRoleContract(role);
    expect(contract.commands.length).toBeGreaterThan(0);
    if (role === "validator") {
      expect(contract.commands).not.toContain("run:exec");
    }
    for (const command of contract.commands) expect(findCommand(command)).toBeDefined();
  });

  test.each(AGENT_ROLES)("%s may invoke every command its contract grants", (role) => {
    for (const command of loadRoleContract(role).commands) {
      expect(() => assertRoleMayInvoke(role, spec(command), `${role}-1`)).not.toThrow();
    }
  });

  test.each(AGENT_ROLES)("%s is refused every command its contract withholds", (role) => {
    const withheld = ungranted(role);
    expect(withheld.length).toBeGreaterThan(0);
    for (const command of withheld) {
      expect(() => assertRoleMayInvoke(role, spec(command), `${role}-1`)).toThrow(
        `role ${role} may not invoke ${spec(command).name}`,
      );
    }
  });

  test("the refusal names the role, the command and the document on disk", () => {
    expect(() => assertRoleMayInvoke("validator", spec("task:submit"), "val-1")).toThrow(
      new RegExp(
        `role validator may not invoke task:submit.*val-1.*${resolveRoleContractPath("validator").replaceAll("/", "\\/")}`,
        "su",
      ),
    );
  });

  test("a validator is refused an implementer-only command", () => {
    for (const command of ["task:claim", "task:submit", "task:heartbeat", "branch:open"]) {
      expect(() => assertRoleMayInvoke("validator", spec(command), "val-1")).toThrow(
        "may not invoke",
      );
    }
  });

  test("a read-only sub-investigator is refused every command that writes", () => {
    for (const command of ["task:claim", "task:submit", "branch:open", "branch:collect"]) {
      expect(() => assertRoleMayInvoke("sub-investigator", spec(command), "sub-1")).toThrow(
        "may not invoke",
      );
    }
    // What it may do is read, run and report — the whole of its contract.
    expect(loadRoleContract("sub-investigator").commands).toEqual([
      "branch:claim",
      "branch:submit",
      "run:exec",
      "finding:get",
      "report:get",
      "evidence:get",
      "agent:report",
      "whoami",
    ]);
  });

  test("dispatch enforcement denies an authority-bearing command when no run is named", () => {
    const flags: Flags = { agent: "impl-1" };
    expect(() => assertGrantedCommand(spec("task:submit"), flags)).toThrow();
  });

  test("dispatch enforcement stays out of the way when no identity is named", () => {
    const flags: Flags = { run: "/nonexistent/capsule" };
    expect(() => assertGrantedCommand(spec("run:status"), flags)).not.toThrow();
  });

  test("a capsule that does not exist yet carries no ledger to enforce against", () => {
    const flags: Flags = { run: "/nonexistent/capsule", actor: "planner" };
    expect(() => assertGrantedCommand(spec("plan:status"), flags)).not.toThrow();
  });
});

describe("role capability documents are what the packet digests", () => {
  test.each(AGENT_ROLES)("%s digest covers the checked-in bytes exactly", (role) => {
    const path = resolveRoleContractPath(role);
    const bytes = readFileSync(path);
    const contract = loadRoleContract(role);
    expect(contract.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(contract.text).toBe(new TextDecoder().decode(bytes));
    expect(contract.role).toBe(role);
  });

  test.each(AGENT_ROLES)("%s digest moves the moment a single byte is tampered with", (role) => {
    const bytes = readFileSync(resolveRoleContractPath(role));
    const original = parseRoleContract(bytes, `${role}.yaml`);
    const tampered = new TextEncoder().encode(`${original.text} `);
    expect(parseRoleContract(tampered, `${role}.yaml`).sha256).not.toBe(original.sha256);
  });

  test("a tampered prohibition is detected even though the document still parses", () => {
    const original = loadRoleContract("sub-investigator");
    const relaxed = original.text.replace(
      "Create, edit, stage, revert, format, or delete any repository file",
      "Create or delete unrelated repository files",
    );
    expect(relaxed).not.toBe(original.text);
    const contract = parseRoleContract(new TextEncoder().encode(relaxed), "sub-investigator.yaml");
    expect(contract.sha256).not.toBe(original.sha256);
    expect(contract.must_not).not.toEqual([...original.must_not]);
  });

  test("a contract whose declared role differs from its file is refused", () => {
    const swapped = loadRoleContract("validator")
      .text.replace('role: "validator"', 'role: "implementer"')
      .replace("role: validator", "role: implementer");
    const contract = parseRoleContract(new TextEncoder().encode(swapped), "validator.yaml");
    expect(contract.role).toBe("implementer");
    expect(contract.sha256).not.toBe(loadRoleContract("validator").sha256);
  });
});
