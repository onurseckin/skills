import { describe, expect, test } from "bun:test";
import {
  repositoryBindingIsValid,
  sameRepositoryBinding,
} from "../../../../orchestrating-long-tasks/scripts/src/workflow/completion/repository-binding.ts";
import { repositoryBinding } from "../test-port.ts";

describe("repositoryBindingIsValid", () => {
  test("is true for a well-formed repository binding", () => {
    expect(repositoryBindingIsValid(repositoryBinding)).toBe(true);
  });

  test("is false for a malformed value, without throwing", () => {
    expect(repositoryBindingIsValid({ not: "a binding" })).toBe(false);
    expect(repositoryBindingIsValid(null)).toBe(false);
    expect(repositoryBindingIsValid("nope")).toBe(false);
  });
});

describe("sameRepositoryBinding", () => {
  test("is true for two structurally identical bindings", () => {
    expect(sameRepositoryBinding(repositoryBinding, { ...repositoryBinding })).toBe(true);
  });

  test("is false for two bindings that differ", () => {
    expect(
      sameRepositoryBinding(repositoryBinding, {
        ...repositoryBinding,
        content_sha256: "9".repeat(64),
      }),
    ).toBe(false);
  });

  test("is false, without throwing, when either side is not a well-formed binding at all", () => {
    expect(sameRepositoryBinding(repositoryBinding, { not: "a binding" })).toBe(false);
    expect(sameRepositoryBinding(null, repositoryBinding)).toBe(false);
    expect(sameRepositoryBinding(undefined, undefined)).toBe(false);
  });
});
