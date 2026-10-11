#!/usr/bin/env node

/**
 * Extract widget layout from a Datadog dashboard JSON export for Better Stack import
 *
 * Usage:
 *   node extract-layout.js --file datadog_dashboards/System\ -\ Metrics.json
 *   node extract-layout.js --file datadog_dashboards/AWS\ Lambda.json --format json
 */

import fs from "fs";
import path from "path";

function parseArgs(args) {
  const result = { file: null, format: "text" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" || args[i] === "-f") result.file = args[++i];
    else if (args[i] === "--format") result.format = args[++i];
    else if (args[i] === "--help" || args[i] === "-h") {
      console.log("Usage: node extract-layout.js --file <path-to-json> [--format json]");
      process.exit(0);
    }
  }
  return result;
}

// Map Datadog widget types to Better Stack chart types
const TYPE_MAP = {
  timeseries: "line_chart",
  query_value: "number_chart",
  toplist: "bar_chart",
  query_table: "table_chart",
  treemap: "pie_chart",
  sunburst: "pie_chart",
  heatmap: "heatmap_chart",
  change: "number_chart",
  distribution: "bar_chart",
};

// Map Datadog units/custom_units to Better Stack unit values
const UNIT_MAP = {
  // Percentage
  percent: "percent",
  "%": "percent",
  // Data size
  byte: "B_si",
  bytes: "B_si",
  kibibyte: "B_iec",
  mebibyte: "B_iec",
  gibibyte: "B_iec",
  kilobyte: "B_si",
  megabyte: "B_si",
  gigabyte: "B_si",
  terabyte: "B_si",
  // Duration
  second: "s",
  sec: "s",
  secs: "s",
  s: "s",
  millisecond: "ms",
  ms: "ms",
  microsecond: "μs",
  us: "μs",
  μs: "μs",
  nanosecond: "ns",
  ns: "ns",
  minute: "m",
  min: "m",
  hour: "h",
  hr: "h",
  day: "d",
  // Rates
  operation: "e/s",
  ops: "e/s",
  request: "rps",
  req: "rps",
  connection: "shortened",
  error: "shortened",
  query: "shortened",
  hit: "shortened",
  record: "shortened",
  page: "shortened",
};

// Widget types to skip entirely
const SKIP_TYPES = new Set([
  "note",
  "image",
  "check_status",
  "manage_status",
  "list_stream",
  "hostmap",
  "embedded_app",
  "event_timeline",
  "event_stream",
  "free_text",
]);

// Non-metrics data sources to warn about
const NON_METRICS_SOURCES = new Set([
  "logs",
  "events",
  "network",
  "database_recommendations_stream",
  "logs_pattern_stream",
  "event_stream",
]);

/**
 * Parse a Datadog metric query string into structured components.
 * Format: aggregation:metric.name{filters} by {tag1, tag2}.modifier()
 */
function parseQuery(queryStr) {
  if (!queryStr || typeof queryStr !== "string") return null;

  const result = {
    raw: queryStr,
    aggregation: "avg",
    metric: "",
    filters: "",
    groupBy: [],
    modifiers: [],
  };

  let q = queryStr.trim();

  // Extract modifiers (.as_count(), .as_rate(), .fill(), .rollup())
  const modRegex = /\.(as_count|as_rate|fill|rollup)\(([^)]*)\)/g;
  let match;
  while ((match = modRegex.exec(q)) !== null) {
    result.modifiers.push({ name: match[1], args: match[2] });
  }
  q = q.replace(modRegex, "");

  // Extract group-by: " by {tag1,tag2}"
  const byMatch = q.match(/\s+by\s*\{([^}]+)\}/);
  if (byMatch) {
    result.groupBy = byMatch[1].split(",").map((t) => t.trim());
    q = q.replace(byMatch[0], "");
  }

  // Extract aggregation prefix: "avg:", "sum:", "max:", "min:"
  const aggMatch = q.match(/^(avg|sum|max|min):/);
  if (aggMatch) {
    result.aggregation = aggMatch[1];
    q = q.substring(aggMatch[0].length);
  }

  // Extract metric name and filters: "metric.name{filters}"
  const metricMatch = q.match(/^([a-zA-Z0-9_.]+)\{([^}]*)\}/);
  if (metricMatch) {
    result.metric = metricMatch[1];
    result.filters = metricMatch[2];
  } else {
    // Fallback: just the metric name without filters
    result.metric = q.replace(/\{.*\}/, "").trim();
    const fMatch = q.match(/\{([^}]*)\}/);
    if (fMatch) result.filters = fMatch[1];
  }

  return result;
}

