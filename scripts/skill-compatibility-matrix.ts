#!/usr/bin/env bun
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

type CatalogSkill = {
  skillName: string;
  pack?: string;
  canonicalInvocation?: string;
  namespacedInvocations?: string[];
  relativePath?: string;
  security?: { toolCount?: number; hasBashOrPowershell?: boolean; hasNetworkRef?: boolean; hasExecutable?: boolean; hasHooks?: boolean };
};

type Row = {
  id: string;
  area: string;
  status: "pass" | "pending-live-proof" | "fail";
  evidence: string;
  limitation?: string;
};

const root = process.cwd();
const catalogPath = join(root, "catalog/generated/skills-catalog.json");
if (!existsSync(catalogPath)) {
  console.error(`missing ${catalogPath}; run bun run catalog:generate first`);
  process.exit(1);
}
const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as { skills: CatalogSkill[] };
const liveEvidencePath = join(root, "docs/codex-skill-parity-live.json");
const liveEvidence = existsSync(liveEvidencePath)
  ? JSON.parse(readFileSync(liveEvidencePath, "utf8")) as { probes?: Array<{ id: string; status: string; backend: string; skill: string; limitations?: string }> }
  : { probes: [] };
const skills = catalog.skills ?? [];
const byName = new Map(skills.map((skill) => [skill.skillName, skill]));

function walk(dir: string, predicate: (path: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, predicate, out);
    else if (predicate(path)) out.push(path);
  }
  return out;
}

function dirsNamed(dir: string, wanted: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) continue;
    if (name === wanted) out.push(path);
    dirsNamed(path, wanted, out);
  }
  return out;
}

function pass(id: string, area: string, ok: boolean, evidence: string, limitation?: string): Row {
  return { id, area, status: ok ? "pass" : "fail", evidence, ...(limitation ? { limitation } : {}) };
}

