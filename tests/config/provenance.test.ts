import { describe, expect, test } from "bun:test";
import {
  buildConfigProvenanceMap,
  CONFIG_VALUE_SOURCES,
  isConfigValueSource,
  TRACKED_CONFIG_KEYS,
  attestedFact,
  unattestedFact,
  unreadableFact,
} from "../../olt/scripts/src/core/config/provenance.ts";

describe("ConfigValueSource", () => {
  test("is exactly the four ratified variants", () => {
    const expected: readonly (typeof CONFIG_VALUE_SOURCES)[number][] = [
      "assumed_default",
      "config_override",
      "host_discovered",
      "unreadable",
    ];
    expect([...CONFIG_VALUE_SOURCES].sort()).toEqual([...expected].sort());
  });

  test("isConfigValueSource accepts only the ratified variants", () => {
    for (const source of CONFIG_VALUE_SOURCES) {
      expect(isConfigValueSource(source)).toBeTrue();
    }
    expect(isConfigValueSource("cli_flag")).toBeFalse();
    expect(isConfigValueSource("configured")).toBeFalse();
    expect(isConfigValueSource(undefined)).toBeFalse();
    expect(isConfigValueSource(42)).toBeFalse();
  });
});

describe("ExternallyAttestedFact", () => {
  test("attestedFact always carries config_override", () => {
    expect(attestedFact(7)).toEqual({ value: 7, source: "config_override" });
  });

  test("unattestedFact carries absent — nobody supplied it — never assumed_default or host_discovered", () => {
    expect(unattestedFact(null)).toEqual({ value: null, source: "absent" });
  });

  test("unreadableFact carries unreadable — operator intent existed and could not be recovered", () => {
    expect(unreadableFact(null)).toEqual({ value: null, source: "unreadable" });
  });

  test("absent and unreadable are mutually distinguishable, both distinguishable from config_override", () => {
    const absent = unattestedFact(0);
    const unreadable = unreadableFact(0);
    const configured = attestedFact(0);
    expect(absent.source).not.toBe(unreadable.source);
    expect(absent.source).not.toBe(configured.source);
    expect(unreadable.source).not.toBe(configured.source);
  });
});

describe("buildConfigProvenanceMap", () => {
  test("tags every tracked key as assumed_default when nothing is configured and nothing is discovered", () => {
    const map = buildConfigProvenanceMap(null, null, new Set());
    for (const key of TRACKED_CONFIG_KEYS) {
      expect(map[key]).toBe("assumed_default");
    }
  });

  test("tags a key host_discovered when it is undiscovered by any config layer but present in the discovered set", () => {
    const map = buildConfigProvenanceMap(null, null, new Set(["gate_max_parallel"]));
    expect(map.gate_max_parallel).toBe("host_discovered");
    expect(map.max_agents).toBe("assumed_default");
  });

  test("a capsule-layer key resolves config_override", () => {
    const map = buildConfigProvenanceMap({ max_repair_rounds: 4 }, null, new Set());
    expect(map.max_repair_rounds).toBe("config_override");
  });

  test("a repo-layer key beats capsule and host discovery for provenance purposes", () => {
    const map = buildConfigProvenanceMap(
      { gate_max_parallel: 3 },
      { gate_max_parallel: 3 },
      new Set(["gate_max_parallel"]),
    );
    expect(map.gate_max_parallel).toBe("config_override");
  });

  test("covers every tracked key with no gaps", () => {
    const map = buildConfigProvenanceMap(null, null, new Set());
    expect(Object.keys(map).sort()).toEqual([...TRACKED_CONFIG_KEYS].sort());
  });
});
