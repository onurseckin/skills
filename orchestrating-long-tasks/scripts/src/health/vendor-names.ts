/**
 * Product and vendor names that must never NAME anything: no type, field, enum member, constant,
 * function, variable or file may be called after one. A vendor is a VALUE recorded inside a generic
 * category — `category: "browser-automation", tool: "<whatever ran>"` — because a type named after
 * one product quietly makes that product the schema's favourite and leaves every rival tool
 * describing itself in a shape built for somebody else.
 *
 * Names deliberately left out of this list, each for a stated reason:
 *
 * - `bun` and `git`: the harness IS written in one and DOES execute the other. They are its own
 *   substrate rather than instances of a category it offers, and the identifiers naming them
 *   (`Bun`, `GIT_CONFIG_GLOBAL`) are those products' own required spellings.
 * - `node`, `edge`, `chrome`, `cursor`, `webkit`, `rollup`, `parcel`, `linear`: each is an ordinary
 *   word of this domain first — graph nodes and edges, UI chrome, a text cursor, a vendor-prefixed
 *   DOM property, a rolled-up metric, a parcel of work. Matching them would report noise, and a
 *   check that reports noise is a check nobody keeps.
 */
export const VENDOR_NAMES: readonly string[] = [
  "ansible",
  "anthropic",
  "antigravity",
  "babel",
  "bard",
  "bitbucket",
  "cargo",
  "cassandra",
  "chatgpt",
  "chromium",
  "claude",
  "cloudflare",
  "codex",
  "cohere",
  "copilot",
  "cypress",
  "deepseek",
  "deno",
  "docker",
  "dotnet",
  "elasticsearch",
  "emacs",
  "esbuild",
  "eslint",
  "firefox",
  "gecko",
  "gemini",
  "github",
  "gitlab",
  "gofmt",
  "golang",
  "gpt",
  "gradle",
  "grok",
  "grunt",
  "gulp",
  "haiku",
  "heroku",
  "homebrew",
  "intellij",
  "jasmine",
  "jest",
  "jetbrains",
  "junit",
  "karma",
  "kubernetes",
  "langchain",
  "llama",
  "maven",
  "mercurial",
  "mistral",
  "mocha",
  "mongodb",
  "mysql",
  "neovim",
  "netlify",
  "nightwatch",
  "npm",
  "nuget",
  "ollama",
  "openai",
  "opus",
  "oxfmt",
  "oxlint",
  "perplexity",
  "playwright",
  "pnpm",
  "poetry",
  "postgres",
  "postgresql",
  "prettier",
  "prisma",
  "puppeteer",
  "pylint",
  "pytest",
  "python",
  "qwen",
  "railway",
  "redis",
  "ripgrep",
  "rspec",
  "rubocop",
  "safari",
  "selenium",
  "snowpack",
  "sonnet",
  "sqlite",
  "stylelint",
  "subversion",
  "terraform",
  "testcafe",
  "tslint",
  "turbopack",
  "typescript",
  "vercel",
  "vite",
  "vitest",
  "vscode",
  "webdriver",
  "webpack",
  "windsurf",
  "xcode",
  "yarn",
];

/**
 * Host-specific dispatch identifiers: the literal tool/parameter names one host's own dispatch
 * mechanism exposes, sourced from `references/host-adapters.md`'s adapter table and "Native
 * primitives" section. Unlike `VENDOR_NAMES` these strings are legitimate for a role contract to
 * WRITE - they are the real call a coordinator makes on that host. The defect this guards
 * (`vendor-prose.ts`) is different from `VENDOR_NAMES`'s: not the identifier existing, but it being
 * given as "the shape of the call" with no word anywhere nearby saying which host it belongs to -
 * exactly the shape `agents/coordinator.yaml` and `references/run-playbook.md` regressed to twice.
 *
 * Kept short on the same principle that trims `VENDOR_NAMES`: only identifiers distinctive enough
 * that matching them is signal, not noise. Claude Code's `Agent`/`Task` and Cursor's `Task` are left
 * out because this repository uses "agent" and "task" constantly to mean the generic concept, not
 * that one host's tool - flagging either would bury every real finding under false ones.
 */
export interface HostDispatchTerm {
  readonly host: string;
  readonly terms: readonly string[];
}

export const HOST_DISPATCH_TERMS: readonly HostDispatchTerm[] = [
  { host: "antigravity", terms: ["invoke_subagent", "define_subagent", "ReusedSubagentId"] },
  { host: "codex", terms: ["spawn_agent", "multi_agent_v1", "fork_turns", "fork_context"] },
];

/**
 * Substrings that place a paragraph in one host's territory, for the qualification check in
 * `vendor-prose.ts`. Deliberately narrower than `VENDOR_NAMES`: "claude" and "cursor" are excluded
 * here too, for the same ordinary-word reason `VENDOR_NAMES` excludes "cursor" - and because neither
 * host currently has a tracked dispatch term above, so neither alias would ever be consulted.
 *
 * An array, not a `Record<host, aliases>`: a host name as an object KEY is the same defect this
 * whole file exists to forbid everywhere else, and `vendor-identifiers.ts` proved that by flagging
 * an earlier `Record` version of this constant the moment it was written.
 */
export interface HostNameAlias {
  readonly host: string;
  readonly aliases: readonly string[];
}

export const HOST_NAME_ALIASES: readonly HostNameAlias[] = [
  { host: "antigravity", aliases: ["antigravity"] },
  { host: "codex", aliases: ["codex"] },
];
