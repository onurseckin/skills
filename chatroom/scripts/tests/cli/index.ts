import { deriveTestSuite } from "../../src/testing/index.ts";

export { guardsTestsSuite } from "./guards/index.ts";
export { lifecycleTestsSuite } from "./lifecycle/index.ts";
export { workCliTestsSuite } from "./work/index.ts";

export const TEST_MODULE = "chatroom-cli";
export const CLI_TEST_MODULE = TEST_MODULE;
export const suites = deriveTestSuite(import.meta.url);
export const cliTestsSuite = suites;

export function discoverTests(): readonly string[] {
  return suites;
}
