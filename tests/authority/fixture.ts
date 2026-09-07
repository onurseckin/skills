import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { setDefectLogDependenciesForTesting } from "../../olt/scripts/src/logging/lock.ts";
import { generateCanonicalDefaultPolicy } from "../../olt/scripts/src/policy/generator/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession | undefined;
let restoreDefectDeps: (() => void) | undefined;
let counter = 0;

function normPath(p: string): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

function slug(value: string): string {
  const cleaned = value
    .replace(/\.+/g, "-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const trimmed = cleaned.slice(0, 20).replace(/-+$/, "");
  return trimmed.length > 0 ? trimmed : "root";
}

function shortDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

const STANDARD_COMPACT_AGENTS: Array<{ role: string; tier: number; desc: string }> = [
  { role: "mind", tier: 0, desc: "Autonomous consciousness" },
  { role: "orchestrator", tier: 1, desc: "Plan supervisor" },
  { role: "coordinator", tier: 2, desc: "Wave execution" },
  { role: "implementer", tier: 3, desc: "Scoped modular implementer" },
  { role: "validator", tier: 3, desc: "Adversarial verifier" },
];

export function getCompactAgentManifestFiles(): Array<{ filename: string; content: string }> {
  const files: Array<{ filename: string; content: string }> = [];
  for (const a of STANDARD_COMPACT_AGENTS) {
    const yaml = `name: "${a.role}"\nrole: "${a.role}"\ntier: ${a.tier}\ninterface:\n  display_name: "${a.role.toUpperCase()} Agent"\n  short_description: "${a.desc}"\n  role: "${a.role}"\n  tier: ${a.tier}\npermissions:\n  may:\n    - "task:claim"\n  must_not:\n    - "boundary:breach"\ninstructions: "${a.desc}"\n`;
    files.push({ filename: `${a.role}.yaml`, content: yaml });

    const md = `---\nname: "${a.role}"\nrole: "${a.role}"\ntier: ${a.tier}\npermissions:\n  may:\n    - "task:claim"\n  must_not:\n    - "boundary:breach"\n---\n# Role: ${a.role}\n\n${a.desc}\n`;
    files.push({ filename: `${a.role}.md`, content: md });
  }
  return files;
}

export function seedVirtualAuthorityManifests(
  vfsInstance: VirtualMemoryFS = vfs,
  rootDir = "/virtual/skills",
): void {
  const files = getCompactAgentManifestFiles();
  const targetDirs = [
    path.join(rootDir, "agents"),
    path.join(rootDir, "olt", "agents"),
    path.join(rootDir, ".olt", "agents"),
  ];
  for (const dir of targetDirs) {
    vfsInstance.mkdirSync(dir, { recursive: true });
    for (const item of files) {
      vfsInstance.writeFileSync(path.join(dir, item.filename), item.content);
    }
  }
}

export function setupVirtualAuthorityFS(): VirtualMemoryFS {
  cleanupVirtualAuthorityFS();
  vfs = new VirtualMemoryFS();
  const repoRoot = normPath(process.cwd());
  vfs.mkdirSync(repoRoot, { recursive: true });
  vfs.mkdirSync(path.join(repoRoot, ".olt"), { recursive: true });
  vfs.writeFileSync(
    path.join(repoRoot, ".olt", "policy.json"),
    JSON.stringify(generateCanonicalDefaultPolicy(repoRoot, "bun")),
  );
  vfs.chdir(repoRoot);

  seedVirtualAuthorityManifests(vfs, "/virtual/skills");

  session = createVirtualFSSession(vfs);
  restoreDefectDeps = setDefectLogDependenciesForTesting({
    readFile: (p, opt) => {
      const np = normPath(String(p));
      const enc = typeof opt === "string" ? opt : opt?.encoding;
      return vfs.readFileSync(np, enc as BufferEncoding);
    },
  });
  return vfs;
}

export function cleanupVirtualAuthorityFS(): void {
  if (session) {
    session.cleanup();
    session = undefined;
  }
  if (restoreDefectDeps) {
    restoreDefectDeps();
    restoreDefectDeps = undefined;
  }
  vfs.reset();
}

export function getVirtualAuthorityFS(): VirtualMemoryFS {
  return vfs;
}

export function scratchRoot(callerPath = "authority-test", label = "test"): string {
  const currentFs = setupVirtualAuthorityFS();
  counter += 1;
  const fileTag = slug(callerPath);
  const labelTag = slug(label);
  const digest = shortDigest(`${fileTag}:${labelTag}:${counter}`);
  const raw = `${fileTag}-${labelTag}-${counter}-${digest}`
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");
  const dirName = raw.slice(0, 50).replace(/-+$/, "");
  const root = `/virtual/authority-scratch/${dirName}`;
  currentFs.mkdirSync(root, { recursive: true });
  return root;
}

export function createSandboxDir(label = "sandbox"): string {
  return scratchRoot("sandbox", label);
}

export function createSymlinkInVirtualAuthorityFS(target: string, linkPath: string): void {
  if (session) {
    session.symlinkSync(target, linkPath);
  }
}

export function openSync(filePath: string, flags: string | number = "w+"): number {
  if (!session) {
    setupVirtualAuthorityFS();
  }
  return session!.openSync(filePath, flags);
}

export function closeSync(descriptor: number): void {
  if (session) {
    session.closeSync(descriptor);
  }
}
