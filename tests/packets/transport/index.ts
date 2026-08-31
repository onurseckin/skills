/**
 * Transport Domain Facade.
 */
export {
  collectRepositoryContent,
  captureRepositorySnapshot,
  inspectRepositoryPaths,
} from "./content/index.ts";
export {
  runRepositoryGitCommand,
  spawnRepositoryGitCommand,
  inspectRepositoryGitIdentity,
  captureRepositoryGitMetadata,
} from "./git/index.ts";
