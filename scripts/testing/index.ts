export {
  computeIsMain as computeIsChangedMain,
  findAllTestFiles,
  getChangedFiles,
  gitOutput,
  main as runTestChangedMain,
  parseCoverageOutput,
  resolveAffectedTestFiles,
  run as runTestChanged,
  type FileCoverageSummary,
} from "./test-changed.ts";

export { acquireTestLock, isProcessAlive, type TestLockData } from "./test-mutex.ts";

export {
  computeIsMain as computeIsRunnerMain,
  executeTestRunner,
  main as runTestRunnerMain,
} from "./test-runner.ts";

import * as reporting from "./reporting/index.ts";

export { reporting };