/**
 * Extract queries and formulas from a widget's requests array.
 * Disambiguates duplicate query names across requests by appending a suffix.
 * Also extracts response_format to determine if queries need time dimension.
 */
function extractQueries(requests) {
  const queries = [];
  const formulas = [];
  const warnings = [];
  let responseFormat = "";

  if (!requests || !Array.isArray(requests)) return { queries, formulas, warnings, responseFormat };

  // Track seen query names to disambiguate duplicates
  const nameCount = new Map();

  for (const req of requests) {
    // Capture response_format (scalar vs timeseries)
    if (req.response_format && !responseFormat) {
      responseFormat = req.response_format;
    }

    // Check for non-metrics data sources
    if (req.queries) {
      for (const q of req.queries) {
        if (q.data_source && NON_METRICS_SOURCES.has(q.data_source)) {
          warnings.push(`Non-metrics data source: ${q.data_source} (skip)`);
          continue;
        }
        if (q.data_source === "metrics" && q.query) {
          const parsed = parseQuery(q.query);
          let name = q.name || "";

          // Disambiguate duplicate names: query1 → query1, query1_2, query1_3
          if (name) {
            const count = (nameCount.get(name) || 0) + 1;
            nameCount.set(name, count);
            if (count > 1) {
              name = `${name}_${count}`;
            }
          }

          queries.push({
            name,
            raw: q.query,
            parsed,
            aggregator: q.aggregator || "",
          });
        }
      }
    }

    // Handle legacy format where query is directly on the request
    if (req.q && typeof req.q === "string") {
      const parsed = parseQuery(req.q);
      queries.push({ name: "", raw: req.q, parsed, aggregator: "" });
    }

    // Extract formulas
    if (req.formulas) {
      for (const f of req.formulas) {
        if (f.formula) {
          formulas.push({ formula: f.formula, alias: f.alias || "" });
        }
      }
    }

    // Extract sort info for toplists
    if (req.sort) {
      const sortInfo = req.sort;
      if (sortInfo.order_by && sortInfo.order_by.length > 0) {
        const ob = sortInfo.order_by[0];
        formulas.push({ sort: true, order: ob.order || "desc", count: sortInfo.count || 10 });
      }
    }
  }

  return { queries, formulas, warnings, responseFormat };
}

/**
 * Detect display style (line, bars, area) from requests.
 * Checks all requests — if any use 'area', the chart should be stacked.
 */
function getDisplayType(requests) {
  if (!requests) return "";
  let hasArea = false;
  let hasBars = false;
  for (const req of requests) {
    if (req.display_type === "bars") hasBars = true;
    if (req.display_type === "area") hasArea = true;
  }
  // bars takes priority (it changes chart_type), area only sets stacking
  if (hasBars) return "bars";
  if (hasArea) return "area";
  return "";
}

/**
 * Map a Datadog unit string to a Better Stack unit value.
 * Returns { unit, unitRaw } where unit is the mapped value and unitRaw is the original.
 */
function mapUnit(ddUnit) {
  if (!ddUnit) return { unit: "", unitRaw: "" };
  const raw = ddUnit.trim();
  const mapped = UNIT_MAP[raw.toLowerCase()] || "";
  return { unit: mapped, unitRaw: raw };
}

/**
 * Extract unit from widget definition — checks custom_unit, yaxis.units
 */
function getUnit(def) {
  if (def.custom_unit) return mapUnit(def.custom_unit);
  if (def.yaxis && def.yaxis.units) return mapUnit(def.yaxis.units);
  return { unit: "", unitRaw: "" };
}

/**
 * Extract Better Stack chart settings from a Datadog widget definition.
 * Maps: precision, yaxis (scale, min, max, include_zero), legend, stacking.
 */
