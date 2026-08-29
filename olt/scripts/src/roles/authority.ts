import { HarnessError } from "../core/errors/index.ts";
import type { AbstractProfile } from "./types.ts";

export const FORBIDDEN_VALIDATOR_COMMANDS: ReadonlySet<string> = new Set<string>([
  "run:exec",
  "task:claim",
  "task:submit",
  "task:assign-repairer",
  "shell",
  "run_command",
  "edit_file",
  "write_to_file",
]);

export function validateRoleAuthorityInvariants(
  roleName: string,
  profile: AbstractProfile,
  grantedCommands: readonly string[],
): void {
  const isAdversarialOrValidator =
    profile === "adversarial" || roleName.startsWith("validator") || roleName.includes("critic");

  if (isAdversarialOrValidator) {
    for (const cmd of grantedCommands) {
      if (FORBIDDEN_VALIDATOR_COMMANDS.has(cmd)) {
        throw new HarnessError(
          "ROLE_CONFINEMENT_VIOLATION",
          `Role '${roleName}' with profile '${profile}' violated authority invariants: forbidden validator command '${cmd}' granted.`,
        );
      }
    }
  }
}
