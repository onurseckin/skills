import type { RepositoryBinding } from "../../core/contracts/index.ts";
import { sameCommandJson } from "./command-shape.ts";

export const TRUSTED_HOST_ASSURANCE = "trusted_host_observed_v1" as const;

export function sameRepositoryObservation(
  expected: RepositoryBinding,
  actual: RepositoryBinding,
): boolean {
  return sameCommandJson(expected, actual);
}
