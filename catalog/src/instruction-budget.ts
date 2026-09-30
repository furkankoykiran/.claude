import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadMarketplaceSpec, type MarketplaceSpec } from "./marketplace.ts";
import { parseFrontmatter } from "./listing-budget.ts";
import { CatalogError } from "./types.ts";

// Repository policy ceilings, not runtime token limits.
export const INSTRUCTION_BUDGET_BYTES = 8192;
export const CODEX_DISCOVERY_BUDGET_BYTES = 4096;

export interface InstructionBudgetReport {
  instructionBytes: number;
  instructionBudgetBytes: number;
  claudeInstructionBytes: number;
  codexInstructionBytes: number;
  files: string[];
  codexDiscoveryBytes: number;
  codexDiscoveryBudgetBytes: number;
  skillCount: number;
  withinBudget: boolean;
}

/** The toolkit uses standalone relative imports outside Markdown code fences. */
export function instructionImports(source: string, file: string): string[] {
  const imports: string[] = [];
  let fence: string | undefined;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    const marker = trimmed.match(/^(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1]!;
      else if (trimmed[0] === fence[0] && marker[1]!.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence || !trimmed.startsWith("@")) continue;
    const target = trimmed.slice(1);
    if (!/^(?:\.\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(target) || isAbsolute(target)) {
      throw new CatalogError("instruction import must be a standalone repository-relative path", file);
    }
    imports.push(target);
  }
  return imports;
}

export async function buildInstructionBudgetReport(
  repoRoot: string,
  spec: MarketplaceSpec,
  instructionBudgetBytes = INSTRUCTION_BUDGET_BYTES,
  codexDiscoveryBudgetBytes = CODEX_DISCOVERY_BUDGET_BYTES,
): Promise<InstructionBudgetReport> {
  const root = await realpath(repoRoot);
  const sizes = new Map<string, number>();
  const claudeFiles = new Set<string>();
  const active = new Set<string>();

  async function localFile(path: string): Promise<string> {
    const abs = await realpath(resolve(root, path));
    const rel = relative(root, abs);
    if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
      throw new CatalogError("instruction or skill path escapes repository", path);
    }
    return abs;
  }

  async function visit(path: string): Promise<void> {
    const abs = await localFile(path);
    if (active.has(abs)) throw new CatalogError("instruction import cycle", path);
    if (claudeFiles.has(abs)) return;
    active.add(abs);
    const source = await readFile(abs, "utf8");
    sizes.set(abs, Buffer.byteLength(source, "utf8"));
    for (const imported of instructionImports(source, relative(root, abs))) {
      await visit(resolve(dirname(abs), imported));
    }
    active.delete(abs);
    claudeFiles.add(abs);
  }

  await visit("CLAUDE.md");
  const agents = await localFile("AGENTS.md");
  const codexInstructionBytes = Buffer.byteLength(await readFile(agents, "utf8"), "utf8");
  sizes.set(agents, codexInstructionBytes);

  const discovery: { name: string; description: string; path: string }[] = [];
  for (const plugin of spec.plugins) {
    for (const skill of plugin.skills) {
      const path = [spec.pluginRoot, plugin.dir, "skills", skill, "SKILL.md"].join("/");
      const fm = parseFrontmatter(await readFile(await localFile(path), "utf8"), path);
      if (typeof fm.name !== "string" || !fm.name || typeof fm.description !== "string" || !fm.description.trim()) {
        throw new CatalogError("discovery metadata requires a name and description", path);
      }
      // Claude's invocation flag is not treated as a Codex discovery guarantee.
      discovery.push({ name: fm.name, description: fm.description.replace(/\s+/g, " ").trim(), path });
    }
  }
  discovery.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const codexDiscoveryBytes = Buffer.byteLength(JSON.stringify(discovery), "utf8");
  const instructionBytes = [...sizes.values()].reduce((sum, bytes) => sum + bytes, 0);
  return {
    instructionBytes,
    instructionBudgetBytes,
    claudeInstructionBytes: [...claudeFiles].reduce((sum, file) => sum + sizes.get(file)!, 0),
    codexInstructionBytes,
    files: [...sizes.keys()].map((file) => relative(root, file).split("\\").join("/")).sort(),
    codexDiscoveryBytes,
    codexDiscoveryBudgetBytes,
    skillCount: discovery.length,
    withinBudget: instructionBytes <= instructionBudgetBytes && codexDiscoveryBytes <= codexDiscoveryBudgetBytes,
  };
}

if (import.meta.main) {
  try {
    const root = resolve(import.meta.dir, "../..");
    const report = await buildInstructionBudgetReport(root, await loadMarketplaceSpec(join(root, "marketplace.toml")));
    console.log(JSON.stringify(report, null, 2));
    if (!report.withinBudget) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
