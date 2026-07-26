/**
 * Core type definitions for the Skills Catalog resolver and generator.
 *
 * Everything in the catalog is a pure function of committed inputs
 * (skills-sources.toml + skills-source.lock.json + catalog/cache/), so two
 * consecutive `catalog:generate` runs produce byte-identical output. See
 * docs/catalog-architecture.md for the full model.
 */

/** SPDX-ish license identifier, or "unknown" / "proprietary". */
export type LicenseId = string;

/** Source type discriminator. */
export type SourceType = "git" | "runtime" | "repo-owned";

/**
 * How a git source selects which skill directories to copy out of the clone,
 * mirroring install.sh's selection rules exactly.
 */
export type GitSelection =
  | { kind: "all-skills"; root: string; requireSkillMd?: boolean }
  | { kind: "named"; root: string; names: string[] }
  | { kind: "whole-repo"; dest: string }
  | { kind: "subpath"; path: string; dest: string };

/** A git-cloned upstream skill source (the common case). */
export interface GitSourceConfig {
  type: "git";
  id: string;
  displayName: string;
  repo: string;
  /** Moving ref the updater advances (e.g. "origin/HEAD" or "main"). */
  ref: string;
  selection: GitSelection;
  destinationPrefix: string;
  pack: string;
  /** Declared license; the resolver verifies it against the upstream LICENSE. */
  license: LicenseId;
  /** Whether full bodies may be republished. The resolver may downgrade this. */
  redistribution: "full" | "metadata-only";
  licenseNoticeFiles: string[];
  /** install.sh function name that installs this source (for parity tests). */
  installStep: string;
  notes?: string;
}

type RuntimeKind = "plugin-marketplace" | "pypi-package" | "installer-script";

/** A component that cannot be deterministically resolved from files. */
export interface RuntimeSourceConfig {
  type: "runtime";
  id: string;
  displayName: string;
  runtimeKind: RuntimeKind;
  /** Why this source is non-deterministic / runtime-only. */
  reason: string;
  marketplaces?: string[];
  plugins?: string[];
  pypiPackage?: string;
  installerUrl?: string;
}

/** Skills owned by this repository (committed under skills/). */
export interface RepoOwnedSourceConfig {
  type: "repo-owned";
  id: string;
  displayName: string;
  root: string;
}

export type SourceConfig =
  | GitSourceConfig
  | RuntimeSourceConfig
  | RepoOwnedSourceConfig;

/** The parsed skills-sources.toml manifest. */
export interface Manifest {
  sources: Record<string, SourceConfig>;
  /** Manifest schema version. */
  schemaVersion: number;
}

/** Result of inspecting a skill's license for redistribution. */
export interface LicenseVerdict {
  /** Effective redistribution level actually applied. */
  redistribution: "full" | "metadata-only";
  /** SPDX id detected upstream, or "unknown". */
  detected: LicenseId;
  /** SPDX id declared in the manifest, or "unknown". */
  declared: LicenseId;
  /** Whether detected == declared (a mismatch is a non-fatal warning). */
  matchesDeclaration: boolean;
  /** Human-readable reason when full content is omitted. */
  note?: string;
}

/** Security-relevant metadata extracted from a parsed skill. */
export interface SecurityProfile {
  hasBashOrPowershell: boolean;
  hasDynamicShell: boolean; // `!cmd` or ```! context
  hasHooks: boolean;
  hasMcpOrLsp: boolean;
  hasAgents: boolean;
  hasCredentialRef: boolean;
  hasHiddenFiles: boolean;
  hasExecutable: boolean;
  hasNetworkRef: boolean;
  toolCount: number;
  /** Free-form flags surfaced for the change report. */
  flags: string[];
}

/** A fully resolved skill entry. */
export interface ResolvedSkill {
  canonicalInvocation: string;
  skillName: string;
  namespacedInvocations: string[];
  sourceId: string;
  sourceType: SourceType;
  pack: string;
  repo?: string;
  ref?: string;
  resolvedRevision?: string;
  relativePath: string;
  frontmatter: Record<string, unknown>;
  rawFrontmatter: string;
  body: string;
  description?: string;
  whenToUse?: string;
  version?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  preambleTier?: number;
  digest: string;
  license: LicenseVerdict;
  security: SecurityProfile;
  generated: boolean;
  warnings: string[];
  /** Present for runtime-only sources that have no resolvable content. */
  unresolvedReason?: string;
}

/** One locked source in skills-source.lock.json. */
export interface LockedSource {
  id: string;
  type: SourceType;
  repo?: string;
  configuredRef?: string;
  resolvedRevision?: string;
  selectedPaths: string[];
  canonicalSkills: string[];
  license: { declared: LicenseId; detected: LicenseId };
  redistribution: "full" | "metadata-only";
  notes?: string;
}

/** Per-skill lock entry (digests + metadata for reproducibility). */
export interface LockedSkill {
  canonicalInvocation: string;
  sourceId: string;
  relativePath: string;
  digest: string;
  resolvedRevision?: string;
  redistribution: "full" | "metadata-only";
  license: { declared: LicenseId; detected: LicenseId };
}

/** The committed lock snapshot. */
export interface Lockfile {
  schemaVersion: number;
  resolverVersion: string;
  /** EXCLUDED from determinism comparisons; informational only. */
  resolvedAt?: string;
  sources: LockedSource[];
  skills: LockedSkill[];
}

/** Stable, schema-versioned machine-readable catalog. */
export interface Catalog {
  schemaVersion: number;
  resolverVersion: string;
  generated: boolean;
  totals: {
    sources: number;
    skills: number;
    redistributable: number;
    runtimeOnly: number;
    warnings: number;
  };
  sources: Array<{
    id: string;
    type: SourceType;
    displayName: string;
    pack: string;
    repo?: string;
    ref?: string;
    resolvedRevision?: string;
    skillCount: number;
    redistribution: "full" | "metadata-only";
    runtimeOnly: boolean;
  }>;
  skills: Array<CatalogSkillEntry>;
}

/** A skill entry as serialized into skills-catalog.json. */
export interface CatalogSkillEntry {
  canonicalInvocation: string;
  namespacedInvocations: string[];
  skillName: string;
  sourceId: string;
  pack: string;
  sourceType: SourceType;
  repo?: string;
  ref?: string;
  resolvedRevision?: string;
  relativePath: string;
  description?: string;
  whenToUse?: string;
  version?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  preambleTier?: number;
  digest: string;
  license: LicenseVerdict;
  security: SecurityProfile;
  redistribution: "full" | "metadata-only";
  generated: boolean;
  unresolvedReason?: string;
  warnings: string[];
  frontmatter: Record<string, unknown>;
  fullPagePath?: string;
}

/** Error that carries a file + 1-based line for actionable diagnostics. */
export class CatalogError extends Error {
  file: string;
  line?: number;
  constructor(message: string, file: string, line?: number) {
    super(line ? `${file}:${line}: ${message}` : `${file}: ${message}`);
    this.name = "CatalogError";
    this.file = file;
    this.line = line;
  }
}