import { describe, it, expect } from "bun:test";
import {
  parseCommit,
  categorize,
  groupCommits,
  migrationsIn,
  requiredBump,
  applyBump,
  parseVersion,
  formatVersion,
  checkVersion,
  renderNotes,
  type Commit,
} from "../src/release-notes.ts";
import type { DiffReport } from "../src/diff.ts";
import { CatalogError } from "../src/types.ts";

function commit(subject: string, body = "", files: string[] = []): Commit {
  return { sha: "a".repeat(40), shortSha: "aaaaaaa", subject, body, files };
}

function diff(summary: Partial<DiffReport["summary"]>): DiffReport {
  return {
    summary: {
      added: 0,
      updated: 0,
      removed: 0,
      renamed: 0,
      manualReviewRequired: false,
      ...summary,
    },
  } as DiffReport;
}

describe("conventional commit parsing", () => {
  it("splits type, scope and description", () => {
    const c = parseCommit(commit("feat(install): add a thing"));
    expect(c.type).toBe("feat");
    expect(c.scope).toBe("install");
    expect(c.description).toBe("add a thing");
    expect(c.breaking).toBe(false);
  });

  it("treats a bare subject as untyped rather than guessing", () => {
    const c = parseCommit(commit("Rework the docs"));
    expect(c.type).toBeNull();
    expect(c.description).toBe("Rework the docs");
  });

  it("reads the ! marker as breaking", () => {
    expect(parseCommit(commit("feat(api)!: drop v1")).breaking).toBe(true);
    expect(parseCommit(commit("feat!: drop v1")).breaking).toBe(true);
  });

  it("reads every accepted BREAKING footer spelling", () => {
    for (const footer of ["BREAKING CHANGE: x", "BREAKING-CHANGE: x", "BREAKING: x"]) {
      expect(parseCommit(commit("fix: y", footer)).breaking).toBe(true);
    }
  });

  it("does not treat the word breaking in prose as a footer", () => {
    expect(parseCommit(commit("fix: y", "This avoids breaking the build.")).breaking).toBe(false);
  });
});

describe("categorisation", () => {
  const cat = (s: string, b = "", f: string[] = []) => categorize(parseCommit(commit(s, b, f)));

  it("puts breaking ahead of everything else", () => {
    // A breaking fix is a breaking change first; burying it under Fixes is how
    // upgrade surprises happen.
    expect(cat("fix(api)!: change the return shape")).toBe("breaking");
    expect(cat("security: patch it", "BREAKING CHANGE: config moved")).toBe("breaking");
  });

  it("routes security by type or scope", () => {
    expect(cat("security: fix path traversal")).toBe("security");
    expect(cat("fix(security): tighten the check")).toBe("security");
  });

  it("routes dependency and upstream-source work together", () => {
    expect(cat("chore(deps): bump yaml")).toBe("sources");
    expect(cat("chore(skills): update upstream catalog")).toBe("sources");
    expect(cat("build: rework the bundle")).toBe("sources");
  });

  it("keeps features and fixes apart", () => {
    expect(cat("feat: add x")).toBe("features");
    expect(cat("fix: repair x")).toBe("fixes");
  });

  it("does not let a migration file hijack the commit's real category", () => {
    // Migrations are reported separately, as a property of the release.
    expect(cat("feat(update): add a thing", "", ["migrations/0002-x.sh"])).toBe("features");
  });

  it("falls back to other for anything untyped", () => {
    expect(cat("Rework the docs")).toBe("other");
    expect(cat("docs: tidy up")).toBe("other");
  });
});

describe("migrationsIn", () => {
  it("collects numbered migration scripts and de-duplicates them", () => {
    const cs = [
      commit("feat: a", "", ["migrations/0001-one.sh", "README.md"]),
      commit("fix: b", "", ["migrations/0001-one.sh", "migrations/0002-two.sh"]),
    ];
    expect(migrationsIn(cs)).toEqual(["migrations/0001-one.sh", "migrations/0002-two.sh"]);
  });

  it("ignores files that merely live near migrations", () => {
    expect(migrationsIn([commit("x", "", ["migrations/README.md", "migrations/helper.sh"])])).toEqual([]);
  });
});

describe("requiredBump", () => {
  const g = (subjects: string[]) => groupCommits(subjects.map((s) => commit(s)));

  it("is none for an empty range", () => {
    expect(requiredBump(g([]), null)).toBe("none");
  });

  it("is patch for fixes alone", () => {
    expect(requiredBump(g(["fix: a"]), null)).toBe("patch");
  });

  it("is minor for a feature", () => {
    expect(requiredBump(g(["fix: a", "feat: b"]), null)).toBe("minor");
  });

  it("is major for a breaking change", () => {
    expect(requiredBump(g(["feat!: b"]), null)).toBe("major");
  });

  it("treats a removed or renamed skill as breaking even with no breaking commit", () => {
    // The commit subject cannot be trusted to notice that an invocation the user
    // depends on disappeared; the catalog diff can.
    expect(requiredBump(g(["chore: tidy"]), diff({ removed: 1 }))).toBe("major");
    expect(requiredBump(g(["chore: tidy"]), diff({ renamed: 1 }))).toBe("major");
  });

  it("treats an added skill as a feature", () => {
    expect(requiredBump(g(["chore: tidy"]), diff({ added: 1 }))).toBe("minor");
  });

  it("is patch when only skill bodies moved", () => {
    expect(requiredBump(g([]), diff({ updated: 3 }))).toBe("patch");
  });
});

