import { describe, it, expect } from "bun:test";
import { parseSkillText, parseSkillBytes, extractFields } from "../src/parser.ts";
import { CatalogError } from "../src/types.ts";

describe("parser", () => {
  it("parses valid frontmatter and preserves unknown fields", () => {
    const text = `---
name: browse
description: A browser skill
allowed-tools:
  - Bash
  - Read
weird-unknown: 42
nested:
  foo: bar
---
# Body
content here`;
    const p = parseSkillText(text, "browse/SKILL.md");
    expect(p.hasFrontmatter).toBe(true);
    expect(p.frontmatter["name"]).toBe("browse");
    expect(p.frontmatter["allowed-tools"]).toEqual(["Bash", "Read"]);
    expect(p.frontmatter["weird-unknown"]).toBe(42);
    expect((p.frontmatter["nested"] as { foo: string }).foo).toBe("bar");
    expect(p.body.startsWith("# Body")).toBe(true);
  });

  it("tolerates body-only files (no frontmatter)", () => {
    const p = parseSkillText("just a body\n", "x/SKILL.md");
    expect(p.hasFrontmatter).toBe(false);
    expect(p.frontmatter).toEqual({});
    expect(p.warnings.length).toBeGreaterThan(0);
  });

  it("reports malformed YAML with a file:line diagnostic", () => {
    const text = `---
name: browse
allowed-tools
  - Bash
---
body`;
    try {
      parseSkillText(text, "bad/SKILL.md");
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(CatalogError);
      const msg = (e as Error).message;
      expect(msg).toContain("bad/SKILL.md");
      expect(msg).toMatch(/:\d+:/); // has a line number
      expect(msg).toContain("malformed YAML");
    }
  });

  it("fails on unterminated frontmatter", () => {
    const text = `---
name: browse
description: no close`;
    try {
      parseSkillText(text, "x/SKILL.md");
      expect(true).toBe(false);
    } catch (e) {
      expect((e as Error).message).toContain("never closed");
    }
  });

  it("rejects invalid UTF-8 via strict decode", () => {
    const bad = new Uint8Array([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe, 0x0a]); // ---\n\xff\xfe\n
    expect(() => parseSkillBytes(bad, "x/SKILL.md")).toThrow(/UTF-8/);
  });

  it("handles CRLF and Unicode", () => {
    const text = "---\r\nname: ünïcödé\r\ndescription: é–—\r\n---\r\nbody — dash\r\n";
    const p = parseSkillText(text, "u/SKILL.md");
    expect(p.frontmatter["name"]).toBe("ünïcödé");
    expect(p.frontmatter["description"]).toBe("é–—");
  });

  it("extractFields coerces string and array tool lists", () => {
    expect(extractFields({ "allowed-tools": "Bash" }, "f").allowedTools).toEqual(["Bash"]);
    expect(extractFields({ "allowed-tools": ["Bash", "Read"] }, "f").allowedTools).toEqual(["Bash", "Read"]);
    expect(extractFields({ "preamble-tier": "3" }, "f").preambleTier).toBe(3);
  });
});