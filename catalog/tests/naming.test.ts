import { describe, it, expect } from "bun:test";
import {
  validateName,
  finalSegment,
  personalInvocation,
  pluginInvocation,
  caseKey,
} from "../src/naming.ts";
import { CatalogError } from "../src/types.ts";

describe("naming", () => {
  it("accepts valid names", () => {
    expect(() => validateName("browse", "f")).not.toThrow();
    expect(() => validateName("a1-b2", "f")).not.toThrow();
  });

  it("rejects invalid names", () => {
    expect(() => validateName("Bad_Name", "f")).toThrow(CatalogError);
    expect(() => validateName("-leading", "f")).toThrow(CatalogError);
    expect(() => validateName("has space", "f")).toThrow(CatalogError);
    expect(() => validateName("a".repeat(65), "f")).toThrow(CatalogError);
  });

  it("rejects reserved words anthropic/claude", () => {
    expect(() => validateName("claude-api", "f")).toThrow(CatalogError);
    expect(() => validateName("anthropic-thing", "f")).toThrow(CatalogError);
  });

  it("frontmatter name overrides directory name", () => {
    const a = finalSegment("renamed", "dirname", "f");
    expect(a).toEqual({ name: "renamed", fromFrontmatter: true });
    const b = finalSegment(undefined, "dirname", "f");
    expect(b).toEqual({ name: "dirname", fromFrontmatter: false });
  });

  it("builds personal and plugin invocations", () => {
    expect(personalInvocation("browse")).toBe("/browse");
    expect(pluginInvocation("marketing-skills", "cro")).toBe("/marketing-skills:cro");
  });

  it("case-collides Foo vs foo", () => {
    expect(caseKey("/Foo")).toBe(caseKey("/foo"));
  });
});