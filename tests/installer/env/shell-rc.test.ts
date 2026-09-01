import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectShellRcPath,
  ensurePathInShellRc,
  generateExportLine,
  isPathDeclaredInContent,
} from "../../../scripts/sync/shell-rc.ts";
import { cleanupVirtualInstallerFS, setupVirtualInstallerFS } from "../helpers.ts";

let tempDirCount = 0;

beforeEach(setupVirtualInstallerFS);
afterEach(cleanupVirtualInstallerFS);

function createTempDir(prefix: string): string {
  const dir = `/virtual/shell-rc-${prefix}-${++tempDirCount}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("shell-rc installer", () => {
  test("detectShellRcPath resolves correct file per shell", () => {
    const mockHome = createTempDir("home-");

    expect(detectShellRcPath({ shell: "/bin/zsh", homeDir: mockHome })).toBe(
      join(mockHome, ".zshrc"),
    );
    expect(detectShellRcPath({ shell: "/usr/bin/fish", homeDir: mockHome })).toBe(
      join(mockHome, ".config", "fish", "config.fish"),
    );
  });

  test("isPathDeclaredInContent detects varied declarations", () => {
    const home = "/Users/testuser";
    const binDir = "/Users/testuser/.local/bin";

    expect(
      isPathDeclaredInContent('export PATH="/Users/testuser/.local/bin:$PATH"', binDir, home),
    ).toBe(true);
    expect(isPathDeclaredInContent('export PATH="$HOME/.local/bin:$PATH"', binDir, home)).toBe(
      true,
    );
    expect(isPathDeclaredInContent('export PATH="${HOME}/.local/bin:$PATH"', binDir, home)).toBe(
      true,
    );
    expect(isPathDeclaredInContent("fish_add_path ~/.local/bin", binDir, home)).toBe(true);
    expect(isPathDeclaredInContent("export PATH=/other/dir:$PATH", binDir, home)).toBe(false);
  });

  test("generateExportLine formats fish and bash/zsh syntax", () => {
    const home = "/Users/testuser";
    const binDir = "/Users/testuser/.local/bin";

    const bashLine = generateExportLine(join(home, ".zshrc"), binDir, home);
    expect(bashLine).toContain('export PATH="$HOME/.local/bin:$PATH"');
    expect(bashLine).toContain("# Added by @onurseckin/skills (OLT CLI)");

    const fishLine = generateExportLine(join(home, ".config/fish/config.fish"), binDir, home);
    expect(fishLine).toContain("fish_add_path ~/.local/bin");
  });

  test("ensurePathInShellRc skips modification if already present (idempotent)", () => {
    const mockHome = createTempDir("home-");
    const rcPath = join(mockHome, ".zshrc");
    const initialContent = '# Existing config\nexport PATH="$HOME/.local/bin:$PATH"\n';
    writeFileSync(rcPath, initialContent, "utf-8");

    const result = ensurePathInShellRc({
      homeDir: mockHome,
      customRcPath: rcPath,
    });

    expect(result.modified).toBe(false);
    expect(result.reason).toBe("already_configured");
    expect(readFileSync(rcPath, "utf-8")).toBe(initialContent);
  });

  test("ensurePathInShellRc appends export line when missing", () => {
    const mockHome = createTempDir("home-");
    const rcPath = join(mockHome, ".zshrc");
    writeFileSync(rcPath, "# Existing config\nalias ll='ls -la'\n", "utf-8");

    const result = ensurePathInShellRc({
      homeDir: mockHome,
      customRcPath: rcPath,
    });

    expect(result.modified).toBe(true);
    expect(result.reason).toBe("appended");

    const updated = readFileSync(rcPath, "utf-8");
    expect(updated).toContain("alias ll='ls -la'");
    expect(updated).toContain('export PATH="$HOME/.local/bin:$PATH"');
  });

  test("ensurePathInShellRc creates RC file if not existing", () => {
    const mockHome = createTempDir("home-");
    const rcPath = join(mockHome, ".zshrc");

    const result = ensurePathInShellRc({
      homeDir: mockHome,
      customRcPath: rcPath,
    });

    expect(result.modified).toBe(true);
    expect(result.reason).toBe("created_and_appended");
    expect(existsSync(rcPath)).toBe(true);

    const content = readFileSync(rcPath, "utf-8");
    expect(content).toContain('export PATH="$HOME/.local/bin:$PATH"');
  });

  test("gracefully catches permission error without throwing", () => {
    const mockHome = createTempDir("home-");
    const rcPath = join(mockHome, ".zshrc");
    writeFileSync(rcPath, "read-only content", "utf-8");
    chmodSync(rcPath, 0o444); // read only

    const readOnlyDir = join(mockHome, "protected");
    mkdirSync(readOnlyDir);
    chmodSync(readOnlyDir, 0o555); // cannot write in directory

    const protectedRc = join(readOnlyDir, ".zshrc");

    const result = ensurePathInShellRc({
      homeDir: mockHome,
      customRcPath: protectedRc,
    });

    expect(result.modified).toBe(false);
    expect(result.reason).toContain("error:");

    // Reset permissions for cleanup
    chmodSync(readOnlyDir, 0o755);
  });
});
