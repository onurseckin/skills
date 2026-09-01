import { join } from "node:path";
import { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { type OpenDescriptor, norm, isVirtualPath, setCustomMode } from "./virtual-fs-state.ts";
import { createWorkflowFsSpies } from "./virtual-fs-spies.ts";

export interface WorkflowVirtualFsSession {
  vfs: VirtualMemoryFS;
  openDescriptors: Map<number, OpenDescriptor>;
  cleanup: () => void;
}

export function setupWorkflowVirtualFs(customVfs?: VirtualMemoryFS): WorkflowVirtualFsSession {
  const vfs = customVfs ?? new VirtualMemoryFS();
  const repoRoot = process.cwd();
  vfs.mkdirSync(repoRoot, { recursive: true });
  vfs.mkdirSync(join(repoRoot, "tests/runner/receipt"), { recursive: true });
  vfs.mkdirSync(join(repoRoot, "tests/runner/signing"), { recursive: true });
  vfs.writeFileSync(join(repoRoot, "tests/runner/receipt/output-evidence.test.ts"), "// test\n");
  vfs.writeFileSync(join(repoRoot, "tests/runner/signing/gate-path-binding.test.ts"), "// test\n");
  vfs.mkdirSync("/bin", { recursive: true });
  vfs.mkdirSync("/usr/bin", { recursive: true });
  vfs.mkdirSync("/usr/local/bin", { recursive: true });
  vfs.writeFileSync("/usr/local/bin/bun", "#!/bin/sh\nexit 0\n");
  vfs.writeFileSync("/usr/bin/bun", "#!/bin/sh\nexit 0\n");
  vfs.writeFileSync("/bin/bun", "#!/bin/sh\nexit 0\n");
  setCustomMode("/usr/local/bin/bun", 0o755);
  setCustomMode("/usr/bin/bun", 0o755);
  setCustomMode("/bin/bun", 0o755);
  const openDescriptors = new Map<number, OpenDescriptor>();
  const { cleanup } = createWorkflowFsSpies(vfs, openDescriptors);

  return {
    vfs,
    openDescriptors,
    cleanup,
  };
}

export { norm, isVirtualPath, type OpenDescriptor };
