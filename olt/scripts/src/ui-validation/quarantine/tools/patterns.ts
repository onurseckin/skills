export const EVALUATE_SCRIPT_HOST_FS_PATTERNS: readonly RegExp[] = [
  /\bfs\.(?:read|write|open|stat|unlink|rm|mkdir|readdir|copy|access)\b/iu,
  /\b(?:readFileSync|writeFileSync|promises\.readFile|promises\.writeFile)\b/iu,
  /\brequire\s*\(\s*['"](?:node:)?(?:fs|child_process|path|os|cluster|net|http|https|worker_threads)['"]\s*\)/iu,
  /\bimport\s*\(\s*['"](?:node:)?(?:fs|child_process|path|os|cluster|net|http|https|worker_threads)['"]\s*\)/iu,
  /\b(?:process\.cwd|process\.env|process\.mainModule|process\.binding)\b/iu,
  /\b(?:Bun\.file|Bun\.write|Bun\.spawn|Bun\.spawnSync)\b/iu,
  /\b(?:Deno\.readTextFile|Deno\.readFile|Deno\.run|Deno\.Command)\b/iu,
  /\b(?:child_process|spawn|exec|execSync|spawnSync|fork)\s*\(/iu,
  /\b(?:fetch|XMLHttpRequest)\s*\(\s*['"]file:\/\//iu,
  /\blocalStorage\.(?:getItem|setItem)\s*\(\s*['"](?:auth_secret|api_key|private_key|olt_token)['"]\s*\)/iu,
];

export const SHELL_INJECTION_PATTERNS: readonly RegExp[] = [
  /[;&|`$]\s*(?:rm|cat|bash|sh|zsh|curl|wget|nc|netcat|ncat|python|perl|ruby|node|bun)\b/iu,
  /\$\([^)]+\)/u,
  /`[^`]+`/u,
  /\b(?:sudo|chmod|chown|mkfifo|eval)\b/iu,
  /\b(?:powershell|cmd\.exe)\b/iu,
];

export const LOCAL_URL_BYPASS_PATTERNS: readonly RegExp[] = [
  /^file:\/\//iu,
  /^data:text\/(?:html|javascript);base64,[a-zA-Z0-9+/=]+/iu,
  /^javascript:/iu,
  /^vbscript:/iu,
  /^blob:/iu,
];

/**
 * Hardened Tool Quarantine Engine
 */
