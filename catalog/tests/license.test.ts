import { describe, it, expect } from "bun:test";
import { detectLicense, verdict, PERMISSIVE } from "../src/license.ts";

describe("license", () => {
  it("detects common permissive licenses", () => {
    expect(detectLicense("MIT License\nCopyright (c)")).toBe("MIT");
    expect(detectLicense("Apache License\nVersion 2.0")).toBe("Apache-2.0");
    expect(detectLicense("ISC License\nPermission to use, copy, modify")).toBe("ISC");
    expect(detectLicense("Permission is hereby granted, free of charge")).toBe("MIT");
    expect(detectLicense("Mozilla Public License\nVersion 2.0")).toBe("MPL-2.0");
  });

  it("detects copyleft", () => {
    expect(detectLicense("GNU General Public License\nVersion 3")).toBe("GPL-3.0");
    expect(detectLicense("GNU AFFERO GENERAL PUBLIC LICENSE")).toBe("AGPL-3.0");
  });

  it("returns unknown for unrecognized text", () => {
    expect(detectLicense("some random text with no license markers")).toBe("unknown");
  });

  it("downgrades full->metadata-only when detected license is non-permissive", () => {
    const v = verdict("MIT", "GPL-3.0", "full");
    expect(v.redistribution).toBe("metadata-only");
    expect(v.matchesDeclaration).toBe(false);
  });

  it("keeps full when permissive and declared matches", () => {
    const v = verdict("MIT", "MIT", "full");
    expect(v.redistribution).toBe("full");
    expect(v.matchesDeclaration).toBe(true);
  });

  it("respects manifest metadata-only regardless of detected", () => {
    expect(verdict("unknown", "MIT", "metadata-only").redistribution).toBe("metadata-only");
  });

  it("permissive set contains the expected SPDX ids", () => {
    expect(PERMISSIVE.has("MIT")).toBe(true);
    expect(PERMISSIVE.has("Apache-2.0")).toBe(true);
    expect(PERMISSIVE.has("GPL-3.0")).toBe(false);
  });
});