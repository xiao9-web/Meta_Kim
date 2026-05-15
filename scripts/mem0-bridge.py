#!/usr/bin/env python3
"""
mem0 bridge for Meta_Kim.

Adds session memories to mem0's semantic vector store so they can be
retrieved by future sessions with semantic search (not just keyword match).

Usage:
  python3 scripts/mem0-bridge.py --content "..." --tags "tag1,tag2"
  python3 scripts/mem0-bridge.py --file .meta-kim/state/default/evolution/latest.json
  python3 scripts/mem0-bridge.py --list                # show recent memories
  python3 scripts/mem0-bridge.py --search "topic"     # semantic search

Requirements:
  pip install mem0ai

Configuration (env vars or ~/.meta-kim/mem0-config.json):
  ANTHROPIC_API_KEY  — used for Anthropic embedder (preferred)
  MEM0_STORAGE_DIR   — local directory for chroma storage (default: ~/.meta-kim/mem0)
  MEM0_USER_ID       — user id for scoping memories (default: meta-kim-default)
"""

import argparse
import json
import os
import sys
from pathlib import Path

# ── Config ─────────────────────────────────────────────────────────────────

HOME = Path.home()
DEFAULT_STORAGE = HOME / ".meta-kim" / "mem0"
USER_ID = os.environ.get("MEM0_USER_ID", "meta-kim-default")
STORAGE_DIR = os.environ.get("MEM0_STORAGE_DIR", str(DEFAULT_STORAGE))


def get_mem0_config():
    """Build mem0 config. Uses Anthropic embedder if API key is available."""
    config = {
        "vector_store": {
            "provider": "chroma",
            "config": {
                "collection_name": "meta_kim_memories",
                "path": STORAGE_DIR,
            },
        },
    }

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if api_key:
        config["embedder"] = {
            "provider": "anthropic",
            "config": {"model": "voyage-3", "api_key": api_key},
        }
    else:
        # Fallback: sentence-transformers (no API key required)
        config["embedder"] = {
            "provider": "huggingface",
            "config": {"model": "sentence-transformers/all-MiniLM-L6-v2"},
        }

    return config


def get_memory():
    """Initialize mem0 Memory instance."""
    try:
        from mem0 import Memory
    except ImportError:
        print("[mem0-bridge] mem0ai not installed. Run: pip install mem0ai", file=sys.stderr)
        sys.exit(1)

    Path(STORAGE_DIR).mkdir(parents=True, exist_ok=True)
    return Memory.from_config(get_mem0_config())


# ── Commands ────────────────────────────────────────────────────────────────

def cmd_add(content: str, tags: list[str], metadata: dict | None = None):
    """Add a memory entry."""
    m = get_memory()
    meta = {"source": "meta-kim", "tags": tags, **(metadata or {})}
    tag_str = f" [tags: {', '.join(tags)}]" if tags else ""
    result = m.add(content + tag_str, user_id=USER_ID, metadata=meta)
    print(f"[mem0-bridge] Added memory: {result}")


def cmd_add_from_file(file_path: str):
    """Add memory from an evolution packet JSON file."""
    with open(file_path) as f:
        packet = json.load(f)

    parts = [f"Meta_Kim session — {packet.get('createdAt', '?')[:10]}"]
    stages = packet.get("activeStages", [])
    if stages:
        parts.append(f"Stages: {', '.join(stages)}")
    agents = [a.get("description", "?") for a in packet.get("agentCalls", [])]
    if agents:
        parts.append(f"Agents dispatched: {'; '.join(agents[:3])}")
    hints = packet.get("rawPatternHints", [])
    if hints:
        parts.append(f"Pattern hints: {'; '.join(hints[:2])}")
    scars = packet.get("rawScarHints", [])
    if scars:
        parts.append(f"Scar hints: {'; '.join(scars[:2])}")

    content = "\n".join(parts)
    tags = ["meta-kim", "session"] + stages[:3]
    cmd_add(content, tags, metadata={"runRef": packet.get("runRef"), "source_file": file_path})


def cmd_search(query: str, limit: int = 5):
    """Semantic search over stored memories."""
    m = get_memory()
    results = m.search(query, user_id=USER_ID, limit=limit)
    memories = results.get("results", results) if isinstance(results, dict) else results
    if not memories:
        print("[mem0-bridge] No results found.")
        return
    for i, mem in enumerate(memories, 1):
        score = mem.get("score", "?")
        text = mem.get("memory", str(mem))[:200]
        print(f"  {i}. [{score:.3f}] {text}")


def cmd_list(limit: int = 10):
    """List recent memories."""
    m = get_memory()
    results = m.get_all(user_id=USER_ID)
    memories = results.get("results", results) if isinstance(results, dict) else results
    if not memories:
        print("[mem0-bridge] No memories stored yet.")
        return
    print(f"[mem0-bridge] {len(memories)} total memories (showing latest {limit}):")
    for mem in list(memories)[-limit:]:
        text = mem.get("memory", str(mem))[:120]
        created = mem.get("created_at", "?")[:10] if mem.get("created_at") else "?"
        print(f"  [{created}] {text}")


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="mem0 bridge for Meta_Kim")
    parser.add_argument("--content", help="Memory content to add")
    parser.add_argument("--tags", default="", help="Comma-separated tags")
    parser.add_argument("--file", help="Add memory from evolution packet JSON file")
    parser.add_argument("--search", help="Semantic search query")
    parser.add_argument("--list", action="store_true", help="List recent memories")
    parser.add_argument("--limit", type=int, default=5, help="Result limit")
    args = parser.parse_args()

    if args.file:
        cmd_add_from_file(args.file)
    elif args.content:
        tags = [t.strip() for t in args.tags.split(",") if t.strip()]
        cmd_add(args.content, tags)
    elif args.search:
        cmd_search(args.search, args.limit)
    elif args.list:
        cmd_list(args.limit)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
