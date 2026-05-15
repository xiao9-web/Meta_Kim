#!/usr/bin/env node
/**
 * Stop hook: extract evolution data from session transcript, then
 * auto-trigger LLM synthesis when enough packets have accumulated.
 *
 * Phase 1 — always runs (no API key required):
 *   Reads the JSONL transcript and writes a structured evolution packet to:
 *   .meta-kim/state/{profile}/evolution/{run-ref}.json
 *
 * Phase 2 — auto-synthesis (requires ANTHROPIC_API_KEY):
 *   After writing the packet, counts unsynthesized packets.
 *   If count >= threshold, spawns scripts/evolution-engine.mjs as a
 *   detached background process (fire-and-forget, never blocks stop).
 *
 * Config (env vars):
 *   META_KIM_AUTO_EVOLVE=0            — disable auto-synthesis
 *   META_KIM_AUTO_EVOLVE_THRESHOLD=3  — packet count before synthesis fires (default 3)
 *   META_KIM_PROFILE=default          — profile name
 *
 * Always exits 0.
 */

import { promises as fs, existsSync, openSync, closeSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const STDIN_CHUNKS = [];
for await (const chunk of process.stdin) STDIN_CHUNKS.push(chunk);
const RAW_STDIN = Buffer.concat(STDIN_CHUNKS).toString("utf8").trim();
let INPUT = {};
try {
	INPUT = JSON.parse(RAW_STDIN || "{}");
} catch {
	INPUT = {};
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const STAGES = [
	"Critical",
	"Fetch",
	"Thinking",
	"Execution",
	"Review",
	"Meta-Review",
	"Verification",
	"Evolution",
];

const STAGE_PATTERNS = {
	Critical: /\b(Critical|clarify|intentPacket|需求澄清)\b/gi,
	Fetch: /\b(Fetch|capability|findskill|能力搜索)\b/gi,
	Thinking: /\b(Thinking|dispatchBoard|Task Card|规划)\b/gi,
	Execution: /\b(Execution|dispatch|Worker Task|执行)\b/gi,
	Review: /\b(Review|reviewPacket|findings|CRITICAL|HIGH|MEDIUM|LOW)\b/gi,
	"Meta-Review": /\b(Meta-Review|元审查)\b/gi,
	Verification: /\b(Verification|verified|closeFindings|验证)\b/gi,
	Evolution: /\b(Evolution|writeback|evolutionWriteback|进化)\b/gi,
};

const SCAR_PATTERNS = [
	/(?:error|failed|failure|exception|crash|broke|broken|bug|fix|wrong|incorrect)[^\n]{0,120}/gi,
	/(?:mistake|antipattern|anti-pattern|avoid|don't|should not|must not)[^\n]{0,120}/gi,
];

const PATTERN_MARKERS = [
	/(?:works?|solved|fixed|approach|pattern|discovered|learned|insight)[^\n]{0,120}/gi,
	/(?:best practice|recommended|correct way|canonical|works well)[^\n]{0,120}/gi,
];

// ── Transcript helpers ──────────────────────────────────────────────────────

async function readTranscript(transcriptPath, maxLines = 800) {
	try {
		const raw = await fs.readFile(transcriptPath, "utf8");
		const lines = raw.split("\n").filter(Boolean);
		return lines.length > maxLines ? lines.slice(-maxLines).join("\n") : raw;
	} catch {
		return "";
	}
}

function extractAssistantText(jsonl) {
	const parts = [];
	for (const line of jsonl.split("\n")) {
		try {
			const obj = JSON.parse(line);
			if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
				for (const b of obj.message.content) {
					if (b.type === "text" && b.text) parts.push(b.text);
				}
			}
		} catch {
			/* skip */
		}
	}
	return parts.join("\n");
}

function extractAgentCalls(jsonl) {
	const agents = [];
	for (const line of jsonl.split("\n")) {
		try {
			const obj = JSON.parse(line);
			if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
				for (const b of obj.message.content) {
					if (b.type === "tool_use" && b.name === "Agent") {
						agents.push({
							description: b.input?.description || "unknown",
							subagent_type: b.input?.subagent_type || "claude",
						});
					}
				}
			}
		} catch {
			/* skip */
		}
	}
	return agents;
}

function extractToolCounts(jsonl) {
	const counts = {};
	for (const line of jsonl.split("\n")) {
		try {
			const obj = JSON.parse(line);
			if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
				for (const b of obj.message.content) {
					if (b.type === "tool_use" && b.name) {
						counts[b.name] = (counts[b.name] || 0) + 1;
					}
				}
			}
		} catch {
			/* skip */
		}
	}
	return counts;
}

function extractMatches(text, patterns, maxItems = 5) {
	const results = [];
	const seen = new Set();
	for (const pat of patterns) {
		pat.lastIndex = 0;
		let m;
		while ((m = pat.exec(text)) !== null && results.length < maxItems) {
			const raw = m[0].slice(0, 200).trim();
			if (!seen.has(raw)) {
				seen.add(raw);
				results.push(raw);
			}
		}
		pat.lastIndex = 0;
	}
	return results;
}

