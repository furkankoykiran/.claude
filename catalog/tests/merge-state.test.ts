/**
 * Executable tests for the fail-closed merge-state machine.
 *
 * These do not re-implement the logic — they extract the actual `run:` script
 * from `.github/workflows/skills-catalog-update.yml` and execute it against a
 * stubbed `gh`, so the shipped shell is what gets tested.
 *
 * The vulnerability being guarded: one branch and one PR are reused across
 * runs, and a GitHub auto-merge request SURVIVES new pushes to the head
 * branch. A routine run that enables auto-merge therefore leaves a live merge
 * request that a later security-sensitive run would inherit — its content
 * merges unattended under the previous run's verdict.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";

const WORKFLOW = join(import.meta.dir, "..", "..", ".github", "workflows", "skills-catalog-update.yml");

interface Step { name?: string; id?: string; run?: string }
const wf = parse(readFileSync(WORKFLOW, "utf8")) as { jobs: Record<string, { steps: Step[] }> };
const stepScript = (name: string): string => {
  const s = wf.jobs.update!.steps.find((x) => x.name === name);
  if (!s?.run) throw new Error(`step "${name}" has no run script`);
  return s.run;
};

const RESET = stepScript("Reset PR merge state (fail-closed)");
const AUTOMERGE = stepScript("Enable protected squash auto-merge (routine change)");
const FLAG = stepScript("Flag PR for manual review");

const PUSHED = "cafe1234cafe1234cafe1234cafe1234cafe1234";

interface PrState {
  headRefName?: string;
  headRefOid?: string;
  autoMergeMethod?: string | null;
  labels?: string[];
}

interface StubOpts {
  /** State returned by successive graphql reads. Last entry repeats. */
  reads: PrState[];
  /** Commands (matched as substrings) that the stub should fail. */
  fail?: string[];
  /** Result of `gh pr view --json labels` after an add. */
  labelsAfterAdd?: string[];
}

let work: string;
beforeEach(async () => { work = await mkdtemp(join(tmpdir(), "mergestate-")); });
afterEach(async () => { await rm(work, { recursive: true, force: true }); });

