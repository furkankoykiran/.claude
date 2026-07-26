/**
 * SKILL.md parser.
 *
 * - Strict UTF-8 decode (rejects invalid bytes).
 * - Explicit frontmatter boundary detection (no regex guessing).
 * - YAML parse via `yaml` with a LineCounter, so errors carry file:line.
 * - Preserves all frontmatter fields (known + unknown) verbatim via toJSON().
 * - Tolerates missing optional fields and body-only files.
 *
 * Never executes anything: `!cmd` dynamic context is detected as data, not run.
 */
import { parseDocument, LineCounter } from "yaml";
import { CatalogError } from "./types.ts";
import { decodeStrictUtf8, canonicalize } from "./digest.ts";

export interface ParsedSkill {
  hasFrontmatter: boolean;
  rawFrontmatter: string;
  body: string;
  frontmatter: Record<string, unknown>;
  warnings: string[];
}

const FM_DELIM = /^(-{3}|\.{3})$/;

/** Coerce a frontmatter value to a string array (string | string[] | undefined). */
function coerceStringArray(v: unknown, file: string, line?: number): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) {
    return v.map((x, i) => {
      if (typeof x !== "string") {
        throw new CatalogError(`array element #${i} is not a string`, file, line);
      }
      return x;
    });
  }
  throw new CatalogError("expected a string or string array", file, line);
}

export interface ExtractedFields {
  name?: string;
  nameLine?: number;
  description?: string;
  whenToUse?: string;
  version?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  argumentHint?: string;
  model?: string;
  preambleTier?: number;
}

/** Extract the well-known typed fields from parsed frontmatter (with line info). */
export function extractFields(
  fm: Record<string, unknown>,
  file: string,
): ExtractedFields {
  const out: ExtractedFields = {};
  if (typeof fm["name"] === "string") out.name = fm["name"];
  if (typeof fm["description"] === "string") out.description = fm["description"];
  if (typeof fm["when_to_use"] === "string") out.whenToUse = fm["when_to_use"];
  if (typeof fm["version"] === "string") out.version = fm["version"];
  if (typeof fm["argument-hint"] === "string") out.argumentHint = fm["argument-hint"];
  if (typeof fm["model"] === "string") out.model = fm["model"];
  out.allowedTools = coerceStringArray(fm["allowed-tools"], file);
  out.disallowedTools = coerceStringArray(fm["disallowed-tools"], file);
  const pt = fm["preamble-tier"] ?? fm["preambleTier"];
  if (typeof pt === "number") out.preambleTier = pt;
  else if (typeof pt === "string" && /^\d+$/.test(pt.trim())) {
    out.preambleTier = Number(pt.trim());
  }
  return out;
}

/**
 * Parse raw bytes of a SKILL.md. `file` is used for diagnostics only.
 * Content is canonicalized to LF before parsing; the digest is computed by the
 * caller over the same canonical bytes.
 */
export function parseSkillBytes(bytes: Uint8Array, file: string): ParsedSkill {
  const text = canonicalize(decodeStrictUtf8(bytes, file));
  return parseSkillText(text, file);
}

/** Parse text; CRLF/CR are normalized to LF first (defensive — callers may pass
 * raw file text). The digest is computed independently over the same canonical
 * bytes, so this stays consistent. */
export function parseSkillText(text: string, file: string): ParsedSkill {
  const warnings: string[] = [];
  const norm = canonicalize(text);
  const lines = norm.split("\n");

  let hasFrontmatter = false;
  let rawFrontmatter = "";
  let body = text;
  let fmOffsetLines = 0; // file line where fm content begins (0-based)

  if (lines.length > 0 && FM_DELIM.test(lines[0]!.trim())) {
    // Find the closing delimiter.
    let closeIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (FM_DELIM.test(lines[i]!.trim())) {
        closeIdx = i;
        break;
      }
    }
    if (closeIdx === -1) {
      throw new CatalogError(
        "frontmatter opened with --- but never closed (missing closing --- or ...)",
        file,
        1,
      );
    }
    hasFrontmatter = true;
    rawFrontmatter = lines.slice(1, closeIdx).join("\n");
    body = lines.slice(closeIdx + 1).join("\n");
    fmOffsetLines = 1; // content starts at file line 2 (0-based line index 1)
  }

  if (!hasFrontmatter) {
    warnings.push("no YAML frontmatter; name defaults to directory name");
    return {
      hasFrontmatter: false,
      rawFrontmatter: "",
      body,
      frontmatter: {},
      warnings,
    };
  }

  const lineCounter = new LineCounter();
  const doc = parseDocument(rawFrontmatter, { lineCounter });
  if (doc.errors.length > 0) {
    const err = doc.errors[0]!;
    let line: number | undefined;
    const pos = (err as { pos?: number[] }).pos;
    if (pos && typeof pos[0] === "number") {
      const lp = lineCounter.linePos(pos[0]);
      line = (lp.line ?? 1) + fmOffsetLines;
    }
    throw new CatalogError(
      `malformed YAML frontmatter: ${err.message}`,
      file,
      line,
    );
  }

  const value = doc.toJS({ maxAliasCount: -1 }) as Record<string, unknown>;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogError(
      "frontmatter must be a YAML mapping (key: value), not a scalar or list",
      file,
      2,
    );
  }

  return {
    hasFrontmatter: true,
    rawFrontmatter,
    body,
    frontmatter: value,
    warnings,
  };
}