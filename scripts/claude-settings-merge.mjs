/**
 * Shared Claude Code settings.json merge helpers.
 * Project sync (repo .claude/) and global sync (~/.claude/) must merge, never blind overwrite.
 */

import path from "node:path";

// ── Global ~/.claude/hooks/meta-kim/ (sync-global-meta-theory) ──────────

/**
 * Normalize a hook command string so single- and double-backslash forms
 * compare identically. Older versions of `hookCommandNode` produced
 * double-JSON-escaped Windows paths (e.g. `C:\\\\Users\\\\...` on disk,
 * `C:\\Users\\...` after parse), which the original single-backslash
 * matchers missed. Callers should compare against the normalized form.
 */
function normalizeHookCommand(command) {
  if (typeof command !== "string") return "";
  return command.replace(/\\\\/g, "\\");
}

export function isGlobalMetaKimManagedHookCommand(command) {
  if (typeof command !== "string") {
    return false;
  }
  const n = normalizeHookCommand(command);
  return n.includes("hooks/meta-kim/") || n.includes("hooks\\meta-kim\\");
}

/**
 * Render a `node <path>` hook command.
 *
 * Historical note: prior implementation was
 *   return `node ${JSON.stringify(absScriptPath)}`;
 * That produced a string containing literal `\\` byte sequences for
 * Windows paths, which were then JSON.stringify'd a second time when the
 * enclosing settings object was serialized — yielding `\\\\` on disk and
 * breaking identifier matching on cleanup. The fix inlines the quoted
 * path directly; `JSON.stringify` applied at settings-write time handles
 * escaping once, correctly.
 */
export function hookCommandNode(absScriptPath) {
  return `node "${absScriptPath.replace(/\\/g, "/")}"`;
}

/** Hook blocks matching Meta_Kim canonical runtime (absolute paths under meta-kim/). */
export function buildMetaKimHooksTemplate(absHooksDir) {
  const cmd = (name) => ({
    type: "command",
    command: hookCommandNode(path.join(absHooksDir, name)),
  });

  return {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [
          cmd("block-dangerous-bash.mjs"),
          cmd("pre-git-push-confirm.mjs"),
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "Edit|Write",
        hooks: [
          cmd("post-format.mjs"),
          cmd("post-typecheck.mjs"),
          cmd("post-console-log-warn.mjs"),
        ],
      },
    ],
    SubagentStart: [
      {
        matcher: "*",
        hooks: [cmd("subagent-context.mjs")],
      },
    ],
    Stop: [
      {
        matcher: "*",
        hooks: [
          cmd("stop-compaction.mjs"),
          cmd("stop-console-log-audit.mjs"),
          cmd("stop-completion-guard.mjs"),
        ],
      },
    ],
  };
}

export function stripGlobalMetaKimHookEntriesFromBlocks(blocks) {
  return blocks
    .map((block) => ({
      ...block,
      hooks: (block.hooks || []).filter(
        (h) => !isGlobalMetaKimManagedHookCommand(h.command || ""),
      ),
    }))
    .filter((block) => (block.hooks || []).length > 0);
}

// ── Repo .claude/hooks/*.mjs (sync-runtimes project scope) ──────────────

const REPO_META_KIM_HOOK_FILES = [
  "block-dangerous-bash.mjs",
  "pre-git-push-confirm.mjs",
  "post-format.mjs",
  "post-typecheck.mjs",
  "post-console-log-warn.mjs",
  "post-ast-check.mjs",
  "subagent-context.mjs",
  "stop-compaction.mjs",
  "stop-memory-save.mjs",
  "stop-console-log-audit.mjs",
  "stop-completion-guard.mjs",
  "stop-evolution.mjs",
];

export function isRepoMetaKimHookCommand(command) {
  if (typeof command !== "string") {
    return false;
  }
  const norm = normalizeHookCommand(command).replace(/\\/g, "/");
  if (!norm.includes(".claude/hooks/")) {
    return false;
  }
  return REPO_META_KIM_HOOK_FILES.some(
    (f) => norm.endsWith(f) || norm.includes(`/hooks/${f}`),
  );
}

export function stripRepoMetaKimHookEntriesFromBlocks(blocks) {
  return blocks
    .map((block) => ({
      ...block,
      hooks: (block.hooks || []).filter(
        (h) => !isRepoMetaKimHookCommand(h.command || ""),
      ),
    }))
    .filter((block) => (block.hooks || []).length > 0);
}

