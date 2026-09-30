import { describe, it, expect } from "bun:test";
import { resolveRef } from "../src/git.ts";

describe("git helpers", () => {
  it("accepts immutable SHA refs without network resolution", async () => {
    const sha = "A19A171FA980A0785849596492E0AF4DB800C82F";
    expect(await resolveRef("https://example.invalid/repo.git", sha)).toBe(sha.toLowerCase());
  });
});
