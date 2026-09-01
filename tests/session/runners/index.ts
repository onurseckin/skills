/**
 * Session Capture Runners & Browser Pool Facade.
 */
export { BrowserPoolManager } from "../../../olt/scripts/src/capture/pool/index.ts";
export { isInstanceExpired } from "../../../olt/scripts/src/capture/pool/pool-queue.ts";

export {
  DefaultFallbackBrowserProvider,
  filterScreens,
  resolveCaptureOutputDir,
  resolveViewportsForScreen,
  runLiveCapture,
  createSyntheticPngBuffer,
} from "../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";

export {
  createSnapshotContext,
  computeNodeStateHash,
  computeMerkleRoot,
  verifySnapshotIntegrity,
} from "../../../olt/scripts/src/capture/snapshot/index.ts";
