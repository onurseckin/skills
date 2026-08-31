import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  canonicalizeHostId,
  canonicalHostFromOutcome,
  KNOWN_UNRESOLVABLE_HOST_IDS,
  parseHostProfiles,
} from "../../../olt/scripts/src/core/config/host-canon.ts";

describe("canonicalizeHostId", () => {
  test("resolves every closed-enum id to itself", () => {
    for (const id of ["antigravity", "claude-code", "cursor", "codex", "chatgpt"] as const) {
      expect(canonicalizeHostId(id)).toEqual({ kind: "resolved", host: id });
    }
  });

  test("resolves the declared claude alias to claude-code, not by substring guessing", () => {
    expect(canonicalizeHostId("claude")).toEqual({ kind: "resolved", host: "claude-code" });
  });

  test("refuses every known-but-unreconciled manifest and ledger id, never guessing a canonical host", () => {
    for (const id of KNOWN_UNRESOLVABLE_HOST_IDS) {
      expect(canonicalizeHostId(id)).toEqual({ kind: "known_unresolvable", rawId: id });
    }
  });

  test("distinguishes custom (a detection-failure sentinel) from a wholly unrecognized id", () => {
    expect(canonicalizeHostId("custom")).toEqual({ kind: "known_unresolvable", rawId: "custom" });
    expect(canonicalizeHostId("totally-made-up-host")).toEqual({
      kind: "unrecognized",
      rawId: "totally-made-up-host",
    });
  });

  test("resolves absent input to absent, never to antigravity", () => {
    expect(canonicalizeHostId(undefined)).toEqual({ kind: "absent" });
    expect(canonicalizeHostId(null)).toEqual({ kind: "absent" });
    expect(canonicalizeHostId("")).toEqual({ kind: "absent" });
    expect(canonicalizeHostId("   ")).toEqual({ kind: "absent" });
  });

  test("never substring-matches an unknown id containing a known token", () => {
    expect(canonicalizeHostId("claude-desktop")).toEqual({
      kind: "unrecognized",
      rawId: "claude-desktop",
    });
    expect(canonicalizeHostId("my-antigravity-fork")).toEqual({
      kind: "unrecognized",
      rawId: "my-antigravity-fork",
    });
  });
});

describe("canonicalHostFromOutcome", () => {
  test("resolved outcomes attest config_override", () => {
    const outcome = canonicalizeHostId("claude");
    expect(canonicalHostFromOutcome(outcome)).toEqual({
      value: "claude-code",
      source: "config_override",
    });
  });

  test("a known-unresolvable or unrecognized id is unreadable — operator intent existed, never assumed_default", () => {
    expect(canonicalHostFromOutcome(canonicalizeHostId("generic"))).toEqual({
      value: null,
      source: "unreadable",
    });
    expect(canonicalHostFromOutcome(canonicalizeHostId("totally-made-up-host"))).toEqual({
      value: null,
      source: "unreadable",
    });
  });

  test("absent input is absent — nobody supplied it — distinguishable from unreadable, never assumed_default", () => {
    expect(canonicalHostFromOutcome(canonicalizeHostId(undefined))).toEqual({
      value: null,
      source: "absent",
    });
    expect(canonicalHostFromOutcome(canonicalizeHostId(""))).toEqual({
      value: null,
      source: "absent",
    });
  });
});