function extractSettings(def, displayType) {
  const settings = {};

  // decimal_places from Datadog precision
  if (def.precision !== undefined && def.precision !== null) {
    settings.decimal_places = def.precision;
  }

  // y-axis configuration
  if (def.yaxis) {
    const yaxis = def.yaxis;
    if (yaxis.scale === "log") {
      settings.y_axis_scale = "log";
    }
    if (yaxis.include_zero === true) {
      settings.y_axis_min = 0;
    }
    // Explicit min/max (Datadog uses "auto" string or numeric)
    if (yaxis.min !== undefined && yaxis.min !== "auto" && yaxis.min !== "") {
      const val = Number(yaxis.min);
      if (!isNaN(val)) settings.y_axis_min = val;
    }
    if (yaxis.max !== undefined && yaxis.max !== "auto" && yaxis.max !== "") {
      const val = Number(yaxis.max);
      if (!isNaN(val)) settings.y_axis_max = val;
    }
  }

  // Legend configuration
  // Datadog: show_legend (bool), legend_layout ("auto"|"vertical"|"horizontal")
  if (def.show_legend === false) {
    settings.legend = "hidden";
  } else if (def.legend_layout === "vertical") {
    settings.legend = "shown_right";
  } else {
    settings.legend = "shown_below";
  }

  // Stacking from display_type
  if (displayType === "area") {
    settings.stacking = "stack";
  }

  return settings;
}

/**
 * Process a single widget into our internal format
 */
function extractWidget(def, layout, section) {
  if (!def) return null;

  const type = def.type;
  if (SKIP_TYPES.has(type))
    return { skipped: true, type, title: def.title || def.content?.substring(0, 40) || "" };

  const mappedType = TYPE_MAP[type];
  if (!mappedType) return { skipped: true, type, title: def.title || "" };

  const displayType = getDisplayType(def.requests);

  // Override type for timeseries with bars display
  let finalType = mappedType;
  let datadogType = type; // Keep original Datadog type for reference
  if (type === "timeseries" && displayType === "bars") {
    finalType = "bar_chart";
    datadogType = "timeseries:bars";
  } else if (type === "timeseries" && displayType === "area") {
    datadogType = "timeseries:area";
  }

  const { unit, unitRaw } = getUnit(def);

  const { queries, formulas, warnings, responseFormat } = extractQueries(def.requests);

  // Skip widgets with only non-metrics queries
  if (queries.length === 0 && warnings.length > 0) {
    return { skipped: true, type, title: def.title || "", reason: warnings.join("; ") };
  }

  // Extract all Better Stack-relevant settings
  const settings = extractSettings(def, displayType);
  if (unit) settings.unit = unit;

  return {
    s: section,
    t: def.title || "",
    type: finalType,
    datadogType, // Original Datadog type for reference
    responseFormat, // 'scalar' or 'timeseries' - critical for determining if {{time}} is needed
    unit,
    unitRaw,
    settings,
    x: layout.x,
    y: layout.y,
    w: layout.w,
    h: layout.h,
    q: queries,
    f: formulas.filter((f) => !f.sort),
    sort: formulas.find((f) => f.sort) || null,
    warnings,
  };
}

/**
 * Convert free-layout absolute coords to a 12-column grid
 */
function freeToGrid(widgets) {
  if (widgets.length === 0) return [];

  // Find the extent of the dashboard
  let maxRight = 0;
  for (const w of widgets) {
    const layout = w.layout || {};
    const right = (layout.x || 0) + (layout.width || 0);
    if (right > maxRight) maxRight = right;
  }

  const scale = maxRight > 0 ? 12 / maxRight : 1;

  return widgets.map((w) => {
    const layout = w.layout || {};
    return {
      ...w,
      _grid: {
        x: Math.round((layout.x || 0) * scale),
        y: layout.y || 0,
        w: Math.max(Math.round((layout.width || 12) * scale), 1),
        h: Math.max(Math.round((layout.height || 8) * (3 / 8)), 3), // scale height down
      },
    };
  });
}

/**
 * Process ordered layout dashboard
 */
