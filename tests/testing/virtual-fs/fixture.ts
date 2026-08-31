import { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export function createTestVirtualMemoryFS(): VirtualMemoryFS {
  const fs = new VirtualMemoryFS();
  fs.mkdirSync("/fixtures", { recursive: true });
  fs.writeFileSync("/fixtures/sample.txt", "sample virtual content");
  return fs;
}
