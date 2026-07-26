import { describe, it, expect } from "bun:test";
import { parseTag, labelBump, inferBump, nextTag } from "../src/semver.ts";
import { selectReleaseTag } from "../src/tag-policy.ts";
import type { DiffReport } from "../src/diff.ts";
import { CatalogError } from "../src/types.ts";

const diff = (s: Partial<DiffReport["summary"]>): DiffReport => ({
  schemaVersion: 2,
  base: "base",
  summary: {
    added: 0, updated: 0, removed: 0, renamed: 0, licenseRestricted: 0, runtimeOnly: 0,
    securitySensitive: 0, manualReviewRequired: false, massChange: false, reviewReasons: [], ...s,
  } as DiffReport["summary"],
  changes: [],
});

describe("semver", () => {
  it("parses tags", () => {
    expect(parseTag("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseTag("v0.1.0")).toEqual({ major: 0, minor: 1, patch: 0 });
    expect(parseTag("not-a-tag")).toBeNull();
  });

  it("initial release is v0.1.0 when no prior tags", () => {
    expect(nextTag(null, diff({ added: 5 }), [])?.tag).toBe("v0.1.0");
    expect(nextTag("v0.0.1", diff({ added: 5 }), [])?.tag).toBe("v0.1.0"); // unparseable -> initial
  });

  it("label override wins and exactly-one is enforced", () => {
    expect(labelBump(["release:major"])).toBe("major");
    expect(labelBump([])).toBeNull();
    expect(() => labelBump(["release:minor", "release:major"])).toThrow(CatalogError);
  });

  it("inferBump: patch for updates", () => {
    expect(inferBump(diff({ updated: 2 }))).toBe("patch");
  });

  it("inferBump: minor for adds", () => {
    expect(inferBump(diff({ added: 1 }))).toBe("minor");
  });

  it("inferBump: major for removes/renames (below 1.0 collapses to minor)", () => {
    expect(inferBump(diff({ removed: 1 }))).toBe("major");
  });

  it("no change -> no release", () => {
    expect(inferBump(diff({}))).toBe("none");
    expect(nextTag("v1.2.3", diff({}), [])).toBeNull();
  });

  it("patch bump", () => {
    expect(nextTag("v1.2.3", diff({ updated: 1 }), [])?.tag).toBe("v1.2.4");
  });

  it("minor bump", () => {
    expect(nextTag("v1.2.3", diff({ added: 1 }), [])?.tag).toBe("v1.3.0");
  });

  it("major bump above 1.0", () => {
    expect(nextTag("v1.2.3", diff({ removed: 1 }), [])?.tag).toBe("v2.0.0");
  });

  it("major bump below 1.0 collapses to minor", () => {
    const r = nextTag("v0.5.2", diff({ removed: 1 }), []);
    expect(r?.tag).toBe("v0.6.0");
    expect(r?.bump).toBe("minor");
  });

  it("explicit label override above 1.0", () => {
    expect(nextTag("v1.2.3", diff({ updated: 1 }), ["release:major"])?.tag).toBe("v2.0.0");
  });
});
describe("release tag selection on a commit", () => {
  it("returns none when the commit carries no tags", () => {
    expect(selectReleaseTag([])).toEqual({ tag: null });
  });

  it("ignores non-project tags entirely", () => {
    expect(selectReleaseTag(["latest", "nightly", "build-42"])).toEqual({ tag: null });
  });

  it("selects the single project tag", () => {
    expect(selectReleaseTag(["v1.2.3"])).toEqual({ tag: "v1.2.3" });
    expect(selectReleaseTag(["latest", "v0.1.1"])).toEqual({ tag: "v0.1.1" });
  });

  it("is deterministic and duplicate-tolerant", () => {
    expect(selectReleaseTag(["v1.0.0", "v1.0.0", " v1.0.0 "])).toEqual({ tag: "v1.0.0" });
  });

  it("REFUSES conflicting project tags rather than picking one", () => {
    const r = selectReleaseTag(["v1.0.0", "v1.0.1"]);
    expect(r.tag).toBeNull();
    expect(r.error).toContain("conflicting release tags");
    expect(r.error).toContain("v1.0.0");
    expect(r.error).toContain("v1.0.1");
  });

  it("REFUSES a malformed project tag", () => {
    for (const bad of ["v1.2", "v1.2.3.4", "vX.Y.Z", "v1.2.3-rc1"]) {
      const r = selectReleaseTag([bad]);
      expect(r.tag, `${bad} should not be accepted`).toBeNull();
      expect(r.error).toContain("malformed project tag");
    }
  });

  it("a malformed project tag is not rescued by a valid sibling", () => {
    const r = selectReleaseTag(["v1.0.0", "v1.2"]);
    expect(r.tag).toBeNull();
    expect(r.error).toContain("malformed");
  });
});