function processOrdered(dashboard) {
  const results = [];
  const widgets = dashboard.widgets || [];

  for (const widget of widgets) {
    const def = widget.definition;
    if (!def) continue;

    // Group widget → section with nested widgets
    if (def.type === "group") {
      const sectionTitle = def.title || "";
      const outerLayout = widget.layout || { x: 0, y: 0, width: 12, height: 4 };
      results.push({ section: sectionTitle, y: outerLayout.y || 0 });

      const nested = def.widgets || [];
      for (const nw of nested) {
        const nDef = nw.definition;
        const nLayout = nw.layout || { x: 0, y: 0, width: 12, height: 3 };
        const gridLayout = {
          x: nLayout.x || 0,
          y: (outerLayout.y || 0) + (nLayout.y || 0),
          w: nLayout.width || 12,
          h: Math.max(nLayout.height || 3, 3),
        };
        const extracted = extractWidget(nDef, gridLayout, sectionTitle);
        if (extracted) results.push(extracted);
      }
    } else {
      const layout = widget.layout || { x: 0, y: 0, width: 12, height: 3 };
      const gridLayout = {
        x: layout.x || 0,
        y: layout.y || 0,
        w: layout.width || 12,
        h: Math.max(layout.height || 3, 3),
      };
      const extracted = extractWidget(def, gridLayout, "");
      if (extracted) results.push(extracted);
    }
  }

  return results;
}

/**
 * Process free layout dashboard
 */
