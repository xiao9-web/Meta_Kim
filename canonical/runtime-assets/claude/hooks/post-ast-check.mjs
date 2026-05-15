#!/usr/bin/env node
/**
 * PostToolUse hook: structural code analysis with ast-grep (non-blocking).
 * Scans edited files for dangerous patterns and emits warnings to stderr.
 * Never blocks — always exits 0.
 *
 * Input: JSON on stdin (Claude Code hooks).
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { readJsonFromStdin, extractFilePath } from "./utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const input = await readJsonFromStdin();
const toolName = input.tool_name || "";
const filePath = extractFilePath(input.tool_input || input);

if (!["Edit", "Write"].includes(toolName)) process.exit(0);
if (!filePath.match(/\.(js|ts|jsx|tsx|mjs|cjs)$/)) process.exit(0);

const rulesDir = resolve(__dirname, "../../config/ast-grep-rules");
if (!existsSync(rulesDir)) process.exit(0);

try {
  const raw = execSync(
    `npx ast-grep scan --rules "${rulesDir}" "${filePath}" --json`,
    {
      encoding: "utf8",
      timeout: 8000,
      stdio: ["ignore", "pipe", "ignore"],
      cwd: input.cwd || process.cwd(),
    },
  );
  const findings = JSON.parse(raw || "[]");
  for (const f of findings) {
    const line = f.range?.start?.line ?? "?";
    const ruleId = f.rule?.id ?? "ast-grep";
    const msg = f.message ?? f.rule?.message ?? "pattern match";
    process.stderr.write(`[ast-grep] ${ruleId}: ${filePath}:${line} — ${msg}\n`);
  }
} catch {
  // ast-grep not installed or parse error — skip silently
}
