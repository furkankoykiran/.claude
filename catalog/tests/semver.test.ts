import { describe, it, expect } from "bun:test";
import { parseTag } from "../src/semver.ts";

describe("parseTag", () => {
  it("parses a well-formed release tag", () => {
    expect(parseTag("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseTag("v0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 });
    expect(parseTag("v10.20.30")).toEqual({ major: 10, minor: 20, patch: 30 });
  });

  it("rejects anything that is not exactly vMAJOR.MINOR.PATCH", () => {
    // tag-policy.ts uses this to decide whether a tag on HEAD is one of OURS.
    // Accepting a stray tag would make an unrelated tag read as a release.
    for (const bad of ["1.2.3", "v1.2", "v1.2.3.4", "v1.2.3-rc1", "latest", "", "vX.Y.Z"]) {
      expect(parseTag(bad)).toBeNull();
    }
  });
});