describe("parseHostProfiles", () => {
  test("refuses an unknown host id key rather than silently dropping the profile", () => {
    expect(() =>
      parseHostProfiles({ generic: { timer_arming_mechanism: "none" } }, "harness.config.json"),
    ).toThrow(HarnessError);
    expect(() =>
      parseHostProfiles({ generic: { timer_arming_mechanism: "none" } }, "harness.config.json"),
    ).toThrow(/generic/);
  });

  test("refuses the openai/chatgpt mismatch rather than bridging it silently", () => {
    expect(() =>
      parseHostProfiles({ openai: { timer_arming_mechanism: "none" } }, "harness.config.json"),
    ).toThrow(HarnessError);
  });

  test("canonicalizes a claude key onto claude-code", () => {
    const profiles = parseHostProfiles(
      { claude: { timer_arming_mechanism: "bash_floor_loop", self_wake_supported: true } },
      "harness.config.json",
    );
    expect(profiles["claude-code"]).toEqual({
      timer_arming_mechanism: { value: "bash_floor_loop", source: "config_override" },
      wake_driver_present: { value: false, source: "absent" },
      self_wake_supported: { value: true, source: "config_override" },
      models_available: { value: [], source: "absent" },
    });
  });

  test("B4 — an absent models_available is absent, distinguishable from an explicit empty array", () => {
    const profiles = parseHostProfiles({ "claude-code": {} }, "harness.config.json");
    expect(profiles["claude-code"]?.models_available).toEqual({
      value: [],
      source: "absent",
    });
  });

  test("B4/B5 — an invalid (non-array) models_available is unreadable, distinguishable from absent", () => {
    const profiles = parseHostProfiles(
      { "claude-code": { models_available: "not-an-array" } },
      "harness.config.json",
    );
    expect(profiles["claude-code"]?.models_available).toEqual({
      value: [],
      source: "unreadable",
    });
  });

  test("B4 — an explicit empty models_available is config_override, distinguishable from absent", () => {
    const profiles = parseHostProfiles(
      { "claude-code": { models_available: [] } },
      "harness.config.json",
    );
    expect(profiles["claude-code"]?.models_available).toEqual({
      value: [],
      source: "config_override",
    });
  });

  test("B4 — a non-empty models_available is config_override and filters non-string entries", () => {
    const profiles = parseHostProfiles(
      { "claude-code": { models_available: ["opus", 7, "sonnet"] } },
      "harness.config.json",
    );
    expect(profiles["claude-code"]?.models_available).toEqual({
      value: ["opus", "sonnet"],
      source: "config_override",
    });
  });

  test("attests wake_driver_present as config_override only when the file states it explicitly", () => {
    const profiles = parseHostProfiles(
      { "claude-code": { wake_driver_present: true } },
      "harness.config.json",
    );
    expect(profiles["claude-code"]?.wake_driver_present).toEqual({
      value: true,
      source: "config_override",
    });
  });

  test("B5 — an absent wake_driver_present is absent, distinguishable from unreadable or explicit false", () => {
    const profiles = parseHostProfiles({ "claude-code": {} }, "harness.config.json");
    expect(profiles["claude-code"]?.wake_driver_present).toEqual({
      value: false,
      source: "absent",
    });
  });

  test("B5 — an invalid (non-boolean) wake_driver_present is unreadable, distinguishable from absent", () => {
    const profiles = parseHostProfiles(
      { "claude-code": { wake_driver_present: "yes" } },
      "harness.config.json",
    );
    expect(profiles["claude-code"]?.wake_driver_present).toEqual({
      value: false,
      source: "unreadable",
    });
  });

  test("B3 — an absent timer_arming_mechanism is absent, distinguishable from an explicit none", () => {
    const profiles = parseHostProfiles({ "claude-code": {} }, "harness.config.json");
    expect(profiles["claude-code"]?.timer_arming_mechanism).toEqual({
      value: "none",
      source: "absent",
    });
  });

  test("B3/B5 — an invalid timer_arming_mechanism is unreadable, distinguishable from absent or an explicit none", () => {
    const profiles = parseHostProfiles(
      { "claude-code": { timer_arming_mechanism: "not-a-real-mechanism" } },
      "harness.config.json",
    );
    expect(profiles["claude-code"]?.timer_arming_mechanism).toEqual({
      value: "none",
      source: "unreadable",
    });
  });

  test("B3 — an explicit none is config_override, distinguishable from absent or unreadable", () => {
    const profiles = parseHostProfiles(
      { "claude-code": { timer_arming_mechanism: "none" } },
      "harness.config.json",
    );
    expect(profiles["claude-code"]?.timer_arming_mechanism).toEqual({
      value: "none",
      source: "config_override",
    });
  });

  test("B3 — an absent self_wake_supported is absent, distinguishable from an explicit false", () => {
    const profiles = parseHostProfiles({ "claude-code": {} }, "harness.config.json");
    expect(profiles["claude-code"]?.self_wake_supported).toEqual({
      value: false,
      source: "absent",
    });
  });

  test("B5 — an invalid (non-boolean) self_wake_supported is unreadable, distinguishable from absent", () => {
    const profiles = parseHostProfiles(
      { "claude-code": { self_wake_supported: "yes" } },
      "harness.config.json",
    );
    expect(profiles["claude-code"]?.self_wake_supported).toEqual({
      value: false,
      source: "unreadable",
    });
  });

  test("B3 — an explicit false self_wake_supported is config_override, distinguishable from absent", () => {
    const profiles = parseHostProfiles(
      { "claude-code": { self_wake_supported: false } },
      "harness.config.json",
    );
    expect(profiles["claude-code"]?.self_wake_supported).toEqual({
      value: false,
      source: "config_override",
    });
  });

  test("returns an empty record for a non-object value rather than throwing", () => {
    expect(parseHostProfiles(["not", "an", "object"], "harness.config.json")).toEqual({});
    expect(parseHostProfiles(null, "harness.config.json")).toEqual({});
  });
});
