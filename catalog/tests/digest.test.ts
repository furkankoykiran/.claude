import { describe, it, expect } from "bun:test";
import { digestText, digestBytes, canonicalize, sha256Bytes, decodeStrictUtf8 } from "../src/digest.ts";

describe("digest", () => {
  it("canonicalizes CRLF and trailing newline", () => {
    expect(canonicalize("a\r\nb\r\n")).toBe("a\nb");
    expect(canonicalize("a\n")).toBe("a");
    expect(canonicalize("a")).toBe("a");
  });

  it("is stable regardless of line endings", () => {
    const lf = digestText("name: x\nbody\n");
    const crlf = digestText("name: x\r\nbody\r\n");
    expect(lf).toBe(crlf);
  });

  it("produces a 64-char hex sha256 over canonicalized content", () => {
    // canonicalization strips the trailing newline, so this is sha256("hello").
    const h = digestText("hello\n");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("digestBytes canonicalizes like digestText", () => {
    // digestBytes canonicalizes (CRLF + trailing newline) before hashing.
    const bytes = new TextEncoder().encode("hello\n");
    expect(digestBytes(bytes)).toBe(digestText("hello\n"));
    expect(digestBytes(new TextEncoder().encode("hello\r\n"))).toBe(digestText("hello\n"));
  });

  it("sha256Bytes is raw (no canonicalization)", () => {
    expect(sha256Bytes(new TextEncoder().encode("hello\n"))).not.toBe(digestText("hello\n"));
  });

  it("strict UTF-8 decode rejects invalid bytes", () => {
    expect(() => decodeStrictUtf8(new Uint8Array([0xff, 0xfe]), "f")).toThrow();
  });
});