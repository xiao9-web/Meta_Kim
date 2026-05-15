#!/usr/bin/env node

/**
 * PostToolUse hook: auto-format JS/TS/JSON files after Edit/Write
 * Tries biome first (10-100x faster than prettier), falls back to prettier.
 *
 * Input: JSON on stdin (Claude Code hooks). See https://code.claude.com/docs/en/hooks
 */

import { execSync } from "node:child_process";
import process from "node:process";
import { readJsonFromStdin, extractFilePath } from "./utils.mjs";

const input = await readJsonFromStdin();
const toolName = input.tool_name || "";
const filePath = extractFilePath(input.tool_input || input);

if (!["Edit", "Write"].includes(toolName)) process.exit(0);
if (!filePath.match(/\.(js|ts|jsx|tsx|mjs|cjs|json)$/)) process.exit(0);

const cwd = input.cwd || process.cwd();

let formatted = false;
try {
  execSync(`npx @biomejs/biome format --write "${filePath}"`, {
    stdio: "ignore",
    timeout: 10000,
    cwd,
  });
  formatted = true;
} catch {
  // biome not available — fall back to prettier
}

if (!formatted) {
  try {
    execSync(`npx prettier --write "${filePath}"`, {
      stdio: "ignore",
      timeout: 10000,
      cwd,
    });
  } catch {
    // neither available — skip silently
  }
}
