import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectShellRcPath,
  ensurePathInShellRc,
  generateExportLine,
  isPathDeclaredInContent,
} from "../../../scripts/sync/shell-rc.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("detectShellRcPath", () => {
  test("detects fish shell configuration path", () => {
    const root = scratchRoot(import.meta.path, "detect-rc-fish");
    const rcPath = detectShellRcPath({ shell: "/usr/local/bin/fish", homeDir: root });
    expect(rcPath).toBe(join(root, ".config", "fish", "config.fish"));
  });

  test("detects zsh shell configuration path", () => {
    const root = scratchRoot(import.meta.path, "detect-rc-zsh");
    const rcPath = detectShellRcPath({ shell: "/bin/zsh", homeDir: root });
    expect(rcPath).toBe(join(root, ".zshrc"));
  });

  test("detects bash shell configuration path with .bash_profile on darwin", () => {
    const root = scratchRoot(import.meta.path, "detect-rc-bash-profile");
    writeFileSync(join(root, ".bash_profile"), "# profile\n", "utf-8");

    const rcPath = detectShellRcPath({ shell: "/bin/bash", homeDir: root });
    if (process.platform === "darwin") {
      expect(rcPath).toBe(join(root, ".bash_profile"));
    } else {
      expect(rcPath).toBe(join(root, ".bashrc"));
    }
  });

  test("detects bash shell configuration path without .bash_profile", () => {
    const root = scratchRoot(import.meta.path, "detect-rc-bash");
    const rcPath = detectShellRcPath({ shell: "/bin/bash", homeDir: root });
    expect(rcPath).toBe(join(root, ".bashrc"));
  });

  test("falls back to existing config files when shell is unknown", () => {
    const root = scratchRoot(import.meta.path, "detect-rc-fallback-existing");
    writeFileSync(join(root, ".bashrc"), "# bashrc\n", "utf-8");

    const rcPath = detectShellRcPath({ shell: "/bin/unknown-sh", homeDir: root });
    expect(rcPath).toBe(join(root, ".bashrc"));
  });

  test("falls back to default OS rc when no config files exist", () => {
    const root = scratchRoot(import.meta.path, "detect-rc-fallback-empty");
    const rcPath = detectShellRcPath({ shell: "/bin/unknown-sh", homeDir: root });
    if (process.platform === "darwin") {
      expect(rcPath).toBe(join(root, ".zshrc"));
    } else {
      expect(rcPath).toBe(join(root, ".bashrc"));
    }
  });
});

describe("isPathDeclaredInContent", () => {
  test("returns true if exact binDir is present", () => {
    expect(
      isPathDeclaredInContent('export PATH="/custom/bin:$PATH"', "/custom/bin", "/home/user"),
    ).toBe(true);
  });

  test("returns true for $HOME-relative forms", () => {
    const home = "/Users/test";
    const binDir = "/Users/test/.local/bin";

    expect(isPathDeclaredInContent('export PATH="$HOME/.local/bin:$PATH"', binDir, home)).toBe(
      true,
    );
    expect(isPathDeclaredInContent('export PATH="${HOME}/.local/bin:$PATH"', binDir, home)).toBe(
      true,
    );
    expect(isPathDeclaredInContent("fish_add_path ~/.local/bin", binDir, home)).toBe(true);
    expect(isPathDeclaredInContent("PATH=$PATH:$HOME/.local/bin", binDir, home)).toBe(true);
  });

  test("returns false when .local/bin is preceded by an unmanaged variable or path", () => {
    const home = "/Users/test";
    const binDir = "/Users/test/.local/bin";
    expect(
      isPathDeclaredInContent('export PATH="$OTHER_PROJECT/.local/bin:$PATH"', binDir, home),
    ).toBe(false);
  });

  test("returns false when path is only present inside comments", () => {
    const home = "/Users/test";
    const binDir = "/Users/test/.local/bin";
    expect(
      isPathDeclaredInContent(
        '# export PATH="$HOME/.local/bin:$PATH"\n# fish_add_path ~/.local/bin',
        binDir,
        home,
      ),
    ).toBe(false);
  });

  test("returns false when path is in an unrelated variable assignment", () => {
    const home = "/Users/test";
    const binDir = "/Users/test/.local/bin";
    expect(isPathDeclaredInContent('export OTHER_TOOL_HOME="$HOME/.local/bin"', binDir, home)).toBe(
      false,
    );
  });

  test("returns false when path is a prefix of a different folder name", () => {
    const home = "/Users/test";
    const binDir = "/Users/test/.local/bin";
    expect(
      isPathDeclaredInContent('export PATH="$HOME/.local/bin_extra:$PATH"', binDir, home),
    ).toBe(false);
  });
});

