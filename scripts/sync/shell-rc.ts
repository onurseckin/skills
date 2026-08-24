import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface EnsureShellRcOptions {
  binDir?: string | undefined;
  homeDir?: string | undefined;
  shell?: string | undefined;
  customRcPath?: string | undefined;
  envPath?: string | undefined;
}

export interface EnsureShellRcResult {
  modified: boolean;
  targetRc: string | null;
  reason: string;
}

/**
 * Detects the appropriate shell RC configuration file for the user's active shell.
 */
export function detectShellRcPath(options?: {
  shell?: string | undefined;
  homeDir?: string | undefined;
}): string {
  const home = options?.homeDir ?? homedir();
  const currentShell = options?.shell ?? process.env.SHELL ?? "";

  if (currentShell.endsWith("fish") || currentShell.includes("fish")) {
    return join(home, ".config", "fish", "config.fish");
  }

  if (currentShell.endsWith("zsh") || currentShell.includes("zsh")) {
    return join(home, ".zshrc");
  }

  if (currentShell.endsWith("bash") || currentShell.includes("bash")) {
    if (process.platform === "darwin") {
      const bashProfile = join(home, ".bash_profile");
      if (existsSync(bashProfile)) {
        return bashProfile;
      }
      return join(home, ".bashrc");
    }
    return join(home, ".bashrc");
  }

  // Fallback: check existing files in precedence order
  const zshrc = join(home, ".zshrc");
  if (existsSync(zshrc)) return zshrc;
  const bashrc = join(home, ".bashrc");
  if (existsSync(bashrc)) return bashrc;
  const bashProfile = join(home, ".bash_profile");
  if (existsSync(bashProfile)) return bashProfile;
  const fishConfig = join(home, ".config", "fish", "config.fish");
  if (existsSync(fishConfig)) return fishConfig;

  // Default to .zshrc on Darwin, .bashrc on Linux
  return process.platform === "darwin" ? zshrc : bashrc;
}

/**
 * Determines whether the target directory or its common shell expressions
 * are already declared inside the given shell RC content.
 */
export function isPathDeclaredInContent(content: string, binDir: string, home: string): boolean {
  if (content.includes(binDir)) {
    return true;
  }
  if (binDir.startsWith(home)) {
    const relToHome = binDir.slice(home.length).replace(/^[/\\]/, "");
    if (content.includes(`$HOME/${relToHome}`) || content.includes(`\${HOME}/${relToHome}`)) {
      return true;
    }
    if (content.includes(`~/${relToHome}`)) {
      return true;
    }
    if (relToHome === ".local/bin" && content.includes(".local/bin")) {
      return true;
    }
  }
  return false;
}

/**
 * Generates the shell export statement block.
 */
export function generateExportLine(targetRc: string, binDir: string, home: string): string {
  const isFish = targetRc.endsWith("config.fish");
  let formattedPath = binDir;
  if (binDir.startsWith(home)) {
    const relToHome = binDir.slice(home.length).replace(/^[/\\]/, "");
    formattedPath = isFish ? `~/${relToHome}` : `"$HOME/${relToHome}:$PATH"`;
  } else {
    formattedPath = isFish ? binDir : `"${binDir}:$PATH"`;
  }

  if (isFish) {
    return `\n# Added by @onurseckin/skills (OLT CLI)\nfish_add_path ${formattedPath}\n`;
  }

  return `\n# Added by @onurseckin/skills (OLT CLI)\nexport PATH=${formattedPath}\n`;
}

/**
 * Checks and idempotently adds ~/.local/bin to the user's active shell RC file.
 * Wrapped in try/catch to ensure zero-blocker courtesy invariant.
 */
export function ensurePathInShellRc(options?: EnsureShellRcOptions): EnsureShellRcResult {
  try {
    const home = options?.homeDir ?? homedir();
    const binDir = options?.binDir ?? join(home, ".local", "bin");
    const targetRc =
      options?.customRcPath ?? detectShellRcPath({ shell: options?.shell, homeDir: home });

    if (existsSync(targetRc)) {
      const content = readFileSync(targetRc, "utf-8");
      if (isPathDeclaredInContent(content, binDir, home)) {
        return {
          modified: false,
          targetRc,
          reason: "already_configured",
        };
      }

      const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
      const exportBlock = `${prefix}${generateExportLine(targetRc, binDir, home)}`;
      writeFileSync(targetRc, content + exportBlock, "utf-8");

      return {
        modified: true,
        targetRc,
        reason: "appended",
      };
    }

    mkdirSync(dirname(targetRc), { recursive: true });
    const exportBlock = generateExportLine(targetRc, binDir, home).trimStart();
    writeFileSync(targetRc, exportBlock, "utf-8");

    return {
      modified: true,
      targetRc,
      reason: "created_and_appended",
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn(`[sync] Note: Could not update shell configuration (${errorMessage}).`);
    return {
      modified: false,
      targetRc: options?.customRcPath ?? null,
      reason: `error: ${errorMessage}`,
    };
  }
}
