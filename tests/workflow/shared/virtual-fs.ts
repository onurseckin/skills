import { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { type OpenDescriptor, norm, isVirtualPath } from "./virtual-fs-state.ts";
import { createWorkflowFsSpies } from "./virtual-fs-spies.ts";

export interface WorkflowVirtualFsSession {
  vfs: VirtualMemoryFS;
  openDescriptors: Map<number, OpenDescriptor>;
  cleanup: () => void;
}

export function setupWorkflowVirtualFs(customVfs?: VirtualMemoryFS): WorkflowVirtualFsSession {
  const vfs = customVfs ?? new VirtualMemoryFS();
  const openDescriptors = new Map<number, OpenDescriptor>();
  const { cleanup } = createWorkflowFsSpies(vfs, openDescriptors);

  return {
    vfs,
    openDescriptors,
    cleanup,
  };
}

export { norm, isVirtualPath, type OpenDescriptor };