const required = [
  "agent-reach",
  "ui-ux-pro-max",
  "brag-slim",
  "fk-writing-kit:humanizer",
  "spec",
  "review",
  "ship",
  "plan-devex-review",
];
const missingRequired = required.filter((name) => !byName.has(name));
const refs = dirsNamed(join(root, "skills"), "references");
const scripts = dirsNamed(join(root, "skills"), "scripts");
const assetFiles = walk(join(root, "skills"), (path) => /\/(assets|templates)\//.test(path) || /\.(tar\.gz|png|jpg|jpeg|webp|svg|icns)$/i.test(path));
const pluginManifests = walk(join(root, "skills"), (path) => path.endsWith("/.claude-plugin/plugin.json"));
const pluginSkillFiles = walk(join(root, "skills"), (path) => /\/skills\/fk-[^/]+\/skills\/[^/]+\/SKILL\.md$/.test(path));
const agents = walk(join(root, "skills"), (path) => /\/agents\/[^/]+\.md$/.test(path));
const hooks = walk(join(root, "hooks"), (path) => path.endsWith(".sh") || path.endsWith(".md"));
const toolSkills = skills.filter((skill) => (skill.security?.toolCount ?? 0) > 0);
const gstackSkills = ["spec", "review", "ship", "plan-devex-review"].filter((name) => byName.get(name)?.pack === "gstack");
const ccsCodexHumanizerProbe = liveEvidence.probes?.find((probe) => probe.id === "ccs-codex-humanizer-explicit" && probe.status === "pass");

const rows: Row[] = [
  pass(
    "static-required-representatives",
    "Representative packs",
    missingRequired.length === 0,
    missingRequired.length === 0 ? `found ${required.length} required representative skills` : `missing: ${missingRequired.join(", ")}`,
  ),
  pass(
    "automatic-discovery-catalog",
    "Automatic skill discovery",
    skills.length > 0 && skills.every((skill) => typeof skill.skillName === "string" && skill.skillName.length > 0),
    `${skills.length} catalog skills carry names and generated metadata`,
    "Static catalog presence does not prove model auto-selection at runtime.",
  ),
  pass(
    "explicit-invocation",
    "Explicit invocation",
    required.every((name) => byName.get(name)?.canonicalInvocation?.startsWith("/")),
    "representative skills expose slash-style canonicalInvocation values",
  ),
  pass(
    "namespaced-plugin-skills",
    "Namespaced skills",
    (byName.get("fk-writing-kit:humanizer")?.namespacedInvocations ?? []).includes("/fk-writing-kit:humanizer"),
    "fk-writing-kit:humanizer has a namespaced invocation",
  ),
  pass(
    "references-assets-scripts",
    "References, assets, scripts",
    refs.length > 0 && scripts.length > 0 && assetFiles.length > 0,
    `${refs.length} references dirs, ${scripts.length} scripts dirs, ${assetFiles.length} asset/template/binary files detected`,
  ),
  pass(
    "allowed-tools-frontmatter",
    "Allowed tools",
    toolSkills.length > 0 && (byName.get("fk-writing-kit:humanizer")?.security?.toolCount ?? 0) > 0,
    `${toolSkills.length} catalog skills declare tool access; humanizer toolCount=${byName.get("fk-writing-kit:humanizer")?.security?.toolCount ?? 0}`,
  ),
  pass(
    "plugin-skills",
    "Plugin skills",
    pluginManifests.length >= 5 && pluginSkillFiles.length > 0,
    `${pluginManifests.length} Claude plugin manifests and ${pluginSkillFiles.length} plugin skill files detected`,
  ),
  pass(
    "skill-driven-hooks",
    "Hooks",
    hooks.length > 0 && existsSync(join(root, "settings.base.json")),
    `${hooks.length} hook files detected and settings.base.json is present`,
    "Static hook wiring does not prove hook execution inside Claude Code or Codex sessions.",
  ),
  pass(
    "subagents",
    "Subagents with skills",
    agents.length >= 4,
    `${agents.length} agent files detected, including fk-eng-agents representatives`,
    "Static agent files do not prove subagent launch semantics under ccs codex.",
  ),
  pass(
    "gstack-representatives",
    "Representative gstack skills",
    gstackSkills.length === 4,
    `gstack representatives present: ${gstackSkills.join(", ")}`,
  ),
  pass("agent-reach", "Agent-Reach", byName.has("agent-reach"), "agent-reach is present in generated catalog"),
  pass("ui-ux-pro-max", "UI/UX Pro Max", byName.has("ui-ux-pro-max"), "ui-ux-pro-max is present in generated catalog"),
  pass("brag-slim", "BRAG slim", byName.has("brag-slim"), "brag-slim is present in generated catalog"),
  pass("repo-humanizer", "Repo-owned humanizer", byName.has("fk-writing-kit:humanizer"), "fk-writing-kit:humanizer is present in generated catalog"),
  {
    id: "live-ccs-codex-explicit-humanizer",
    area: "ccs codex E2E",
    status: ccsCodexHumanizerProbe ? "pass" : "pending-live-proof",
    evidence: ccsCodexHumanizerProbe
      ? `${ccsCodexHumanizerProbe.backend} explicit invocation of ${ccsCodexHumanizerProbe.skill} passed`
      : "not run in this static checker",
    limitation: ccsCodexHumanizerProbe?.limitations ?? "Requires live Claude Code through ccs codex with a small explicit skill prompt.",
  },
  {
    id: "live-native-claude",
    area: "Native Claude backend E2E",
    status: "pending-live-proof",
    evidence: "not run in this static checker",
    limitation: "Requires a live Claude Code session on an Anthropic/Claude backend.",
  },
  {
    id: "live-ccs-codex-broad-parity",
    area: "ccs codex broad skill parity",
    status: "pending-live-proof",
    evidence: "not run in this static checker",
    limitation: "Still needs automatic selection, references/assets/scripts, hooks, subagents, and representative gstack live probes.",
  },
];

const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  summary: {
    pass: rows.filter((row) => row.status === "pass").length,
    pendingLiveProof: rows.filter((row) => row.status === "pending-live-proof").length,
    fail: rows.filter((row) => row.status === "fail").length,
  },
  rows,
};

const args = new Set(process.argv.slice(2));
if (args.has("--markdown")) {
  console.log("| ID | Area | Status | Evidence | Limitation |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const row of rows) {
    console.log(`| ${row.id} | ${row.area} | ${row.status} | ${row.evidence.replaceAll("|", "\\|")} | ${(row.limitation ?? "").replaceAll("|", "\\|")} |`);
  }
} else {
  console.log(JSON.stringify(result, null, 2));
}

if (args.has("--check") && result.summary.fail > 0) {
  process.exit(1);
}
