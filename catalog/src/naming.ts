/**
 * Canonical Claude Code skill invocation naming.
 *
 * Derived from current official docs (see docs/catalog-architecture.md):
 *   - Personal scope: ~/.claude/skills/<dir>/SKILL.md -> /<name>
 *   - name frontmatter overrides the directory-derived final segment
 *   - Plugin skills are always namespaced: /<plugin>:<skill>
 *   - name must be <=64 chars, lowercase/digits/hyphens only
 *   - .claude/commands/<name>.md merges into the same namespace (legacy)
 *
 * For THIS repository, file-copied upstream packs become personal-scope skills
 * (install.sh copies them into skills/<name>), so their canonical invocation is
 * the bare /<name>. Plugin marketplaces (runtime-only) are recorded with their
 * expected /<marketplace>:<plugin> namespace pattern.
 */
import { CatalogError } from "./types.ts";

export const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Validate a skill name; throw with context if invalid. */
export function validateName(name: string, file: string, line?: number): void {
  if (!NAME_PATTERN.test(name)) {
    throw new CatalogError(
      `invalid skill name "${name}" (must be 1-64 chars, lowercase a-z0-9 and hyphens, no leading hyphen)`,
      file,
      line,
    );
  }
  if (/(?:^|-)anthropic(?:-|$)|(?:^|-)claude(?:-|$)/.test(name)) {
    throw new CatalogError(
      `skill name "${name}" contains a reserved word (anthropic/claude)`,
      file,
      line,
    );
  }
}

/**
 * Compute the final command segment: frontmatter `name` if present and valid,
 * else the directory name. Returns { name, fromFrontmatter }.
 */
export function finalSegment(
  frontmatterName: unknown,
  dirName: string,
  file: string,
  fmLine?: number,
): { name: string; fromFrontmatter: boolean } {
  if (typeof frontmatterName === "string" && frontmatterName.length > 0) {
    validateName(frontmatterName, file, fmLine);
    return { name: frontmatterName, fromFrontmatter: true };
  }
  validateName(dirName, file);
  return { name: dirName, fromFrontmatter: false };
}

/** Canonical invocation for a personal-scope skill. */
export function personalInvocation(name: string): string {
  return `/${name}`;
}

/** Namespaced invocation for a plugin skill. */
export function pluginInvocation(plugin: string, skill: string): string {
  return `/${plugin}:${skill}`;
}

/** Case-collision key: lowercase, for detecting /Foo vs /foo clashes. */
export function caseKey(invocation: string): string {
  return invocation.toLowerCase();
}