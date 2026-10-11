#!/usr/bin/env bash
# Builds the public plugin skills from aisre-proxy's .claude/skills: copy, rename AI SRE tool
# names to the public MCP's (map.tsv), then apply the hand edits (edits.py).
set -euo pipefail
src=$1 out=$2
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out"
for s in $(cat "$here/skills.txt"); do rm -rf "${out:?}/$s"; cp -r "$src/$s" "$out/"; done
args=(); while IFS=$'\t' read -r a b; do args+=(-e "s/\\b$a\\b/$b/g"); done < "$here/map.tsv"
for s in $(cat "$here/skills.txt"); do find "$out/$s" -name SKILL.md -exec sed -i "${args[@]}" {} +; done
sed -i -E 's/source_fields\(source_id, source_type: "metrics", name_filter: /metrics_schema(id: source_id, name_filter: /g; s/source_fields\(source_id, source_type: "metrics"\)/metrics_schema(id: source_id)/g; s/`source_fields` with `source_type: "metrics"`/`metrics_schema`/g' "$out"/*/SKILL.md
sed -i 's/`source_fields`/`metrics_schema`/g' "$out/datadog-import/SKILL.md" "$out/grafana-import/SKILL.md"
python3 "$here/edits.py" "$out"