/** Build a fake `gh` that scripts graphql reads and records every call. */
function makeStub(o: StubOpts): { bin: string; calls: () => string[] } {
  const bin = join(work, "bin");
  mkdirSync(bin, { recursive: true });
  const stateFile = join(work, "reads.json");
  const callLog = join(work, "calls.log");
  const counter = join(work, "counter");
  writeFileSync(stateFile, JSON.stringify({
    reads: o.reads.map((r) => ({
      number: 26,
      headRefName: r.headRefName ?? "automation/skills-catalog",
      headRefOid: r.headRefOid ?? PUSHED,
      autoMergeRequest: r.autoMergeMethod ? { mergeMethod: r.autoMergeMethod } : null,
      // `gh pr view --json labels` returns a flat array, not GraphQL nodes.
      labels: (r.labels ?? []).map((n) => ({ name: n })),
    })),
    fail: o.fail ?? [],
    labelsAfterAdd: o.labelsAfterAdd ?? ["manual-review-required"],
  }));
  writeFileSync(counter, "0");

  writeFileSync(join(bin, "gh"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(callLog)}
CFG=${JSON.stringify(stateFile)}
for pat in $(jq -r '.fail[]' "$CFG"); do
  if printf '%s' "$*" | grep -qF -- "$(printf '%s' "$pat" | tr '~' ' ')"; then
    echo "stubbed failure for: $*" >&2
    exit 1
  fi
done
# \`gh pr view --json labels\` (label read-back after an add)
if printf '%s' "$*" | grep -q 'pr view' && printf '%s' "$*" | grep -q 'index("manual-review-required")'; then
  jq -r '[.labelsAfterAdd[]] | index("manual-review-required") != null' "$CFG"
  exit 0
fi
# \`gh pr view --json autoMergeRequest --jq ...\` (post-enable verification)
if printf '%s' "$*" | grep -q 'pr view' && printf '%s' "$*" | grep -q 'autoMergeRequest.mergeMethod'; then
  N=$(cat ${JSON.stringify(counter)})
  LAST=$(jq '.reads | length - 1' "$CFG")
  IDX=$([ "$N" -gt "$LAST" ] && echo "$LAST" || echo "$N")
  echo $((N+1)) > ${JSON.stringify(counter)}
  jq -r ".reads[$IDX].autoMergeRequest.mergeMethod // \\"none\\"" "$CFG"
  exit 0
fi
# Full state read used by read_state().
if printf '%s' "$*" | grep -q 'pr view'; then
  N=$(cat ${JSON.stringify(counter)})
  LAST=$(jq '.reads | length - 1' "$CFG")
  IDX=$([ "$N" -gt "$LAST" ] && echo "$LAST" || echo "$N")
  echo $((N+1)) > ${JSON.stringify(counter)}
  jq -c ".reads[$IDX]" "$CFG"
  exit 0
fi
exit 0
`, { mode: 0o755 });
  chmodSync(join(bin, "gh"), 0o755);

  return {
    bin,
    calls: () => {
      try { return readFileSync(callLog, "utf8").trim().split("\n").filter(Boolean); }
      catch { return []; }
    },
  };
}

function runScript(script: string, stub: { bin: string }, env: Record<string, string>) {
  const f = join(work, "step.sh");
  writeFileSync(f, script);
  const r = spawnSync("bash", [f], {
    env: {
      ...process.env,
      PATH: `${stub.bin}:${process.env.PATH}`,
      GITHUB_REPOSITORY: "furkankoykiran/.claude",
      BRANCH: "automation/skills-catalog",
      GITHUB_OUTPUT: join(work, "gh_output"),
      GH_TOKEN: "stub",
      ...env,
    },
    encoding: "utf8",
  });
  let outputs: Record<string, string> = {};
  try {
    outputs = Object.fromEntries(
      readFileSync(join(work, "gh_output"), "utf8").trim().split("\n").filter(Boolean)
        .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
    );
  } catch { /* no outputs written */ }
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", outputs };
}

const resetEnv = { PR_NUMBER: "26", PUSHED_SHA: PUSHED };

describe("merge-state reset: inherited auto-merge", () => {
  it("cancels an auto-merge left by a previous routine run, and proves it", () => {
    const stub = makeStub({ reads: [{ autoMergeMethod: "SQUASH" }, { autoMergeMethod: null }] });
    const r = runScript(RESET, stub, resetEnv);
    expect(r.code).toBe(0);
    expect(stub.calls().some((c) => c.includes("pr merge 26 --disable-auto"))).toBe(true);
    expect(r.stdout).toContain("Verified: auto-merge disabled.");
    expect(r.outputs.verified_sha).toBe(PUSHED);
  });

  it("does not call --disable-auto when no auto-merge is set", () => {
    const stub = makeStub({ reads: [{ autoMergeMethod: null }] });
    const r = runScript(RESET, stub, resetEnv);
    expect(r.code).toBe(0);
    expect(stub.calls().some((c) => c.includes("--disable-auto"))).toBe(false);
  });

  it("FAILS CLOSED when disabling auto-merge errors", () => {
    const stub = makeStub({ reads: [{ autoMergeMethod: "SQUASH" }], fail: ["--disable-auto"] });
    const r = runScript(RESET, stub, resetEnv);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("Could not disable the existing auto-merge request");
    expect(r.outputs.verified_sha).toBeUndefined();
  });

  it("FAILS CLOSED when auto-merge is still enabled after the disable call", () => {
    // disable "succeeds" but the re-read still reports SQUASH.
    const stub = makeStub({ reads: [{ autoMergeMethod: "SQUASH" }, { autoMergeMethod: "SQUASH" }] });
    const r = runScript(RESET, stub, resetEnv);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("STILL enabled");
    expect(r.outputs.verified_sha).toBeUndefined();
  });
});

describe("merge-state reset: head SHA binding", () => {
  it("FAILS CLOSED when the PR head is not the commit this run pushed", () => {
    const stub = makeStub({ reads: [{ autoMergeMethod: null, headRefOid: "dead".repeat(10) }] });
    const r = runScript(RESET, stub, resetEnv);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("Another run updated the branch concurrently");
    expect(r.outputs.verified_sha).toBeUndefined();
  });

  it("FAILS CLOSED when the PR points at an unexpected head branch", () => {
    const stub = makeStub({ reads: [{ autoMergeMethod: null, headRefName: "attacker/branch" }] });
    const r = runScript(RESET, stub, resetEnv);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("Refusing to touch it");
  });

  it("emits verified_sha only when the head matches exactly", () => {
    const stub = makeStub({ reads: [{ autoMergeMethod: null }] });
    expect(runScript(RESET, stub, resetEnv).outputs.verified_sha).toBe(PUSHED);
  });
});

describe("merge-state reset: stale policy labels", () => {
  it("removes an inherited manual-review-required label", () => {
    const stub = makeStub({ reads: [{ autoMergeMethod: null, labels: ["manual-review-required"] }] });
    const r = runScript(RESET, stub, resetEnv);
    expect(r.code).toBe(0);
    expect(stub.calls().some((c) => c.includes("--remove-label manual-review-required"))).toBe(true);
    expect(r.stdout).toContain("Removed stale manual-review-required label.");
  });

  it("leaves unrelated labels alone", () => {
    const stub = makeStub({ reads: [{ autoMergeMethod: null, labels: ["dependencies", "enhancement"] }] });
    const r = runScript(RESET, stub, resetEnv);
    expect(r.code).toBe(0);
    expect(stub.calls().some((c) => c.includes("--remove-label"))).toBe(false);
  });

  it("FAILS CLOSED when the stale label cannot be removed", () => {
    const stub = makeStub({
      reads: [{ autoMergeMethod: null, labels: ["manual-review-required"] }],
      fail: ["--remove-label"],
    });
    const r = runScript(RESET, stub, resetEnv);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("Could not remove the stale manual-review-required label");
  });
});

describe("policy transitions on the reused PR", () => {
  it("routine -> manual-review: the inherited auto-merge is cancelled first", () => {
    // Run N enabled auto-merge; run N+1 classifies the same PR as sensitive.
    const stub = makeStub({ reads: [{ autoMergeMethod: "SQUASH" }, { autoMergeMethod: null }] });
    const reset = runScript(RESET, stub, resetEnv);
    expect(reset.code).toBe(0);
    expect(stub.calls().some((c) => c.includes("--disable-auto"))).toBe(true);

    // The manual-review branch never re-enables it.
    const flag = runScript(FLAG, stub, { PR_NUMBER: "26" });
    expect(flag.code).toBe(0);
    expect(stub.calls().some((c) => c.includes("--squash --auto"))).toBe(false);
  });

  it("manual-review -> routine: the stale label is cleared before auto-merge", () => {
    const stub = makeStub({ reads: [{ autoMergeMethod: null, labels: ["manual-review-required"] }] });
    const reset = runScript(RESET, stub, resetEnv);
    expect(reset.code).toBe(0);
    expect(stub.calls().some((c) => c.includes("--remove-label manual-review-required"))).toBe(true);
  });

  it("label assignment failure fails closed and never merges", () => {
    const stub = makeStub({ reads: [{ autoMergeMethod: null }], fail: ["--add-label"] });
    const r = runScript(FLAG, stub, { PR_NUMBER: "26" });
    expect(r.code).not.toBe(0);
    expect(stub.calls().some((c) => c.includes("--squash --auto"))).toBe(false);
  });

  it("label that silently does not stick fails closed", () => {
    const stub = makeStub({ reads: [{ autoMergeMethod: null }], labelsAfterAdd: [] });
    const r = runScript(FLAG, stub, { PR_NUMBER: "26" });
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("was not present on PR");
  });
});

describe("auto-merge enablement", () => {
  const amEnv = { PR_NUMBER: "26", VERIFIED_SHA: PUSHED, MANUAL_REVIEW: "false" };

  it("binds the merge request to the verified head commit", () => {
    const stub = makeStub({ reads: [{ autoMergeMethod: "SQUASH" }] });
    const r = runScript(AUTOMERGE, stub, amEnv);
    expect(r.code).toBe(0);
    const merge = stub.calls().find((c) => c.includes("--squash --auto"))!;
    expect(merge).toContain(`--match-head-commit ${PUSHED}`);
    expect(merge).not.toContain("--admin");
  });

  it("refuses to run when classification is not exactly 'false'", () => {
    const stub = makeStub({ reads: [{ autoMergeMethod: null }] });
    for (const mr of ["true", "", "unknown"]) {
      const r = runScript(AUTOMERGE, stub, { ...amEnv, MANUAL_REVIEW: mr });
      expect(r.code, `MANUAL_REVIEW=${mr} should abort`).not.toBe(0);
      expect(stub.calls().some((c) => c.includes("--squash --auto"))).toBe(false);
    }
  });

  it("FAILS when the merge request cannot be verified afterwards", () => {
    const stub = makeStub({ reads: [{ autoMergeMethod: null }] });
    const r = runScript(AUTOMERGE, stub, amEnv);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("Auto-merge was not enabled");
  });
});