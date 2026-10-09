import { describe, it, expect } from "bun:test";
import { parseTag } from "../src/semver.ts";
import {
  parseVersion,
  formatVersion,
  applyBump,
  compareVersions,
} from "../src/release-notes.ts";

describe("parseTag", () => {
  it("parses a well-formed release tag", () => {
    expect(parseTag("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseTag("v0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 });
    expect(parseTag("v10.20.30")).toEqual({ major: 10, minor: 20, patch: 30 });
    expect(parseTag("v1.0.10")).toEqual({ major: 1, minor: 0, patch: 10 });
  });

  it("rejects anything that is not exactly vMAJOR.MINOR.PATCH", () => {
    // tag-policy.ts uses this to decide whether a tag on HEAD is one of OURS.
    // Accepting a stray tag would make an unrelated tag read as a release.
    for (const bad of ["1.2.3", "v1.2", "v1.2.3.4", "v1.2.3-rc1", "latest", "", "vX.Y.Z"]) {
      expect(parseTag(bad)).toBeNull();
    }
  });
});

describe("SemVer 2.0.0 semantics and bump verification", () => {
  it("parses multi-digit version numbers accurately", () => {
    expect(parseVersion("1.0.9")).toEqual({ major: 1, minor: 0, patch: 9 });
    expect(parseVersion("1.0.10")).toEqual({ major: 1, minor: 0, patch: 10 });
    expect(parseVersion("1.10.0")).toEqual({ major: 1, minor: 10, patch: 0 });
    expect(parseVersion("10.0.0")).toEqual({ major: 10, minor: 0, patch: 0 });
  });

  it("does not roll over patch numbers at 9 (1.0.9 -> 1.0.10 is valid)", () => {
    const v109 = parseVersion("1.0.9")!;
    const bumped = applyBump(v109, "patch");
    expect(bumped).toEqual({ major: 1, minor: 0, patch: 10 });
    expect(formatVersion(bumped)).toBe("1.0.10");

    const v1010 = parseVersion("1.0.10")!;
    const nextPatch = applyBump(v1010, "patch");
    expect(nextPatch).toEqual({ major: 1, minor: 0, patch: 11 });
    expect(formatVersion(nextPatch)).toBe("1.0.11");
  });

  it("compares versions numerically according to SemVer 2.0.0 precedence", () => {
    const v109 = parseVersion("1.0.9")!;
    const v1010 = parseVersion("1.0.10")!;
    const v110 = parseVersion("1.1.0")!;
    const v200 = parseVersion("2.0.0")!;

    expect(compareVersions(v1010, v109)).toBeGreaterThan(0);
    expect(compareVersions(v109, v1010)).toBeLessThan(0);
    expect(compareVersions(v110, v1010)).toBeGreaterThan(0);
    expect(compareVersions(v200, v110)).toBeGreaterThan(0);
  });
});
