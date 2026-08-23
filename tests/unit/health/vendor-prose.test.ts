import { afterAll, describe, expect, test } from "bun:test";
import { checkUnqualifiedDispatch } from "../../../olt/scripts/src/health/vendors.ts";
import { cleanupTempRoots, tempRoot, writeTree } from "./fixture.ts";

afterAll(cleanupTempRoots);

function scan(files: Record<string, string>, exempt?: readonly string[]) {
  const root = writeTree(tempRoot("dispatch"), files);
  return checkUnqualifiedDispatch([
    { label: "skill", root, ...(exempt === undefined ? {} : { exempt }) },
  ]);
}

describe("a host's dispatch call must name the host, everywhere it is written down", () => {
  test("the coordinator.yaml regression: a bare call captioned as universal is reported", () => {
    // Verbatim shape of the real regression (agents/coordinator.yaml, fixed in 0fa50f9): the call
    // sits directly under prose calling it "the shape of the call", no host named anywhere near it.
    const findings = scan({
      "coordinator.yaml": [
        "      - Dispatch every task the snapshot shows as claimable. A single subagent call may",
        "        launch several pairs at once when the host allows it — that is a batching",
        "        convenience, not a synchronisation requirement:",
        "        ```typescript",
        "        invoke_subagent({",
        '          Subagents: [{ Role: "Implementer 1", TypeName: "self", Prompt: "..." }]',
        "        });",
        "        ```",
      ].join("\n"),
    }).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toContain("invoke_subagent");
    expect(findings[0]?.detail).toContain("antigravity");
  });

  test("the run-playbook.md regression: the same bare call under a host-agnostic heading is reported", () => {
    // Verbatim shape of the real regression (references/run-playbook.md:81, still open at time of
    // writing): "## Phase 2 — Continuous dispatch" names no host, and the paragraph introducing the
    // code fence says only "this is the shape of the call" — no host anywhere in reach.
    const findings = scan({
      "run-playbook.md": [
        "## Phase 2 — Continuous dispatch",
        "",
        "Dispatch each claimable task as a pair; this is the shape of the call:",
        "",
        "```typescript",
        "invoke_subagent({",
        '  Subagents: [{ Role: "Implementer 1", TypeName: "self", Prompt: "..." }],',
        "});",
        "```",
      ].join("\n"),
    }).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(6);
  });

  test("restored: the same call qualified by a preceding sentence naming the host passes", () => {
    // The shape host-adapters.md actually uses ("Native primitives"): the host is named in the
    // same paragraph as the call, immediately before it.
    const findings = scan({
      "host-adapters.md": [
        "**Workspace isolation.** Antigravity's `invoke_subagent` accepts `Workspace`:",
        '`"inherit"` (default) | `"branch"` (a new isolated workspace).',
      ].join("\n"),
    }).findings;
    expect(findings).toEqual([]);
  });

  test("an adapter table row naming the host is exactly what the rule permits", () => {
    const findings = scan({
      "host-adapters.md": [
        "| Host | Dispatch |",
        "|:--|:--|",
        "| **Claude Code** | `Agent` tool |",
        "| **Antigravity** | `invoke_subagent` |",
        "| **Codex** | tool `spawn_agent` |",
      ].join("\n"),
    }).findings;
    expect(findings).toEqual([]);
  });

  test("a markdown heading naming the host qualifies every paragraph in its section", () => {
    const findings = scan({
      "architecture.md": [
        "### 1. Google Antigravity",
        "",
        "- Uses native `invoke_subagent` to dispatch workers.",
        "",
        "### 2. Codex",
        "",
        "- Uses `spawn_agent` to dispatch workers.",
      ].join("\n"),
    }).findings;
    expect(findings).toEqual([]);
  });

  test("a heading naming one host does not qualify a call belonging to a different host", () => {
    const findings = scan({
      "architecture.md": [
        "### Google Antigravity",
        "",
        "- Uses `spawn_agent` to dispatch workers.",
      ].join("\n"),
    }).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toContain("codex");
  });

  test("a YAML file has no heading syntax; only its own paragraph can qualify a call", () => {
    // `#` opens a YAML comment, not a section — a comment naming the host two lines above a
    // blank-line-separated block must not carry the qualification forward.
    const findings = scan({
      "worker.yaml": ["# Antigravity notes", "", "call: invoke_subagent"].join("\n"),
    }).findings;
    expect(findings).toHaveLength(1);
  });

  test("a vendor name recorded far away in the same file does not qualify a later call", () => {
    const findings = scan({
      "doc.md": [
        "Antigravity is one of several supported hosts.",
        "",
        "## Unrelated section",
        "",
        "this is the shape of the call:",
        "",
        "```typescript",
        "invoke_subagent({});",
        "```",
      ].join("\n"),
    }).findings;
    expect(findings).toHaveLength(1);
  });
});

describe("an exemption is a decision, and it cannot outlive what it covered", () => {
  test("an exempt path is not reported", () => {
    expect(
      scan({ "drafts/scratch.md": "this is the shape of the call: `invoke_subagent`" }, ["drafts"])
        .findings,
    ).toEqual([]);
  });

  test("an exemption for a path that no longer exists is itself a finding", () => {
    const findings = scan({ "clean.md": "nothing here\n" }, ["drafts/gone.md"]).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.detail).toContain("no longer exists");
  });
});

describe("the sweep says which trees it covered and which hosts it cannot see", () => {
  test("a tree that does not exist is reported, never silently counted as clean", () => {
    const findings = checkUnqualifiedDispatch([
      { label: "skill", root: `${tempRoot("absent")}/missing` },
    ]).findings;
    expect(findings[0]?.detail).toContain("was not swept");
  });

  test("the limitations name the tracked hosts and the swept tree", () => {
    const result = scan({ "clean.md": "nothing here\n" });
    expect(result.scanned).toBe(1);
    expect(result.limitations.join(" ")).toContain("antigravity");
    expect(result.limitations.join(" ")).toContain("codex");
    expect(result.limitations.join(" ")).toContain("skill");
  });
});
