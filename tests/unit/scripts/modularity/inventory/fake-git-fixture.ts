import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitCommandPrefix } from "../../../../../scripts/modularity/inventory/index.ts";

export interface FakeGitBehavior {
  readonly lsFilesOutput: string;
  readonly lsFilesStatus?: number;
  readonly catFileOutput?: string;
  readonly catFileStatus?: number;
}

const FAKE_GIT_SOURCE = `import { readFile } from "node:fs/promises";
const [configPath, ...gitArgs] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, "utf8"));
const response = gitArgs.includes("ls-files") ? config.lsFiles : config.catFile;
process.stdout.write(response.output);
process.exitCode = response.status;
`;

export async function withFakeGit<T>(
  behavior: FakeGitBehavior,
  operation: (command: GitCommandPrefix) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "modularity-fake-git-"));
  const scriptPath = join(root, "fake-git.mjs");
  const configPath = join(root, "config.json");
  await Promise.all([
    writeFile(scriptPath, FAKE_GIT_SOURCE),
    writeFile(
      configPath,
      JSON.stringify({
        lsFiles: {
          output: behavior.lsFilesOutput,
          status: behavior.lsFilesStatus ?? 0,
        },
        catFile: {
          output: behavior.catFileOutput ?? "",
          status: behavior.catFileStatus ?? 0,
        },
      }),
    ),
  ]);
  try {
    return await operation([process.execPath, scriptPath, configPath]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
