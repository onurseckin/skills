/**
 * Validator Roles & Hardlock Facade.
 */
export {
  assertCognitiveValidatorHardlock,
  isCognitiveValidatorRole,
  isMechanicValidatorRole,
  isExecutionCommand,
  isExecutionToolCategory,
  isProhibitedCognitiveTool,
  validateHierarchicalSpawning,
  assertHierarchicalSpawning,
  assertRoleMayInvoke,
  assertGrantedCommand,
} from "../../../../olt/scripts/src/packets/command-authority.ts";
