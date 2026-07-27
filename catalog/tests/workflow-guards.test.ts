/**
 * Executable proof of the update workflow's safety contract.
 *
 * The guards that keep this automation safe live in `if:` expressions, and a
 * typo in one silently re-enables a mutation. These tests parse the real
 * workflow file, evaluate every step's condition under each operating
 * scenario, and assert exactly which steps run.
 *
 * If a mutating step is added without a guard, the "no mutation" scenarios
 * fail — that is the point.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const WORKFLOW = join(import.meta.dir, "..", "..", ".github", "workflows", "skills-catalog-update.yml");

type Ctx = Record<string, unknown>;

/** Resolve a dotted path like `steps.app-token.outputs.token` against the context. */
function lookup(ctx: Ctx, path: string): unknown {
  let cur: unknown = ctx;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function atom(tok: string, ctx: Ctx): unknown {
  const t = tok.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "always()") return true;
  if (/^'.*'$/.test(t)) return t.slice(1, -1);
  if (/^[A-Za-z_][\w.-]*$/.test(t)) {
    const v = lookup(ctx, t);
    // GitHub returns '' for outputs of skipped steps and null for absent inputs.
    return v === undefined ? (t.startsWith("steps.") ? "" : null) : v;
  }
  throw new Error(`unsupported token in workflow condition: ${JSON.stringify(t)}`);
}

/** Minimal evaluator for the expression subset these workflows use. */
export function evalCondition(expr: string, ctx: Ctx): boolean {
  const src = expr.replace(/^\$\{\{/, "").replace(/\}\}$/, "").trim();
  return src.split("||").some((orTerm) =>
    orTerm.split("&&").every((andTerm) => {
      const t = andTerm.trim();
      const m = /^(.+?)\s*(==|!=)\s*(.+)$/.exec(t);
      if (!m) return Boolean(atom(t, ctx));
      const left = atom(m[1]!, ctx);
      const right = atom(m[3]!, ctx);
      // GitHub compares loosely; null and '' are both falsy-equal to ''.
      const norm = (v: unknown) => (v === null || v === undefined ? "" : v);
      const eq = norm(left) === norm(right);
      return m[2] === "==" ? eq : !eq;
    }),
  );
}

interface Step { name?: string; if?: string; uses?: string; id?: string }

const wf = parse(readFileSync(WORKFLOW, "utf8")) as {
  jobs: Record<string, { steps: Step[] }>;
};
const STEPS: Step[] = wf.jobs.update!.steps;
const nameOf = (s: Step) => s.name ?? s.uses ?? "<unnamed>";

/** Steps that write to GitHub in any way. Everything here must be guarded. */
const MUTATING = [
  "Automation token (GitHub App)",
  "Preflight App token permissions",
  "Commit + push the automation branch",
  "Open or update the automation PR",
  "Reset PR merge state (fail-closed)",
  "Flag PR for manual review",
  "Enable protected squash auto-merge (routine change)",
];

function runsUnder(ctx: Ctx): string[] {
  return STEPS.filter((s) => (s.if === undefined ? true : evalCondition(String(s.if), ctx))).map(nameOf);
}

const scenario = (o: {
  changed: string;
  dryRun?: boolean | null;
  enabled?: string;
  token?: string;
  manual?: string;
  /** '' models the reset step failing or being skipped. */
  verifiedSha?: string;
}): Ctx => ({
  steps: {
    detect: { outputs: { changed: o.changed } },
    classify: { outputs: { manual_review: o.manual ?? "" } },
    "app-token": { outputs: { token: o.token ?? "" } },
    pr: { outputs: { number: "1" } },
    push: { outputs: { sha: "cafe1234" } },
    reset: { outputs: { verified_sha: o.verifiedSha ?? (o.token ? "cafe1234" : "") } },
  },
  inputs: { dry_run: o.dryRun ?? null },
  vars: { ENABLE_SKILLS_AUTOMATION: o.enabled ?? "" },
});

