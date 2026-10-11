#!/usr/bin/env node

/**
 * Extract panel layout from a Grafana dashboard for Better Stack import
 *
 * Usage:
 *   node extract-layout.js --dashboard 1860
 *   node extract-layout.js --dashboard 1860 --format json
 *   node extract-layout.js --file /tmp/blobs/abc123.txt
 *   node extract-layout.js --file /tmp/blobs/abc123.txt --format json
 */

import fs from "fs";
const GRAFANA_API = "https://grafana.com/api/dashboards";

function parseArgs(args) {
  const result = {
    dashboard: null,
    file: null,
    revision: null,
    format: "text",
    summary: false,
    section: null,     // Range like "1-3" or single number "2"
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dashboard" || args[i] === "-d") result.dashboard = args[++i];
    else if (args[i] === "--file" || args[i] === "-F") result.file = args[++i];
    else if (args[i] === "--revision" || args[i] === "-r")
      result.revision = parseInt(args[++i], 10);
    else if (args[i] === "--format" || args[i] === "-f") result.format = args[++i];
    else if (args[i] === "--summary" || args[i] === "-s") result.summary = true;
    else if (args[i] === "--section" || args[i] === "-S") result.section = args[++i];
    else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`Usage: node extract-layout.js --dashboard <id> [options]`);
      console.log(`       node extract-layout.js --file <path> [options]`);
      console.log(`\nOptions:`);
      console.log(`  --summary, -s          Show only section names and panel counts`);
      console.log(`  --section, -S <range>  Filter to section(s), e.g. "1", "2-4"`);
      console.log(`  --format, -f <fmt>     Output format: text (default) or json`);
      process.exit(0);
    }
  }
  return result;
}

async function fetchDashboard(id, revision) {
  if (!revision) {
    const info = await fetch(`${GRAFANA_API}/${id}`).then((r) => r.json());
    revision = info.revision || 1;
    console.error(`Using revision: ${revision}`);
  }
  return fetch(`${GRAFANA_API}/${id}/revisions/${revision}/download`).then((r) => r.json());
}

const TYPE_MAP = {
  graph: "line_chart",
  timeseries: "line_chart",
  singlestat: "number_chart",
  stat: "number_chart",
  gauge: "gauge_chart",
  bargauge: "gauge_chart",
  table: "table_chart",
  "table-old": "table_chart",
  barchart: "bar_chart",
  piechart: "pie_chart",
  heatmap: "heatmap_chart",
};

const SKIP_TYPES = new Set([
  "text", "row", "news", "dashlist", "alertlist", "annolist",
  "logs", "nodeGraph", "traces", "flamegraph", "canvas", "geomap",
]);

const UNIT_MAP = {
  bytes: "B_si",
  decbytes: "B_si",
  Bps: "B_si",
  binBps: "B_si",
  KBs: "B_si",
  MBs: "B_si",
  bps: "bps",
  binbps: "bps",
  s: "s",
  dtdurations: "s",
  ms: "ms",
  dtdurationms: "ms",
  us: "μs",
  ns: "ns",
  m: "m",
  h: "h",
  d: "d",
  percent: "percent",
  percentunit: "percent",
  short: "shortened",
  none: "shortened",
  locale: "shortened",
  ops: "e/s",
  iops: "e/s",
  reqps: "rps",
  rps: "rps",
  wps: "e/s",
  eps: "e/s",
  cps: "e/s",
  hertz: "e/s",
  pps: "e/s",
};

/**
 * Extract targets from a panel — handles both PromQL and CloudWatch
 */
