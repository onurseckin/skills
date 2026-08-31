import type { RepoPolicy } from "../../../olt/scripts/src/policy/types/index.ts";
import { CURRENT_POLICY_SCHEMA_VERSION } from "../../../olt/scripts/src/policy/types/index.ts";

export const sampleIoPolicy: RepoPolicy = {
  schema_version: CURRENT_POLICY_SCHEMA_VERSION,
  ecosystem: "bun",
  package_manager: "bun",
  test_runner: {
    default_command: "bun test",
    targeted_pattern: "bun test <path>",
    full_suite_command: "bun test",
  },
  read_scope_neighborhood_depth: 2,
};