// ── Shared block merge ───────────────────────────────────────────────────

export function mergeHookMatcherBlocks(existing, additions) {
  const result = structuredClone(existing);
  for (const addBlock of additions) {
    const idx = result.findIndex((b) => b.matcher === addBlock.matcher);
    if (idx === -1) {
      result.push(structuredClone(addBlock));
      continue;
    }
    const cmds = new Set(
      (result[idx].hooks || []).map((h) => h.command).filter(Boolean),
    );
    for (const h of addBlock.hooks || []) {
      if (!cmds.has(h.command)) {
        if (!result[idx].hooks) {
          result[idx].hooks = [];
        }
        result[idx].hooks.push(h);
        cmds.add(h.command);
      }
    }
  }
  return result;
}

/** Merge Meta_Kim global hooks (hooks/meta-kim/) into existing settings; preserves other keys. */
export function mergeGlobalMetaKimHooksIntoSettings(settings, template) {
  const next = { ...settings };
  if (!next.hooks) {
    next.hooks = {};
  }
  const hooks = { ...next.hooks };

  for (const [event, additionBlocks] of Object.entries(template)) {
    const cleaned = stripGlobalMetaKimHookEntriesFromBlocks(hooks[event] || []);
    hooks[event] = mergeHookMatcherBlocks(cleaned, additionBlocks);
  }

  next.hooks = hooks;
  return next;
}

/** Merge Meta_Kim repo hooks (.claude/hooks/*.mjs) into existing settings.hooks. */
export function mergeRepoMetaKimHooksIntoSettings(settings, templateHooks) {
  const next = { ...settings };
  if (!templateHooks) {
    return next;
  }
  if (!next.hooks) {
    next.hooks = {};
  }
  const hooks = { ...next.hooks };

  for (const [event, additionBlocks] of Object.entries(templateHooks)) {
    const cleaned = stripRepoMetaKimHookEntriesFromBlocks(hooks[event] || []);
    hooks[event] = mergeHookMatcherBlocks(cleaned, additionBlocks);
  }

  next.hooks = hooks;
  return next;
}

/** Union deny lists; object fields: base overrides canonical for same keys except deny. */
export function mergePermissionsDenyUnion(canonicalPerm, basePerm) {
  if (!canonicalPerm && !basePerm) {
    return undefined;
  }
  const merged = { ...canonicalPerm, ...basePerm };
  const deny = [
    ...new Set([...(canonicalPerm?.deny ?? []), ...(basePerm?.deny ?? [])]),
  ];
  if (deny.length) {
    merged.deny = deny;
  }
  return merged;
}

/**
 * Merge canonical Claude settings into existing repo-local settings: keep user keys,
 * union permissions.deny, merge Meta_Kim-managed hooks only.
 * @param {Record<string, unknown>} base - existing ~/.meta or user file (may be {})
 * @param {Record<string, unknown>} canonical - parsed canonical/runtime-assets/claude/settings.json with repo hook paths already resolved (e.g. absolute).
 */
export function mergeRepoClaudeSettings(base, canonical) {
  const out = { ...base };

  for (const [k, v] of Object.entries(canonical)) {
    if (k === "hooks" || k === "permissions") {
      continue;
    }
    if (out[k] === undefined) {
      out[k] = v;
    }
  }

  out.permissions = mergePermissionsDenyUnion(
    canonical.permissions,
    base.permissions,
  );

  const canonHooks = canonical.hooks;
  out.hooks = mergeRepoMetaKimHooksIntoSettings(base, canonHooks).hooks;

  return out;
}

/**
 * Convert canonical relative repo hook commands to absolute paths (repo-local sync).
 * Mutates `settings.hooks` in place.
 */
export function rewriteRepoHookCommandsToAbsolute(settings, repoRoot) {
  const relHookRe = /^node \.claude\/hooks\/(.+)\.mjs$/;
  for (const hookType of Object.keys(settings.hooks ?? {})) {
    for (const block of settings.hooks[hookType] ?? []) {
      for (const h of block.hooks ?? []) {
        if (h.type === "command" && relHookRe.test(h.command)) {
          const hookName = h.command.match(relHookRe)[1];
          const absPath =
            repoRoot.replace(/\//g, path.sep) +
            path.sep +
            ".claude" +
            path.sep +
            "hooks" +
            path.sep +
            hookName +
            ".mjs";
          h.command = hookCommandNode(absPath);
        }
      }
    }
  }
}