function processFree(dashboard) {
  const results = [];
  const widgets = dashboard.widgets || [];

  // Convert absolute coords to 12-col grid
  const gridded = freeToGrid(widgets);

  // Sort by y then x
  gridded.sort((a, b) => a._grid.y - b._grid.y || a._grid.x - b._grid.x);

  // Try to detect section headers from note widgets
  // Notes with background_color at a certain y-level that span wide → section
  const sectionNotes = new Map();
  for (const w of gridded) {
    const def = w.definition;
    if (
      def &&
      def.type === "note" &&
      def.background_color &&
      def.background_color !== "white" &&
      def.background_color !== "gray"
    ) {
      const content = (def.content || "").replace(/[#*\n]/g, "").trim();
      if (content.length < 50) {
        sectionNotes.set(w._grid.y, content);
      }
    }
  }

  let currentSection = "";
  for (const w of gridded) {
    const def = w.definition;
    if (!def) continue;

    // Check if this y-level has a section header
    if (sectionNotes.has(w._grid.y) && def.type === "note") {
      const newSection = sectionNotes.get(w._grid.y);
      if (newSection !== currentSection) {
        currentSection = newSection;
        results.push({ section: currentSection, y: w._grid.y });
      }
      continue; // Skip the note widget itself
    }

    const extracted = extractWidget(def, w._grid, currentSection);
    if (extracted) results.push(extracted);
  }

  return results;
}

/**
 * Format chart settings as a compact inline string for text output.
 * Only includes non-default values that affect Better Stack chart configuration.
 */
function formatSettings(settings) {
  if (!settings || Object.keys(settings).length === 0) return "";

  const parts = [];

  if (settings.unit) parts.push(`unit: ${settings.unit}`);
  if (settings.decimal_places !== undefined) parts.push(`decimals: ${settings.decimal_places}`);
  if (settings.stacking) parts.push(`stacking: ${settings.stacking}`);
  if (settings.legend && settings.legend !== "shown_below")
    parts.push(`legend: ${settings.legend}`);
  if (settings.y_axis_scale === "log") parts.push("y_axis_scale: log");
  if (settings.y_axis_min !== undefined) parts.push(`y_axis_min: ${settings.y_axis_min}`);
  if (settings.y_axis_max !== undefined) parts.push(`y_axis_max: ${settings.y_axis_max}`);

  return parts.length > 0 ? ` {${parts.join(", ")}}` : "";
}

/**
 * Format results as readable text
 */
function formatText(title, layoutType, templateVars, items) {
  const lines = [`# ${title}`, `Layout: ${layoutType}`, ""];

  if (templateVars.length > 0) {
    lines.push(
      "Template variables: " +
        templateVars
          .map((v) => `$${v.name}` + (v.prefix ? ` (prefix: ${v.prefix})` : ""))
          .join(", ")
    );
    lines.push("");
  }

  for (const item of items) {
    if (item.section !== undefined && !item.t) {
      lines.push(`\n## ${item.section} (y:${item.y})`);
      continue;
    }

    if (item.skipped) {
      const reason = item.reason ? ` — ${item.reason}` : "";
      lines.push(`- ~~${item.title || item.type}~~ | ${item.type} | SKIPPED${reason}`);
      continue;
    }

    const {
      t,
      type,
      datadogType,
      responseFormat,
      unit,
      unitRaw,
      settings,
      x,
      y,
      w,
      h,
      q,
      f,
      sort,
      warnings,
    } = item;
    const unitDisplay = unit || unitRaw || "-";
    const unmapped = unitRaw && !unit ? ` (unmapped: "${unitRaw}")` : "";

    // Show both Better Stack type and original Datadog type if different
    let typeDisplay = type;
    if (datadogType && datadogType !== type) {
      typeDisplay = `${type} (DD: ${datadogType})`;
    }

    // Add response_format indicator - CRITICAL for knowing if {{time}} is needed
    if (responseFormat) {
      typeDisplay += ` [${responseFormat}]`;
    }

    const settingsStr = formatSettings(settings);
    lines.push(
      `- **${t}** | ${typeDisplay} | ${unitDisplay}${unmapped} | x:${x} y:${y} w:${w} h:${h}${settingsStr}`
    );

    for (const query of q || []) {
      const p = query.parsed;
      if (p) {
        const mods =
          p.modifiers.length > 0
            ? " " + p.modifiers.map((m) => `.${m.name}(${m.args})`).join("")
            : "";
        const groupBy = p.groupBy.length > 0 ? ` by {${p.groupBy.join(", ")}}` : "";
        const agg = query.aggregator ? ` [aggregator: ${query.aggregator}]` : "";
        lines.push(
          `  ${query.name}: \`${p.aggregation}:${p.metric}{${p.filters}}${groupBy}${mods}\`${agg}`
        );
      } else {
        lines.push(`  ${query.name}: \`${query.raw}\``);
      }
    }

    for (const formula of f || []) {
      const alias = formula.alias ? ` → "${formula.alias}"` : "";
      lines.push(`  formula: \`${formula.formula}\`${alias}`);
    }

    if (sort) {
      lines.push(`  sort: ${sort.order}, limit: ${sort.count || "all"}`);
    }

    for (const w of warnings || []) {
      lines.push(`  ⚠️  ${w}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format results as JSON
 */
function formatJson(title, layoutType, templateVars, items) {
  const sections = items.filter((i) => i.section !== undefined && !i.t);
  const charts = items.filter((i) => i.t && !i.skipped);
  const skipped = items.filter((i) => i.skipped);

  return JSON.stringify(
    {
      title,
      layout_type: layoutType,
      template_variables: templateVars,
      sections: sections.length,
      charts: charts.length,
      skipped: skipped.length,
      items,
    },
    null,
    2
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error("Error: --file <path-to-json> required");
    process.exit(1);
  }

  const filePath = path.resolve(args.file);
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(`Error: Failed to parse JSON: ${e.message}`);
    process.exit(1);
  }

  // Datadog API exports may wrap the dashboard under a "dash" or "dashboard" key
  const dashboard = data.dash || data.dashboard || data;

  // Verify it looks like a Datadog dashboard
  if (!dashboard.widgets || !Array.isArray(dashboard.widgets)) {
    console.error('Error: Not a valid Datadog dashboard: missing "widgets" array');
    process.exit(1);
  }

  const layoutType = dashboard.layout_type || "ordered";
  const templateVars = dashboard.template_variables || [];

  let items;
  if (layoutType === "free") {
    items = processFree(dashboard);
  } else {
    items = processOrdered(dashboard);
  }

  console.log(
    args.format === "json"
      ? formatJson(dashboard.title, layoutType, templateVars, items)
      : formatText(dashboard.title, layoutType, templateVars, items)
  );
}

main();