function extractTargets(panel) {
  const targets = [];
  for (const t of panel.targets || []) {
    if (t.hide) continue;

    // Detect datasource type
    const dsType = t.datasource?.type || panel.datasource?.type || "";

    if (dsType === "cloudwatch" || t.namespace) {
      // CloudWatch target
      const dims = t.dimensions || {};
      const dimStr = Object.entries(dims)
        .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : v}`)
        .join(", ");
      const stats = Array.isArray(t.statistics) ? t.statistics : [t.statistic || "Average"];

      if (t.expression) {
        // Metric math expression
        targets.push({
          type: "cloudwatch_math",
          display: `CW Math: ${t.expression}`,
          refId: t.refId || "",
          id: t.id || "",
        });
      } else if (t.metricName) {
        targets.push({
          type: "cloudwatch",
          namespace: t.namespace || "",
          metricName: t.metricName || "",
          statistics: stats,
          dimensions: dims,
          display: `CW: ${t.namespace || "?"}.${t.metricName || "?"} [${stats.join(",")}]${dimStr ? ` dims: ${dimStr}` : ""}`,
          refId: t.refId || "",
          id: t.id || "",
          period: t.period || "",
          matchExact: t.matchExact,
          alias: t.alias || "",
        });
      } else if (t.sqlExpression) {
        // CloudWatch Metric Insights (SQL mode)
        targets.push({
          type: "cloudwatch_sql",
          display: `CW SQL: ${t.sqlExpression}`,
          refId: t.refId || "",
        });
      }
    } else {
      // PromQL target (default)
      const expr = (t.expr || "").replace(/\s+/g, " ").trim();
      if (expr) {
        targets.push({
          type: "promql",
          expr,
          legendFormat: t.legendFormat || "",
          refId: t.refId || "",
          instant: t.instant || false,
          display: expr,
        });
      }
    }
  }
  return targets;
}

/**
 * Get draw style and stacking info from panel config
 */
function getDisplayInfo(panel) {
  const custom = panel.fieldConfig?.defaults?.custom || {};
  const drawStyle = custom.drawStyle || "";
  const stackMode = custom.stacking?.mode || "";
  const fillOpacity = custom.fillOpacity || 0;

  // Legacy graph panel
  if (panel.type === "graph") {
    return {
      drawStyle: panel.bars ? "bars" : "line",
      stacking: panel.stack ? "stack" : "",
      fill: panel.fill || 0,
    };
  }

  return {
    drawStyle,
    stacking: stackMode === "normal" || stackMode === "percent" ? "stack" : "",
    fill: fillOpacity,
  };
}

/**
 * Get stat panel reduce options
 */
function getReduceCalc(panel) {
  const calcs = panel.options?.reduceOptions?.calcs || [];
  return calcs[0] || "";
}

function extractPanel(panel, section = "") {
  if (SKIP_TYPES.has(panel.type)) return null;
  const mappedType = TYPE_MAP[panel.type];
  if (!mappedType) return { skipped: true, type: panel.type, title: panel.title || "" };

  const g = panel.gridPos || { x: 0, y: 0, w: 12, h: 8 };
  const unit = panel.fieldConfig?.defaults?.unit || panel.format || "";
  const displayInfo = getDisplayInfo(panel);
  const targets = extractTargets(panel);

  // Skip panels with no targets
  if (targets.length === 0) {
    return { skipped: true, type: panel.type, title: panel.title || "", reason: "no targets" };
  }

  // Determine final chart type
  let finalType = mappedType;
  let grafanaType = panel.type;
  if (panel.type === "timeseries" && displayInfo.drawStyle === "bars") {
    finalType = "bar_chart";
    grafanaType = "timeseries:bars";
  } else if ((panel.type === "timeseries" || panel.type === "graph") && displayInfo.stacking) {
    grafanaType = `${panel.type}:stacked`;
  }

  // Extract settings
  const settings = {};
  if (displayInfo.stacking) settings.stacking = "stack";

  // Decimals
  const decimals = panel.fieldConfig?.defaults?.decimals;
  if (decimals !== undefined) settings.decimal_places = decimals;

  // Y-axis
  const min = panel.fieldConfig?.defaults?.min;
  const max = panel.fieldConfig?.defaults?.max;
  if (min !== undefined && min !== null) settings.y_axis_min = min;
  if (max !== undefined && max !== null) settings.y_axis_max = max;

  // Legend
  const legendOpts = panel.options?.legend || {};
  if (legendOpts.displayMode === "hidden" || legendOpts.showLegend === false) {
    settings.legend = "hidden";
  } else if (legendOpts.placement === "right") {
    settings.legend = "shown_right";
  }

  // Stat panel calc
  const reduceCalc = getReduceCalc(panel);
  if (reduceCalc) settings.reduceCalc = reduceCalc;

  const mappedUnit = UNIT_MAP[unit] || unit || "";
  if (mappedUnit) settings.unit = mappedUnit;

  // Note percent vs percentunit for the user
  let unitNote = "";
  if (unit === "percent") unitNote = " (0-100 input, divide by 100 for BS)";
  else if (unit === "percentunit") unitNote = " (0-1 input, maps directly)";

  return {
    s: section,
    t: panel.title || "",
    type: finalType,
    grafanaType,
    unit: mappedUnit,
    unitRaw: unit,
    unitNote,
    settings,
    x: Math.floor(g.x / 2),
    y: g.y,
    w: Math.max(Math.floor(g.w / 2), 1),
    h: Math.max(g.h, 3),
    targets,
  };
}

/**
 * Handle legacy row-based dashboards (schemaVersion < 22)
 */
function extractFromRows(dashboard) {
  const results = [];
  for (const row of dashboard.rows || []) {
    const section = row.title || "";
    if (section) results.push({ section, y: 0 });
    for (const panel of row.panels || []) {
      // Legacy panels use span (12-col) instead of gridPos (24-col)
      if (!panel.gridPos && panel.span) {
        panel.gridPos = { x: 0, y: 0, w: panel.span * 2, h: panel.height ? parseInt(panel.height) : 8 };
      }
      const extracted = extractPanel(panel, section);
      if (extracted) results.push(extracted);
    }
  }
  return results;
}

function extractAll(dashboard) {
  // Handle legacy row-based format
  if (dashboard.rows && !dashboard.panels) {
    return extractFromRows(dashboard);
  }

  const results = [];
  const panels = [...(dashboard.panels || [])].sort(
    (a, b) => (a.gridPos?.y || 0) - (b.gridPos?.y || 0) || (a.gridPos?.x || 0) - (b.gridPos?.x || 0)
  );

  let section = "";
  for (const p of panels) {
    if (p.type === "row") {
      section = p.title || "";
      results.push({ section, y: p.gridPos?.y || 0 });
      // Collapsed rows have nested panels
      for (const nested of p.panels || []) {
        const extracted = extractPanel(nested, section);
        if (extracted) results.push(extracted);
      }
    } else {
      const extracted = extractPanel(p, section);
      if (extracted) results.push(extracted);
    }
  }
  return results;
}

/**
 * Extract template variables
 */
function extractVariables(dashboard) {
  const vars = [];
  for (const v of dashboard.templating?.list || []) {
    vars.push({
      name: v.name || "",
      type: v.type || "",
      query: typeof v.query === "string" ? v.query : v.query?.query || "",
      multi: v.multi || false,
      includeAll: v.includeAll || false,
    });
  }
  return vars;
}

function formatSettings(settings) {
  if (!settings || Object.keys(settings).length === 0) return "";
  const parts = [];
  if (settings.unit) parts.push(`unit: ${settings.unit}`);
  if (settings.decimal_places !== undefined) parts.push(`decimals: ${settings.decimal_places}`);
  if (settings.stacking) parts.push(`stacking: ${settings.stacking}`);
  if (settings.legend && settings.legend !== "shown_below") parts.push(`legend: ${settings.legend}`);
  if (settings.y_axis_min !== undefined) parts.push(`y_min: ${settings.y_axis_min}`);
  if (settings.y_axis_max !== undefined) parts.push(`y_max: ${settings.y_axis_max}`);
  if (settings.reduceCalc) parts.push(`calc: ${settings.reduceCalc}`);
  return parts.length > 0 ? ` {${parts.join(", ")}}` : "";
}

/**
 * Count panels per section from extracted items
 */
function countPanelsPerSection(items) {
  const sections = [];
  let current = { name: "(ungrouped)", panels: 0, skipped: 0, y: 0 };

  for (const item of items) {
    if (item.section !== undefined && !item.t) {
      // Only push ungrouped if it has panels
      if (current.panels > 0 || current.skipped > 0) {
        sections.push(current);
      }
      current = { name: item.section || "(unnamed)", panels: 0, skipped: 0, y: item.y };
    } else if (item.skipped) {
      current.skipped++;
    } else if (item.t) {
      current.panels++;
    }
  }
  // Push final section if it has panels
  if (current.panels > 0 || current.skipped > 0) {
    sections.push(current);
  }
  return sections;
}

/**
 * Filter items to only include specified sections by index
 */
function filterItems(items, args) {
  if (!args.section) return items;

  const sectionCounts = countPanelsPerSection(items);
  let sectionIndices = new Set();

  // Parse section range (1-indexed), e.g. "1", "2-4"
  const match = args.section.match(/^(\d+)(?:-(\d+))?$/);
  if (match) {
    const start = parseInt(match[1], 10) - 1; // Convert to 0-indexed
    const end = match[2] ? parseInt(match[2], 10) - 1 : start;
    for (let i = start; i <= end && i < sectionCounts.length; i++) {
      if (i >= 0) sectionIndices.add(i);
    }
  }

  // Build filtered items
  const filtered = [];
  let currentSectionIdx = -1;
  let includeCurrentSection = false;

  for (const item of items) {
    if (item.section !== undefined && !item.t) {
      currentSectionIdx++;
      includeCurrentSection = sectionIndices.has(currentSectionIdx);
      if (includeCurrentSection) {
        filtered.push(item);
      }
    } else if (includeCurrentSection) {
      filtered.push(item);
    }
  }

  return filtered;
}

function formatSummary(title, variables, items) {
  const sections = countPanelsPerSection(items);
  const totalPanels = sections.reduce((sum, s) => sum + s.panels, 0);
  const totalSkipped = sections.reduce((sum, s) => sum + s.skipped, 0);

  const lines = [
    `# ${title}`,
    `Total: ${sections.length} sections, ${totalPanels} panels, ${totalSkipped} skipped`,
    "",
  ];

  if (variables.length > 0) {
    lines.push("Variables: " + variables.map((v) => `$${v.name}`).join(", "));
    lines.push("");
  }

  lines.push("## Sections");
  sections.forEach((s, i) => {
    const skippedNote = s.skipped > 0 ? ` (+${s.skipped} skipped)` : "";
    lines.push(`${i + 1}. **${s.name}** — ${s.panels} panels${skippedNote}`);
  });

  lines.push("");
  lines.push("Use --section <n> or --section <start>-<end> to extract specific sections.");

  return lines.join("\n");
}

