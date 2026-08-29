import type { RepositoryBinding } from "../../../core/contracts/index";
import { sameCommandJson } from "../models/command-shape";

export const TRUSTED_HOST_ASSURANCE = "trusted_host_observed_v1" as const;

export function sameRepositoryObservation(
  expected: RepositoryBinding,
  actual: RepositoryBinding,
): boolean {
  return sameCommandJson(expected, actual);
}
