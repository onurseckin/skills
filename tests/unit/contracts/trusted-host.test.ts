import { describe, expect, test } from "bun:test";
import {
  sameTrustedHostRepositoryBinding,
  trustedHostEvidence,
  trustedHostLimitations,
} from "../../../olt/scripts/src/core/contracts/trusted-host.ts";
import type { RepositoryBinding } from "../../../olt/scripts/src/core/contracts/repository.ts";

function binding(overrides: Partial<RepositoryBinding> = {}): RepositoryBinding {
  return {
    schema: "harness.repository-binding",
    version: 1,
    inspection_sha256: "1".repeat(64),
    git_identity_sha256: "2".repeat(64),
    content_sha256: "3".repeat(64),
    file_count: 10,
    total_bytes: 2048,
    ...overrides,
  };
}

describe("trustedHostEvidence / trustedHostLimitations", () => {
  test("returns fresh copies, not the same shared reference, each call", () => {
    const first = trustedHostEvidence();
    const second = trustedHostEvidence();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);

    const firstLimits = trustedHostLimitations();
    const secondLimits = trustedHostLimitations();
    expect(firstLimits).toEqual(secondLimits);
    expect(firstLimits).not.toBe(secondLimits);
  });
});

describe("sameTrustedHostRepositoryBinding", () => {
  test("is true for two bindings identical in every compared field", () => {
    expect(sameTrustedHostRepositoryBinding(binding(), binding())).toBeTrue();
  });

  test("is false when any single compared field differs", () => {
    const base = binding();
    for (const [key, value] of Object.entries({
      schema: "different",
      inspection_sha256: "9".repeat(64),
      git_identity_sha256: "9".repeat(64),
      content_sha256: "9".repeat(64),
      file_count: 99,
      total_bytes: 99,
    })) {
      const other = binding({ [key]: value } as Partial<RepositoryBinding>);
      expect(sameTrustedHostRepositoryBinding(base, other)).toBeFalse();
    }
  });

  test("is false when the schema version differs", () => {
    const other = { ...binding(), version: 2 } as unknown as RepositoryBinding;
    expect(sameTrustedHostRepositoryBinding(binding(), other)).toBeFalse();
  });
});
