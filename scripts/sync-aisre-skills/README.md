# Sync skills from aisre-proxy

The skills in `skills/` (all but `investigate-incident`, which is maintained here) are built from the AI SRE agent's skills in [`BetterStackHQ/aisre-proxy`](https://github.com/BetterStackHQ/aisre-proxy/tree/main/.claude/skills). AI SRE runs them against its own tools; this plugin runs them against the public Better Stack MCP server (`mcp.betterstack.com`), so the build:

1. copies the skills listed in `skills.txt`,
2. renames AI SRE tool names to the public MCP's (`map.tsv`, e.g. `execute_query` → `query`, `get_source_details` → `source`),
3. applies `edits.py`: the passages that only make sense inside AI SRE (research blocks, inline-chart rendering, resource-link syntax, tools the public MCP doesn't have) and the note on how ad-hoc queries differ from dashboard queries.

```bash
scripts/sync-aisre-skills/port.sh ../aisre-proxy/.claude/skills skills
```

`edits.py` asserts that every passage it rewrites is still there, so when a skill changes upstream the build stops at that passage instead of shipping a half-adapted skill. Update the edit, run it again, and review the diff.

Skills not synced: `investigation-methodology` (its public counterpart is `investigate-incident`), `report` (AI SRE's downloadable reports) and `funnel-charts` (the public MCP can't create explorations yet).
