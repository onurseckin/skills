import type { Mock } from "bun:test";
import { join } from "node:path";
import { VirtualMemoryFS } from "../../olt/scripts/src/testing/virtual-fs/index.ts";
import { createAsyncFsSpies } from "./fs-async-spies.ts";
import { createSyncFsSpies } from "./fs-sync-spies.ts";
import { createNativeSpies } from "./native-spies.ts";
import { normPath, vfsState } from "./virtual-state.ts";

let activeSpies: Array<Mock<(...args: unknown[]) => unknown> | { mockRestore: () => void }> = [];

export function setupVirtualInstallerFS(): VirtualMemoryFS {
  cleanupVirtualInstallerFS();
  vfsState.vfs = new VirtualMemoryFS();
  vfsState.customMtimes.clear();
  vfsState.customModes.clear();
  vfsState.symlinks.clear();
  vfsState.openDescriptors.clear();
  vfsState.inodeMap.clear();
  vfsState.specialFiles.clear();
  vfsState.inodeLockOwners.clear();
  vfsState.errnoBuf[0] = 0;

  activeSpies = [...createSyncFsSpies(), ...createAsyncFsSpies(), ...createNativeSpies()];

  return vfsState.vfs;
}

export function cleanupVirtualInstallerFS(): void {
  for (const s of activeSpies) {
    try {
      s.mockRestore();
    } catch {}
  }
  activeSpies = [];
  vfsState.openDescriptors.clear();
  vfsState.customMtimes.clear();
  vfsState.customModes.clear();
  vfsState.symlinks.clear();
  vfsState.inodeMap.clear();
  vfsState.specialFiles.clear();
  vfsState.inodeLockOwners.clear();
  vfsState.vfs.reset();
}

export async function installerFixture(): Promise<{ root: string; source: string; home: string }> {
  setupVirtualInstallerFS();
  const id = ++vfsState.fixtureCount;
  const root = `/virtual/installer-repair-${id}`;
  const source = join(root, "source");
  const home = join(root, "home");
  vfsState.vfs.mkdirSync(join(source, "scripts", "src", "config"), { recursive: true });
  vfsState.vfs.mkdirSync(home, { recursive: true });
  vfsState.vfs.writeFileSync(join(source, "SKILL.md"), "---\nname: olt\ndescription: test\n---\n");
  vfsState.vfs.writeFileSync(join(source, "scripts", "harness.ts"), "console.log('ok')\n");
  vfsState.customModes.set(normPath(join(source, "scripts", "harness.ts")), 0o755);
  vfsState.vfs.writeFileSync(
    join(source, "scripts", "package.json"),
    JSON.stringify({ name: "@local/olt-runtime", private: true }),
  );
  vfsState.vfs.writeFileSync(
    join(source, "scripts", "src", "config", "constants.ts"),
    'export const RUNTIME_VERSION = "0.1.0";\n',
  );
  return { root, source, home };
}

export async function cleanInstallerFixtures(): Promise<void> {
  cleanupVirtualInstallerFS();
}

export function getVirtualInstallerFS(): VirtualMemoryFS {
  return vfsState.vfs;
}