describe("update workflow: every mutating step is guarded", () => {
  it("declares an `if:` on every mutating step", () => {
    for (const name of MUTATING) {
      const step = STEPS.find((s) => nameOf(s) === name);
      expect(step, `step "${name}" not found — did it get renamed?`).toBeDefined();
      expect(step!.if, `step "${name}" has no if: guard`).toBeDefined();
    }
  });

  it("MUTATING covers every step that writes (no unguarded newcomer)", () => {
    // Any step whose body pushes, opens a PR, labels, merges, or mints a token
    // must be listed above. Catches a new mutation added without a guard.
    const body = readFileSync(WORKFLOW, "utf8");
    const writeMarkers = [/git push/, /gh pr create/, /gh pr merge/, /gh pr edit/, /create-github-app-token/, /gh label create/];
    for (const step of STEPS) {
      const name = nameOf(step);
      const idx = body.indexOf(name);
      if (idx < 0) continue;
      const nextIdx = STEPS.map(nameOf).filter((n) => body.indexOf(n) > idx).map((n) => body.indexOf(n)).sort((a, b) => a - b)[0] ?? body.length;
      const chunk = body.slice(idx, nextIdx);
      if (writeMarkers.some((re) => re.test(chunk))) {
        expect(MUTATING, `step "${name}" performs a write but is not in MUTATING`).toContain(name);
      }
    }
  });
});

describe("update workflow: scheduled run with no changes", () => {
  const ran = runsUnder(scenario({ changed: "false", enabled: "true" }));

  it("performs no mutation at all", () => {
    for (const m of MUTATING) expect(ran).not.toContain(m);
  });

  it("still runs the summary so the run is observable", () => {
    expect(ran).toContain("Summary");
  });
});

describe("update workflow: dry_run=true with changes present", () => {
  const ran = runsUnder(scenario({ changed: "true", dryRun: true, enabled: "true" }));

  it("never mints an App token", () => {
    expect(ran).not.toContain("Automation token (GitHub App)");
  });

  it("never commits, pushes, opens a PR, labels, or merges", () => {
    for (const m of MUTATING) expect(ran).not.toContain(m);
  });

  it("still classifies and reports the change", () => {
    expect(ran).toContain("Classify change + build PR body");
    expect(ran).toContain("Dry-run report (no mutations)");
  });
});

describe("update workflow: automation disabled", () => {
  // vars.ENABLE_SKILLS_AUTOMATION unset -> token step skipped -> token === ''
  const ran = runsUnder(scenario({ changed: "true", dryRun: false, enabled: "false", token: "" }));

  it("mints no token and mutates nothing", () => {
    for (const m of MUTATING) expect(ran).not.toContain(m);
  });

  it("reports the detected change instead of failing silently", () => {
    expect(ran).toContain("Report that automation is disabled");
  });
});

describe("update workflow: routine change", () => {
  const ran = runsUnder(scenario({
    changed: "true", dryRun: false, enabled: "true", token: "ghs_x", manual: "false",
  }));

  it("pushes, opens the PR, resets state, and enables auto-merge", () => {
    expect(ran).toContain("Commit + push the automation branch");
    expect(ran).toContain("Open or update the automation PR");
    expect(ran).toContain("Reset PR merge state (fail-closed)");
    expect(ran).toContain("Enable protected squash auto-merge (routine change)");
  });

  it("does not flag it for manual review", () => {
    expect(ran).not.toContain("Flag PR for manual review");
  });
});

describe("update workflow: manual-review change", () => {
  const ran = runsUnder(scenario({
    changed: "true", dryRun: false, enabled: "true", token: "ghs_x", manual: "true",
  }));

  it("NEVER enables auto-merge", () => {
    expect(ran).not.toContain("Enable protected squash auto-merge (routine change)");
  });

  it("opens the PR and labels it for a human", () => {
    expect(ran).toContain("Open or update the automation PR");
    expect(ran).toContain("Flag PR for manual review");
  });

  it("always resets inherited merge state first", () => {
    expect(ran).toContain("Reset PR merge state (fail-closed)");
  });
});

