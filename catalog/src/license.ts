/**
 * License detection and redistribution policy.
 *
 * Supply-chain rule: we only republish full skill bodies when the upstream
 * license is permissive AND the manifest declares redistribution = "full".
 * Anything ambiguous, copyleft, or missing -> metadata-only (digest + link +
 * immutable revision), and we record the reason. This is fail-safe for
 * licensing: when in doubt, omit the body.
 */
import type { LicenseId, LicenseVerdict } from "./types.ts";

/** SPDX ids that permit full redistribution with notice retention. */
export const PERMISSIVE = new Set<LicenseId>([
  "MIT",
  "Apache-2.0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "Python-2.0",
  "MPL-2.0",
  "Zlib",
  "BlueOak-1.0.0",
]);

/** Normalize a declared/detected id for comparison. */
export function normalizeLicense(id: string): string {
  return id.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Best-effort SPDX detection from a LICENSE file body. Returns "unknown" when
 * no confident match is found (the caller then defaults to metadata-only).
 */
export function detectLicense(text: string): LicenseId {
  const t = text.toLowerCase();
  const has = (...s: string[]) => s.every((x) => t.includes(x));

  if (has("gnu affero general public license")) return "AGPL-3.0";
  if (has("gnu lesser general public license")) return "LGPL-3.0";
  if (has("gnu general public license")) {
    if (t.includes("version 3")) return "GPL-3.0";
    if (t.includes("version 2")) return "GPL-2.0";
    return "GPL-3.0";
  }
  if (has("apache license", "version 2.0")) return "Apache-2.0";
  if (has("mit license") || has("permission is hereby granted, free of charge")) {
    return "MIT";
  }
  if (has("isc license") || (has("isc ") && has("permission to use, copy, modify"))) {
    return "ISC";
  }
  if (has("mozilla public license", "version 2.0")) return "MPL-2.0";
  if (has("python software foundation license")) return "Python-2.0";
  if (has("the unlicense") || has("unlicense.org")) return "Unlicense";
  if (has("creative commons zero") || has("cc0 1.0") || has("public domain dedication")) {
    return "CC0-1.0";
  }
  if (has("bsd 3-clause") || has("neither the name")) return "BSD-3-Clause";
  if (has("bsd 2-clause") || has("redistribution and use in source and binary forms")) {
    return "BSD-2-Clause";
  }
  if (has("zlib license") || has("this software is provided 'as-is'")) return "Zlib";
  return "unknown";
}

/** Compute the effective redistribution verdict for a skill. */
export function verdict(
  declared: LicenseId,
  detected: LicenseId,
  manifestRedistribution: "full" | "metadata-only",
): LicenseVerdict {
  const matchesDeclaration =
    normalizeLicense(declared) === normalizeLicense(detected) ||
    normalizeLicense(declared) === "unknown";
  const detectedPermissive = PERMISSIVE.has(detected);

  let redistribution: "full" | "metadata-only" = manifestRedistribution;
  const notes: string[] = [];

  if (manifestRedistribution === "full" && !detectedPermissive) {
    redistribution = "metadata-only";
    notes.push(
      `manifest permits full redistribution but detected license "${detected}" is not in the permissive set`,
    );
  }
  if (!matchesDeclaration && normalizeLicense(declared) !== "unknown") {
    notes.push(`declared "${declared}" but detected "${detected}" upstream`);
  }

  return {
    redistribution,
    detected,
    declared,
    matchesDeclaration,
    note: notes.length ? notes.join("; ") : undefined,
  };
}