function formatText(title, variables, items) {
  const sectionCounts = countPanelsPerSection(items);
  const totalPanels = sectionCounts.reduce((sum, s) => sum + s.panels, 0);

  const lines = [`# ${title}`, `${sectionCounts.length} sections, ${totalPanels} panels`, ""];

  if (variables.length > 0) {
    lines.push("Template variables: " + variables.map((v) =>
      `$${v.name} (${v.type}${v.multi ? ", multi" : ""})`
    ).join(", "));
    lines.push("");
  }

  let sectionIdx = 0;
  for (const item of items) {
    if (item.section !== undefined && !item.t) {
      const sc = sectionCounts[sectionIdx] || { panels: 0, skipped: 0 };
      const skippedNote = sc.skipped > 0 ? `, ${sc.skipped} skipped` : "";
      lines.push(`\n## [${sectionIdx + 1}] ${item.section} (${sc.panels} panels${skippedNote}, y:${item.y})`);
      sectionIdx++;
      continue;
    }

    if (item.skipped) {
      const reason = item.reason ? ` — ${item.reason}` : "";
      lines.push(`- ~~${item.title || item.type}~~ | ${item.type} | SKIPPED${reason}`);
      continue;
    }

    const { t, type, grafanaType, unit, unitRaw, unitNote, x, y, w, h, targets, settings } = item;
    const unitDisplay = unit || unitRaw || "-";

    let typeDisplay = type;
    if (grafanaType && grafanaType !== type.replace("_chart", "")) {
      typeDisplay = `${type} (Grafana: ${grafanaType})`;
    }

    const settingsStr = formatSettings(settings);
    lines.push(`- **${t}** | ${typeDisplay} | ${unitDisplay}${unitNote || ""} | x:${x} y:${y} w:${w} h:${h}${settingsStr}`);

    for (const target of targets) {
      if (target.type === "promql") {
        lines.push(`  \`${target.display}\`${target.legendFormat ? ` → "${target.legendFormat}"` : ""}${target.instant ? " [instant]" : ""}`);
      } else {
        lines.push(`  ${target.display}`);
      }
    }
  }
  return lines.join("\n");
}