describe("update workflow: merge safety invariants", () => {
  const body = readFileSync(WORKFLOW, "utf8");
  // Comments legitimately mention the flags we forbid ("no --admin"), so
  // invariants about actual commands must ignore comment lines.
  const code = body
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

  it("uses safe auto-merge only — no --admin and no ruleset bypass", () => {
    expect(code).not.toContain("--admin");
    expect(code).not.toMatch(/bypass/i);
    expect(code).toMatch(/gh pr merge "\$PR_NUMBER" --squash --auto/);
  });

  it("has exactly one MERGING invocation, so there is no fallback path", () => {
    // Join shell line-continuations so a multi-line invocation is one string.
    const joined = code.replace(/\\\n\s*/g, " ");
    const calls = joined.match(/gh pr merge[^\n]*/g) ?? [];
    const merging = calls.filter((c) => !c.includes("--disable-auto"));
    expect(merging.length).toBe(1);
    expect(merging[0]).toContain("--match-head-commit");
  });

  it("refuses to create an empty commit", () => {
    expect(code).toContain("git diff --cached --quiet");
    expect(body).toContain("refusing to create an empty commit");
  });

  it("stages only the declared catalog paths", () => {
    expect(code).toMatch(/git add -A -- "\$\{paths\[@\]\}"/);
    expect(code).not.toMatch(/git add -A\s*$/m);
  });

  it("pushes the bot branch under a lease so a concurrent writer is not clobbered", () => {
    expect(code).toContain("--force-with-lease=");
    expect(code).not.toMatch(/git push[^\n]*--force(?!-with-lease)/);
  });

  it("keeps the single-branch/single-PR model", () => {
    expect(code).toContain("BRANCH: automation/skills-catalog");
    expect(code).toMatch(/gh pr list --head "\$BRANCH" --state open/);
  });
});
describe("release workflow: race and completeness invariants", () => {
  const RELEASE = join(import.meta.dir, "..", "..", ".github", "workflows", "skills-catalog-release.yml");
  const raw = readFileSync(RELEASE, "utf8");
  const wfr = parse(raw) as { concurrency?: { group?: string; "cancel-in-progress"?: boolean }; jobs: Record<string, { steps: Step[] }> };

  it("serializes releases repository-wide, not per-commit", () => {
    // A per-SHA group lets two main commits compute the same next tag at once.
    expect(wfr.concurrency?.group).toBe("skills-catalog-release");
    expect(wfr.concurrency?.group).not.toContain("github.sha");
    expect(wfr.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("reads the latest release after acquiring the lock, not via git describe", () => {
    expect(raw).toMatch(/releases\?per_page=100/);
    expect(raw).not.toMatch(/LATEST=\$\(git describe/);
  });

  it("fails loudly on a tag collision instead of silently skipping the release", () => {
    expect(raw).toMatch(/Tag \$TAG already exists/);
    expect(raw).not.toMatch(/already exists; skipping creation/);
  });

  it("verifies existing releases cryptographically, not by filename", () => {
    expect(raw).toContain("sha256sum -c SHA256SUMS");
    expect(raw).toContain("gh release download");
    expect(raw).toMatch(/is PARTIAL/);
    expect(raw).toMatch(/is CORRUPT/);
  });

  it("tags the version the tree declares, not one it computed", () => {
    // VERSION is the single source of truth: every plugin.json and marketplace
    // entry already carries it. A tag derived from anything else would let
    // installers and releases disagree about what shipped.
    expect(raw).toMatch(/next_tag=v\$\{VERSION\}/);
    expect(raw).toMatch(/tr -d '\[:space:\]' < VERSION/);
    expect(raw).not.toMatch(/release-tag\.ts/);
  });

  it("refuses to release a VERSION that understates what landed", () => {
    expect(raw).toContain("release-notes.ts check-version");
    expect(raw).toMatch(/VERSION is too low/);
  });

  it("refuses to re-tag a VERSION that is already published", () => {
    // Otherwise a forgotten bump silently produces a second release claiming to
    // be a version that already exists.
    expect(raw).toMatch(/is already released as v\$\{VERSION\}/);
  });

  it("builds release notes from the commits, not a hand-maintained changelog", () => {
    expect(raw).toContain("release-notes.ts notes");
    expect(raw).not.toMatch(/CHANGELOG/);
  });

  it("no longer requests permissions it stopped needing", () => {
    // The label-override lookup is gone; leaving pull-requests: read behind
    // would keep a token scope with no consumer.
    expect(raw).not.toMatch(/pull-requests:\s*read/);
  });

  it("tags the exact released commit", () => {
    expect(raw).toMatch(/git tag "\$TAG" "\$SHA"/);
    expect(raw).toMatch(/--target "\$SHA"/);
  });
});

describe("supply chain: actions are pinned to immutable SHAs", () => {
  // Enumerate the directory rather than hardcoding a list: a workflow added
  // later must be covered automatically, or the guarantee quietly stops
  // applying to the newest file.
  const wfDir = join(import.meta.dir, "..", "..", ".github", "workflows");
  const files = readdirSync(wfDir).filter((f) => f.endsWith(".yml")).sort();

  it("covers every workflow file in .github/workflows", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const f of files) {
    it(`${f} pins every third-party action to a 40-char commit SHA`, () => {
      const raw = readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", f), "utf8");
      const uses = [...raw.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
      expect(uses.length).toBeGreaterThan(0);
      for (const u of uses) {
        expect(u, `"${u}" is not pinned to a commit SHA`).toMatch(/@[0-9a-f]{40}$/);
      }
    });
  }
});
