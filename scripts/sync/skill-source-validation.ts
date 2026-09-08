import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMarkdownFrontmatter } from "../../olt/scripts/src/authority/manifest/index.ts";

interface DocumentationSkillFrontmatter {
  readonly name?: unknown;
  readonly description?: unknown;
}

export function validateDocumentationSkillSource(sourceDir: string, expectedName: string): void {
  const skillMdPath = join(sourceDir, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    throw new Error(`documentation skill '${expectedName}' is missing SKILL.md at ${skillMdPath}`);
  }

  const raw = readFileSync(skillMdPath, "utf-8");
  const { frontmatter } = parseMarkdownFrontmatter<DocumentationSkillFrontmatter>(raw);

  const name = frontmatter.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error(`documentation skill '${expectedName}' SKILL.md frontmatter is missing a name`);
  }
  if (name.trim() !== expectedName) {
    throw new Error(
      `documentation skill directory '${expectedName}' does not match SKILL.md frontmatter name '${name.trim()}'`,
    );
  }

  const description = frontmatter.description;
  if (typeof description !== "string" || description.trim().length === 0) {
    throw new Error(
      `documentation skill '${expectedName}' SKILL.md frontmatter is missing a description`,
    );
  }
}