function formatJson(title, variables, items) {
  const sections = items.filter((i) => i.section !== undefined && !i.t);
  const panels = items.filter((i) => i.t && !i.skipped);
  const skipped = items.filter((i) => i.skipped);
  return JSON.stringify(
    { title, variables, sections: sections.length, panels: panels.length, skipped: skipped.length, items },
    null,
    2
  );
}

function loadFromFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw);

  // Grafana exports can wrap the dashboard under a "dashboard" key
  const dashboard = data.dashboard || data;

  // Verify it looks like a Grafana dashboard
  if (!dashboard.panels && !dashboard.rows) {
    throw new Error('Not a valid Grafana dashboard: missing "panels" or "rows"');
  }

  return dashboard;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dashboard && !args.file) {
    console.error("Error: --dashboard <id> or --file <path> required");
    process.exit(1);
  }

  let dashboard;
  if (args.file) {
    dashboard = loadFromFile(args.file);
    console.error(`Loaded dashboard from file: ${args.file}`);
  } else {
    dashboard = await fetchDashboard(args.dashboard, args.revision);
  }

  const variables = extractVariables(dashboard);
  const allItems = extractAll(dashboard);

  // Summary mode: just show section names and panel counts
  if (args.summary) {
    console.log(formatSummary(dashboard.title, variables, allItems));
    return;
  }

  // Apply section filtering
  const items = filterItems(allItems, args);

  if (items.length === 0 && args.section) {
    console.error(`No sections matched the filter. Use --summary to see available sections.`);
    process.exit(1);
  }

  console.log(
    args.format === "json" ? formatJson(dashboard.title, variables, items) : formatText(dashboard.title, variables, items)
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
