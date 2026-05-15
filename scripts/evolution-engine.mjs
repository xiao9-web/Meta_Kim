#!/usr/bin/env node
/**
 * Evolution Engine — LLM-powered synthesis of session patterns and scars.
 *
 * Reads unsynthesized evolution packets from:
 *   .meta-kim/state/{profile}/evolution/*.json
 *
 * Calls claude-opus-4-7 with adaptive thinking + prompt caching to extract:
 *   - PATTERNS: reusable successful approaches, decision heuristics
 *   - SCARS: anti-patterns, failure modes, things to avoid
 *
 * Writes outputs to:
 *   memory/patterns/{id}.json
 *   memory/scars/{id}.json
 *
 * Usage:
 *   node scripts/evolution-engine.mjs              # process all pending
 *   node scripts/evolution-engine.mjs --limit 5    # process at most 5
 *   node scripts/evolution-engine.mjs --dry-run    # show what would be processed
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const LIMIT = (() => {
  const i = args.indexOf("--limit");
  return i >= 0 ? parseInt(args[i + 1], 10) || 10 : 10;
})();
const PROFILE = process.env.META_KIM_PROFILE || "default";

const EVOLUTION_DIR = path.join(REPO_ROOT, ".meta-kim", "state", PROFILE, "evolution");
const PATTERNS_DIR = path.join(REPO_ROOT, "memory", "patterns");
const SCARS_DIR = path.join(REPO_ROOT, "memory", "scars");

// Prompt caching: system prompt is stable, mark it cacheable
const SYSTEM_PROMPT = `You are the Meta_Kim Evolution Engine. Your job is to analyze raw session data and extract structured, reusable knowledge.

From the provided session evolution packets you must extract:

1. **PATTERNS**: Recurring successful approaches, decision heuristics, capability mappings, and workflow shortcuts that future sessions should repeat.
2. **SCARS**: Anti-patterns, failure modes, root causes of errors, and things that should be avoided.

Rules:
- Be concrete and specific — not generic advice
- Each pattern/scar should be independently actionable
- Confidence 0.0-1.0 based on how clearly the evidence supports it
- Tags should be lowercase slugs (e.g. "tool-use", "dispatch", "meta-theory", "performance")
- De-duplicate: if a pattern/scar is essentially the same as one already in the existing knowledge base, skip it

Output ONLY valid JSON with this exact shape:
{
  "patterns": [
    {
      "id": "P-<timestamp>-<n>",
      "title": "short title (max 60 chars)",
      "description": "concrete description of what works and why",
      "confidence": 0.85,
      "tags": ["tag1", "tag2"],
      "sourceRunRef": "<runRef>"
    }
  ],
  "scars": [
    {
      "id": "S-<timestamp>-<n>",
      "title": "short title (max 60 chars)",
      "description": "what went wrong and root cause",
      "antiPattern": "the specific thing to avoid",
      "confidence": 0.75,
      "tags": ["tag1", "tag2"],
      "sourceRunRef": "<runRef>"
    }
  ]
}

If no patterns or scars can be extracted from the data, return {"patterns": [], "scars": []}`;

async function loadExistingKnowledge() {
  const existing = { patternTitles: new Set(), scarTitles: new Set() };
  try {
    const patternFiles = await readdir(PATTERNS_DIR);
    for (const f of patternFiles.filter((x) => x.endsWith(".json"))) {
      const raw = await readFile(path.join(PATTERNS_DIR, f), "utf8");
      const p = JSON.parse(raw);
      if (p.title) existing.patternTitles.add(p.title.toLowerCase());
    }
  } catch { /* directory might not exist yet */ }
  try {
    const scarFiles = await readdir(SCARS_DIR);
    for (const f of scarFiles.filter((x) => x.endsWith(".json"))) {
      const raw = await readFile(path.join(SCARS_DIR, f), "utf8");
      const s = JSON.parse(raw);
      if (s.title) existing.scarTitles.add(s.title.toLowerCase());
    }
  } catch { /* directory might not exist yet */ }
  return existing;
}