describe("generateExportLine", () => {
  test("generates fish_add_path for fish config", () => {
    const home = "/Users/test";
    const lineHome = generateExportLine(
      "/Users/test/.config/fish/config.fish",
      "/Users/test/.local/bin",
      home,
    );
    expect(lineHome).toContain("fish_add_path ~/.local/bin");

    const lineAbs = generateExportLine(
      "/Users/test/.config/fish/config.fish",
      "/opt/tools/bin",
      home,
    );
    expect(lineAbs).toContain("fish_add_path /opt/tools/bin");
  });

  test("generates export PATH for bash/zsh config", () => {
    const home = "/Users/test";
    const lineHome = generateExportLine("/Users/test/.zshrc", "/Users/test/.local/bin", home);
    expect(lineHome).toContain('export PATH="$HOME/.local/bin:$PATH"');

    const lineAbs = generateExportLine("/Users/test/.zshrc", "/opt/tools/bin", home);
    expect(lineAbs).toContain('export PATH="/opt/tools/bin:$PATH"');
  });
});

describe("ensurePathInShellRc", () => {
  test("does nothing if path is already configured", () => {
    const root = scratchRoot(import.meta.path, "shell-rc-already-configured");
    const rcPath = join(root, ".zshrc");
    writeFileSync(rcPath, 'export PATH="$HOME/.local/bin:$PATH"\n', "utf-8");

    const result = ensurePathInShellRc({
      homeDir: root,
      customRcPath: rcPath,
      binDir: join(root, ".local", "bin"),
    });

    expect(result.modified).toBe(false);
    expect(result.reason).toBe("already_configured");
  });

  test("appends export block to existing rc file without trailing newline", () => {
    const root = scratchRoot(import.meta.path, "shell-rc-append-no-newline");
    const rcPath = join(root, ".zshrc");
    writeFileSync(rcPath, "alias ll='ls -la'", "utf-8");

    const result = ensurePathInShellRc({
      homeDir: root,
      customRcPath: rcPath,
      binDir: join(root, ".local", "bin"),
    });

    expect(result.modified).toBe(true);
    expect(result.reason).toBe("appended");

    const content = readFileSync(rcPath, "utf-8");
    expect(content).toContain("alias ll='ls -la'\n");
    expect(content).toContain('export PATH="$HOME/.local/bin:$PATH"');
  });

  test("appends export block to existing rc file with trailing newline", () => {
    const root = scratchRoot(import.meta.path, "shell-rc-append-with-newline");
    const rcPath = join(root, ".zshrc");
    writeFileSync(rcPath, "alias ll='ls -la'\n", "utf-8");

    const result = ensurePathInShellRc({
      homeDir: root,
      customRcPath: rcPath,
      binDir: join(root, ".local", "bin"),
    });

    expect(result.modified).toBe(true);
    expect(result.reason).toBe("appended");
  });

  test("creates new rc file if it does not exist", () => {
    const root = scratchRoot(import.meta.path, "shell-rc-create");
    const rcPath = join(root, ".config", "fish", "config.fish");

    const result = ensurePathInShellRc({
      homeDir: root,
      customRcPath: rcPath,
      binDir: join(root, ".local", "bin"),
    });

    expect(result.modified).toBe(true);
    expect(result.reason).toBe("created_and_appended");
    expect(existsSync(rcPath)).toBe(true);

    const content = readFileSync(rcPath, "utf-8");
    expect(content).toContain("fish_add_path ~/.local/bin");
  });

  test("handles errors gracefully and returns error reason", () => {
    const invalidRcPath = "/dev/null/impossible/path/.zshrc";
    const result = ensurePathInShellRc({
      customRcPath: invalidRcPath,
    });

    expect(result.modified).toBe(false);
    expect(result.reason).toContain("error:");
  });
});