function detectActiveStages(text) {
	return STAGES.filter((s) => (text.match(STAGE_PATTERNS[s]) || []).length > 0);
}

// ── Auto-synthesis ──────────────────────────────────────────────────────────

async function countUnsynthesized(evoDir) {
	try {
		const files = await fs.readdir(evoDir);
		let count = 0;
		for (const f of files.filter(
			(x) => x.endsWith(".json") && x !== "latest.json",
		)) {
			try {
				const raw = await fs.readFile(path.join(evoDir, f), "utf8");
				const p = JSON.parse(raw);
				if (!p.synthesized) count++;
			} catch {
				/* skip */
			}
		}
		return count;
	} catch {
		return 0;
	}
}

function spawnEngineBackground(enginePath, logPath) {
	try {
		// Use nohup-style redirect so the child survives session boundary.
		// stdio: 'ignore' is not officially guaranteed to persist after Stop hook
		// exits — writing to a real log file is more reliable.
		const isWin = process.platform === "win32";
		if (isWin) {
			// Windows: cmd /c start /B node engine.mjs
			spawn("cmd", ["/c", "start", "/B", process.execPath, enginePath], {
				detached: true,
				stdio: "ignore",
				env: { ...process.env },
			}).unref();
		} else {
			// Unix: open log file so child has a real fd, then unref
			const fd = openSync(logPath, "a");
			spawn(process.execPath, [enginePath], {
				detached: true,
				stdio: ["ignore", fd, fd],
				env: { ...process.env },
			}).unref();
			closeSync(fd);
		}
		return true;
	} catch {
		return false;
	}
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
	process.exitCode = 0;
	if (INPUT.stop_hook_active === true) return;

	const transcriptPath = INPUT.transcript_path || INPUT.transcriptPath;
	if (!transcriptPath) return;

	const jsonl = await readTranscript(transcriptPath);
	if (jsonl.length < 200) return;

	const text = extractAssistantText(jsonl);
	if (text.length < 100) return;

	const activeStages = detectActiveStages(text);
	if (activeStages.length === 0) return;

	const agentCalls = extractAgentCalls(jsonl);
	const toolCounts = extractToolCounts(jsonl);
	const scars = extractMatches(text, SCAR_PATTERNS, 5);
	const patterns = extractMatches(text, PATTERN_MARKERS, 5);

	const profile = process.env.META_KIM_PROFILE || "default";
	const runRef = `evo-${Date.now()}`;

	const packet = {
		packetVersion: "1.0",
		runRef,
		profile,
		createdAt: new Date().toISOString(),
		cwd: INPUT.cwd || process.cwd(),
		activeStages,
		agentCalls,
		toolCounts,
		rawPatternHints: patterns,
		rawScarHints: scars,
		synthesized: false,
	};

	const evoDir = path.join(
		REPO_ROOT,
		".meta-kim",
		"state",
		profile,
		"evolution",
	);
	await fs.mkdir(evoDir, { recursive: true });

	const outFile = path.join(evoDir, `${runRef}.json`);
	await fs.writeFile(outFile, JSON.stringify(packet, null, 2), "utf8");
	await fs.writeFile(
		path.join(evoDir, "latest.json"),
		JSON.stringify(packet, null, 2),
		"utf8",
	);

	const rel = path.relative(REPO_ROOT, outFile).replace(/\\/g, "/");
	process.stderr.write(
		`[evolution] packet written: ${rel} (stages=${activeStages.length}, agents=${agentCalls.length})\n`,
	);

	// ── Phase 2: auto-synthesis ─────────────────────────────────────────────
	const autoEvolve = process.env.META_KIM_AUTO_EVOLVE !== "0";
	if (!autoEvolve || !process.env.ANTHROPIC_API_KEY) return;

	const threshold = parseInt(
		process.env.META_KIM_AUTO_EVOLVE_THRESHOLD || "3",
		10,
	);
	const pending = await countUnsynthesized(evoDir);
	if (pending < threshold) {
		process.stderr.write(
			`[evolution] ${pending}/${threshold} packets pending — synthesis deferred\n`,
		);
		return;
	}

	const enginePath = path.join(REPO_ROOT, "scripts", "evolution-engine.mjs");
	if (!existsSync(enginePath)) return;

	const logPath = path.join(
		REPO_ROOT,
		".meta-kim",
		"state",
		profile,
		"evolution-engine.log",
	);
	const launched = spawnEngineBackground(enginePath, logPath);
	if (launched) {
		process.stderr.write(
			`[evolution] auto-synthesis launched (${pending} packets >= threshold ${threshold})\n`,
		);
	}
}

main().catch(() => {
	process.exitCode = 0;
});
