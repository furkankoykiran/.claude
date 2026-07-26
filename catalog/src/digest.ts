/**
 * SHA-256 content digests over a documented canonical form.
 *
 * Canonicalization algorithm (documented in docs/catalog-architecture.md):
 *   1. Decode bytes as strict UTF-8 (reject invalid sequences).
 *   2. Normalize line endings to LF.
 *   3. Strip a trailing single newline if present.
 *   4. digest = sha256(canonical UTF-8 bytes), lowercase hex.
 *
 * The digest is computed over the ORIGINAL normalized source content (the raw
 * file bytes), not over generated output, so it is independent of how a page is
 * rendered and stable across regeneration.
 */
import { createHash } from "node:crypto";

/** Strict UTF-8 decode: throws on invalid byte sequences. */
export function decodeStrictUtf8(bytes: Uint8Array, file: string): string {
  // TextDecoder with fatal:true rejects invalid UTF-8.
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    return decoder.decode(bytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${file}: invalid UTF-8 (${msg})`);
  }
}

/** Normalize to LF and strip one trailing newline. */
export function canonicalize(text: string): string {
  const lf = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return lf.endsWith("\n") ? lf.slice(0, -1) : lf;
}

/** SHA-256 over raw bytes (used for license/notice files verbatim). */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** SHA-256 over canonicalized text. */
export function digestText(rawText: string): string {
  return sha256Bytes(new TextEncoder().encode(canonicalize(rawText)));
}

/** SHA-256 over a file's raw bytes, canonicalized. */
export function digestBytes(bytes: Uint8Array): string {
  const text = decodeStrictUtf8(bytes, "<bytes>");
  return digestText(text);
}