describe("applyBump", () => {
  it("keeps a pre-1.0 break in the minor position", () => {
    expect(formatVersion(applyBump(parseVersion("0.4.2")!, "major"))).toBe("0.5.0");
  });

  it("moves major once past 1.0", () => {
    expect(formatVersion(applyBump(parseVersion("1.4.2")!, "major"))).toBe("2.0.0");
  });

  it("resets patch on a minor bump", () => {
    expect(formatVersion(applyBump(parseVersion("1.4.2")!, "minor"))).toBe("1.5.0");
  });

  it("leaves the version alone for none", () => {
    expect(formatVersion(applyBump(parseVersion("1.4.2")!, "none"))).toBe("1.4.2");
  });
});

describe("checkVersion", () => {
  const g = (subjects: string[]) => groupCommits(subjects.map((s) => commit(s)));

  it("rejects a VERSION that understates what changed", () => {
    const v = checkVersion("0.2.1", "v0.2.0", g(["feat: big"]), null);
    expect(v.ok).toBe(false);
    expect(v.minimum).toBe("0.3.0");
    expect(v.reason).toMatch(/needs a minor bump/);
  });

  it("accepts a VERSION that meets the minimum exactly", () => {
    expect(checkVersion("0.3.0", "v0.2.0", g(["feat: big"]), null).ok).toBe(true);
  });

  it("accepts a VERSION beyond the minimum", () => {
    expect(checkVersion("1.0.0", "v0.2.0", g(["fix: small"]), null).ok).toBe(true);
  });

  it("accepts anything as a first release", () => {
    const v = checkVersion("0.1.0", null, g(["feat: first"]), null);
    expect(v.ok).toBe(true);
    expect(v.previous).toBeNull();
  });

  it("requires no bump when nothing landed", () => {
    const v = checkVersion("0.2.0", "v0.2.0", g([]), null);
    expect(v.ok).toBe(true);
    expect(v.bump).toBe("none");
  });

  it("refuses a VERSION that is not semver", () => {
    expect(() => checkVersion("1.2", "v1.1.0", g([]), null)).toThrow(CatalogError);
  });

  it("requires a major-equivalent bump when a skill was removed", () => {
    const v = checkVersion("0.2.1", "v0.2.0", g(["chore: tidy"]), diff({ removed: 1 }));
    expect(v.ok).toBe(false);
    expect(v.minimum).toBe("0.3.0"); // pre-1.0: a break moves the minor
  });
});

describe("renderNotes", () => {
  const groups = groupCommits([
    commit("feat(a): new thing"),
    commit("fix(b): repaired thing"),
    commit("feat(c)!: removed thing"),
  ]);

  it("orders breaking changes first", () => {
    const out = renderNotes(groups, { version: "1.0.0", previousTag: "v0.9.0", commitSha: "abc123def456" });
    expect(out.indexOf("Breaking changes")).toBeLessThan(out.indexOf("Features"));
    expect(out.indexOf("Features")).toBeLessThan(out.indexOf("Fixes"));
  });

  it("links a comparison when the repo URL is known", () => {
    const out = renderNotes(groups, {
      version: "1.0.0",
      previousTag: "v0.9.0",
      commitSha: "abc123def456",
      repoUrl: "https://example.invalid/r",
    });
    expect(out).toContain("https://example.invalid/r/compare/v0.9.0...v1.0.0");
  });

  it("says so plainly for a first release", () => {
    expect(renderNotes(groups, { version: "0.1.0", previousTag: null, commitSha: "abc" })).toContain(
      "First release.",
    );
  });

  it("tells the user which migrations will run", () => {
    const out = renderNotes(groups, {
      version: "1.0.0",
      previousTag: "v0.9.0",
      commitSha: "abc",
      migrations: ["migrations/0001-plugin-layout.sh"],
    });
    expect(out).toContain("### Migrations");
    expect(out).toContain("`0001-plugin-layout`");
  });

  it("omits the migration section when there are none", () => {
    const out = renderNotes(groups, { version: "1.0.0", previousTag: "v0.9.0", commitSha: "abc", migrations: [] });
    expect(out).not.toContain("### Migrations");
  });

  it("reports the catalog diff and the manual-review flag", () => {
    const out = renderNotes(groups, {
      version: "1.0.0",
      previousTag: "v0.9.0",
      commitSha: "abc",
      diff: diff({ added: 2, removed: 1, manualReviewRequired: true }),
    });
    expect(out).toContain("added: 2");
    expect(out).toContain("manual capability review");
  });

  it("handles an empty range without pretending otherwise", () => {
    expect(renderNotes([], { version: "1.0.0", previousTag: "v0.9.0", commitSha: "abc" })).toContain(
      "_No commits in range._",
    );
  });
});