async function loadPendingPackets() {
  try {
    const files = await readdir(EVOLUTION_DIR);
    const packets = [];
    for (const f of files.filter((x) => x.endsWith(".json") && x !== "latest.json")) {
      const raw = await readFile(path.join(EVOLUTION_DIR, f), "utf8");
      const p = JSON.parse(raw);
      if (!p.synthesized) packets.push({ file: path.join(EVOLUTION_DIR, f), packet: p });
    }
    return packets.slice(0, LIMIT);
  } catch { return []; }
}

async function synthesize(client, packets, existing) {
  if (packets.length === 0) return { patterns: [], scars: [] };

  const packetSummaries = packets.map(({ packet: p }) => ({
    runRef: p.runRef,
    createdAt: p.createdAt,
    activeStages: p.activeStages || [],
    agentCalls: (p.agentCalls || []).map((a) => a.description),
    toolCounts: p.toolCounts || {},
    rawPatternHints: p.rawPatternHints || [],
    rawScarHints: p.rawScarHints || [],
  }));

  const existingContext = [
    ...[...existing.patternTitles].slice(0, 20).map((t) => `EXISTING PATTERN: ${t}`),
    ...[...existing.scarTitles].slice(0, 20).map((t) => `EXISTING SCAR: ${t}`),
  ].join("\n");

  const userContent = [
    existingContext ? `Existing knowledge (do not duplicate):\n${existingContext}\n` : "",
    `Session packets to synthesize (${packetSummaries.length} sessions):\n`,
    JSON.stringify(packetSummaries, null, 2),
  ]
    .filter(Boolean)
    .join("\n");

  const stream = await client.messages.stream({
    model: "claude-opus-4-7",
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userContent }],
  });

  const response = await stream.finalMessage();
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) return { patterns: [], scars: [] };

  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { patterns: [], scars: [] };

  return JSON.parse(jsonMatch[0]);
}

async function persistResults(results, ts) {
  await mkdir(PATTERNS_DIR, { recursive: true });
  await mkdir(SCARS_DIR, { recursive: true });

  let saved = 0;
  for (const p of results.patterns || []) {
    const id = p.id || `P-${ts}-${saved}`;
    await writeFile(
      path.join(PATTERNS_DIR, `${id}.json`),
      JSON.stringify({ ...p, id, savedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
    saved++;
    console.log(`  [pattern] ${id}: ${p.title}`);
  }
  for (const s of results.scars || []) {
    const id = s.id || `S-${ts}-${saved}`;
    await writeFile(
      path.join(SCARS_DIR, `${id}.json`),
      JSON.stringify({ ...s, id, savedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
    saved++;
    console.log(`  [scar]    ${id}: ${s.title}`);
  }
  return saved;
}

async function markSynthesized(packetEntries) {
  for (const { file, packet } of packetEntries) {
    await writeFile(
      file,
      JSON.stringify({ ...packet, synthesized: true, synthesizedAt: new Date().toISOString() }, null, 2),
      "utf8",
    );
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("[evolution-engine] ANTHROPIC_API_KEY not set — skipping synthesis");
    process.exit(1);
  }

  const pending = await loadPendingPackets();
  if (pending.length === 0) {
    console.log("[evolution-engine] No pending evolution packets found.");
    return;
  }

  console.log(`[evolution-engine] Found ${pending.length} unsynthesized packet(s).`);
  for (const { packet: p } of pending) {
    console.log(`  - ${p.runRef} (${p.createdAt?.slice(0, 10) ?? "?"}): stages=${p.activeStages?.join(",") ?? "?"}`);
  }

  if (DRY_RUN) {
    console.log("[evolution-engine] --dry-run: no changes written.");
    return;
  }

  const existing = await loadExistingKnowledge();
  const client = new Anthropic();
  const ts = Date.now();

  console.log("[evolution-engine] Synthesizing with claude-opus-4-7 (adaptive thinking)...");
  const results = await synthesize(client, pending, existing);

  const saved = await persistResults(results, ts);
  await markSynthesized(pending);

  console.log(
    `[evolution-engine] Done: ${results.patterns?.length ?? 0} patterns, ${results.scars?.length ?? 0} scars written. (${saved} files total)`,
  );
}

main().catch((err) => {
  console.error("[evolution-engine] Error:", err.message);
  process.exit(1);
});
