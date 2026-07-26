import { describe, it, expect } from "bun:test";
import { parseManifest } from "../src/manifest.ts";

describe("manifest", () => {
  it("parses a git source with named selection", () => {
    const m = parseManifest(`
schema_version = 1
[sources.x]
type = "git"
display_name = "X"
repo = "https://github.com/o/r.git"
ref = "origin/HEAD"
pack = "p"
license = "MIT"
redistribution = "full"
install_step = "install_x"
selection.kind = "named"
selection.root = "skills"
selection.names = ["a", "b"]
`);
    const s = m.sources["x"]!;
    expect(s.type).toBe("git");
    if (s.type === "git") {
      expect(s.selection.kind).toBe("named");
      expect((s.selection as { names: string[] }).names).toEqual(["a", "b"]);
    }
  });

  it("parses runtime + repo-owned sources", () => {
    const m = parseManifest(`
[sources.rt]
type = "runtime"
display_name = "RT"
runtime_kind = "pypi-package"
pypi_package = "foo"
reason = "because"
[sources.repo]
type = "repo-owned"
display_name = "Repo"
root = "skills"
`);
    expect(m.sources["rt"]!.type).toBe("runtime");
    expect(m.sources["repo"]!.type).toBe("repo-owned");
  });

  it("rejects unknown selection kind", () => {
    expect(() =>
      parseManifest(`[sources.x]
type = "git"
display_name = "X"
repo = "u"
ref = "r"
pack = "p"
license = "MIT"
redistribution = "full"
install_step = "i"
selection.kind = "bogus"`),
    ).toThrow(/unknown selection\.kind/);
  });

  it("rejects missing required fields", () => {
    expect(() =>
      parseManifest(`[sources.x]
type = "git"
display_name = "X"`),
    ).toThrow(/missing required field/);
  });

  it("rejects unknown source type", () => {
    expect(() =>
      parseManifest(`[sources.x]
type = "bogus"`),
    ).toThrow(/unknown type/);
  });
});