#!/usr/bin/env bun

/**
 * Bundle size measurement, history keeping, and PR reporting.
 *
 * `record` appends a snapshot of the built app to the history file that main
 * carries in a workflow artifact. `comment` measures the same way and renders
 * the markdown a pull request comment shows: a chart of that history with this
 * build as a single dot, and the tables behind it.
 *
 * The dot is a bar series squashed by `themeCSS`, with every bar before the
 * last one hidden. Mermaid line plots draw no point markers and every series
 * starts at the first category, so a lone marker has no other way to land on
 * the right category.
 */

import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const TARGETS = { spa: "App", widget: "Widget" } as const;

type Target = keyof typeof TARGETS;

interface Sizes {
  raw: number;
  gzip: number;
}

interface TargetSnapshot extends Sizes {
  files: Record<string, Sizes>;
}

interface Snapshot extends Sizes {
  date: string;
  sha: string;
  targets: Partial<Record<Target, TargetSnapshot>>;
}

interface History {
  snapshots: Snapshot[];
}

/** Snapshots the chart plots before the dot, oldest first. */
const CHART_POINTS = 12;

/** Snapshots the history file keeps. */
const HISTORY_LIMIT = 200;

/** Files the visible table lists before the rest fold into a details block. */
const TABLE_ROWS = 15;

const CHART_WIDTH = 820;
const CHART_HEIGHT = 280;
const DOT_SIZE = 12;

const TREND_COLOR = "#8b949e";
const DOT_COLOR = "#2f81f7";

const MARKER = "<!-- bundle-size -->";

/** Strips the Vite content hash so a file compares against itself across builds. */
function stripHash(name: string): string {
  return name.replace(/-[A-Za-z0-9_-]{8}\./, ".");
}

function formatBytes(bytes: number): string {
  if (Math.abs(bytes) >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (Math.abs(bytes) >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** Renders a change as a signed size, or an empty cell when nothing moved. */
function formatDelta(current: number, before?: number): string {
  if (before === undefined || current === before) return "";
  const diff = current - before;
  return `${diff > 0 ? "+" : "-"}${formatBytes(Math.abs(diff))}`;
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function measureTarget(dir: string): TargetSnapshot {
  const files: Record<string, Sizes> = {};
  let raw = 0;
  let gzip = 0;
  for (const file of walk(dir).sort()) {
    const content = readFileSync(file);
    const size = { raw: content.length, gzip: gzipSync(content).length };
    files[stripHash(file.slice(dir.length + 1))] = size;
    raw += size.raw;
    gzip += size.gzip;
  }
  return { raw, gzip, files };
}

/** Measures every build target present under `dist`. */
function measure(dist: string): Omit<Snapshot, "date" | "sha"> {
  const targets: Partial<Record<Target, TargetSnapshot>> = {};
  let raw = 0;
  let gzip = 0;
  for (const target of Object.keys(TARGETS) as Target[]) {
    const dir = join(dist, target);
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
    const measured = measureTarget(dir);
    targets[target] = measured;
    raw += measured.raw;
    gzip += measured.gzip;
  }
  if (Object.keys(targets).length === 0) {
    throw new Error(`no build targets found under ${dist}`);
  }
  return { raw, gzip, targets };
}

function readHistory(path: string): History {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as History;
    return { snapshots: parsed.snapshots ?? [] };
  } catch {
    return { snapshots: [] };
  }
}

function writeHistory(path: string, history: History): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(history, null, 2)}\n`);
}

function headSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function commitDate(sha: string): string {
  try {
    return execFileSync("git", ["show", "-s", "--format=%cI", sha], { encoding: "utf8" }).trim();
  } catch {
    return new Date().toISOString();
  }
}

/** Formats a snapshot timestamp as the `MM-DD` the chart puts under a point. */
function axisLabel(date: string): string {
  return date.slice(5, 10);
}

interface ChartScale {
  divisor: number;
  unit: string;
  decimals: number;
}

function chartScale(max: number): ChartScale {
  if (max >= 1024 * 1024) return { divisor: 1024 * 1024, unit: "MB", decimals: 2 };
  return { divisor: 1024, unit: "KB", decimals: 1 };
}

/**
 * Width mermaid gives a bar, which the dot is squashed down from.
 *
 * Mermaid sizes a bar at 0.62 of the distance between two ticks, and the plot
 * area is the chart minus the room the y-axis labels take.
 */
function barWidth(categories: number): number {
  return 0.62 * ((CHART_WIDTH - 75) / categories);
}

/**
 * Builds the mermaid chart, trend line first and this build as the dot.
 *
 * The line stops one category short of the dot on purpose. A pull request is a
 * proposal, not a point on the branch history the line draws.
 */
function chart(history: Snapshot[], current: number): string {
  const values = [...history.map((snapshot) => snapshot.gzip), current];
  const scale = chartScale(Math.max(...values));
  const scaled = values.map((value) => value / scale.divisor);
  const span = Math.max(...scaled) - Math.min(...scaled);
  const padding = Math.max(span * 0.25, Math.max(...scaled) * 0.02);
  const low = Math.max(0, Math.min(...scaled) - padding);
  const high = Math.max(...scaled) + padding;

  const categories = [...history.map((snapshot) => axisLabel(snapshot.date)), "PR"];
  const squash = (DOT_SIZE / barWidth(categories.length)).toFixed(3);

  const css = [
    `.bar-plot-1 rect { display: none }`,
    `.bar-plot-1 rect:last-of-type { display: block; height: ${DOT_SIZE}px; rx: 50%; ry: 50%;`,
    ` transform-box: fill-box; transform-origin: center; transform: scaleX(${squash}) }`,
  ].join("");

  const init = {
    themeCSS: css,
    themeVariables: { xyChart: { plotColorPalette: `${TREND_COLOR}, ${DOT_COLOR}` } },
    xyChart: { width: CHART_WIDTH, height: CHART_HEIGHT },
  };

  const point = (value: number) => value.toFixed(scale.decimals);
  const trend = scaled.slice(0, -1).map(point);
  const dot = [...trend.map(() => point(low)), point(scaled[scaled.length - 1]!)];

  return [
    "```mermaid",
    `%%{init: ${JSON.stringify(init)}}%%`,
    "xychart-beta",
    `    title "Served bundle size, gzip"`,
    `    x-axis [${categories.map((label) => `"${label}"`).join(", ")}]`,
    `    y-axis "${scale.unit}" ${point(low)} --> ${point(high)}`,
    `    line [${trend.join(", ")}]`,
    `    bar [${dot.join(", ")}]`,
    "```",
  ].join("\n");
}

function repoUrl(): string {
  const slug = process.env.GITHUB_REPOSITORY ?? "paritytech/browse";
  return `https://github.com/${slug}`;
}

function fileRows(current: TargetSnapshot, before?: TargetSnapshot): string[] {
  const names = new Set([...Object.keys(current.files), ...Object.keys(before?.files ?? {})]);
  return [...names]
    .map((name) => ({ name, size: current.files[name], was: before?.files[name] }))
    .sort((a, b) => (b.size?.gzip ?? 0) - (a.size?.gzip ?? 0))
    .map(({ name, size, was }) => {
      if (!size) return `| \`${name}\` | | removed | ${formatDelta(0, was?.gzip)} |`;
      return `| \`${name}\` | ${formatBytes(size.raw)} | ${formatBytes(size.gzip)} | ${formatDelta(size.gzip, was?.gzip)} |`;
    });
}

function filesSection(current: Snapshot, before?: Snapshot): string[] {
  const lines: string[] = [];
  for (const [target, title] of Object.entries(TARGETS) as [Target, string][]) {
    const measured = current.targets[target];
    if (!measured) continue;
    const rows = fileRows(measured, before?.targets[target]);
    const head = ["| File | Raw | Gzip | Change |", "| --- | ---: | ---: | ---: |"];
    lines.push(`#### ${title}`, "", ...head, ...rows.slice(0, TABLE_ROWS));
    if (rows.length > TABLE_ROWS) {
      lines.push(
        "",
        "<details>",
        `<summary>The remaining ${rows.length - TABLE_ROWS} files</summary>`,
        "",
        ...head,
        ...rows.slice(TABLE_ROWS),
        "",
        "</details>",
      );
    }
    lines.push("");
  }
  return lines;
}

function totalsTable(current: Snapshot, before?: Snapshot): string[] {
  const rows = (Object.entries(TARGETS) as [Target, string][])
    .filter(([target]) => current.targets[target])
    .map(([target, title]) => {
      const measured = current.targets[target]!;
      const was = before?.targets[target];
      return `| ${title} | ${formatBytes(measured.raw)} | ${formatBytes(measured.gzip)} | ${formatDelta(measured.gzip, was?.gzip)} |`;
    });
  return [
    "| Target | Raw | Gzip | Change |",
    "| --- | ---: | ---: | ---: |",
    ...rows,
    `| **Total** | **${formatBytes(current.raw)}** | **${formatBytes(current.gzip)}** | **${formatDelta(current.gzip, before?.gzip)}** |`,
  ];
}

function summaryLine(current: Snapshot, before?: Snapshot): string {
  const total = formatBytes(current.gzip);
  if (!before) return `This build serves ${total} gzipped. There is no snapshot of main to compare against yet.`;
  const diff = current.gzip - before.gzip;
  const link = `[\`${before.sha.slice(0, 7)}\`](${repoUrl()}/commit/${before.sha})`;
  if (diff === 0) return `This build serves ${total} gzipped, the same as main at ${link}.`;
  const change = `${formatBytes(Math.abs(diff))} ${diff > 0 ? "more" : "less"}`;
  const percent = ((Math.abs(diff) / before.gzip) * 100).toFixed(1);
  return `This build serves ${total} gzipped, ${change} than main at ${link}. That is ${percent}% ${diff > 0 ? "up" : "down"}.`;
}

function renderComment(current: Snapshot, history: Snapshot[]): string {
  const before = history[history.length - 1];
  const plotted = history.slice(-CHART_POINTS);
  const lines = [MARKER, "### Bundle size", ""];
  if (plotted.length > 0) lines.push(chart(plotted, current.gzip), "");
  lines.push(summaryLine(current, before), "");
  lines.push(...totalsTable(current, before), "");
  lines.push(...filesSection(current, before));
  return `${lines.join("\n").trimEnd()}\n`;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) args[match[1]!] = match[2]!;
  }
  return args;
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const dist = args.dist ?? "app/dist";
  const historyPath = args.history ?? ".bundle-size/history.json";
  const history = readHistory(historyPath);
  const sha = args.sha ?? headSha();
  const snapshot: Snapshot = { date: args.date ?? commitDate(sha), sha, ...measure(dist) };

  if (command === "record") {
    const snapshots = history.snapshots.filter((entry) => entry.sha !== snapshot.sha);
    snapshots.push(snapshot);
    snapshots.sort((a, b) => a.date.localeCompare(b.date));
    writeHistory(historyPath, { snapshots: snapshots.slice(-HISTORY_LIMIT) });
    console.log(`recorded ${formatBytes(snapshot.gzip)} gzip at ${snapshot.sha.slice(0, 7)}`);
    return;
  }

  if (command === "comment") {
    const out = args.out ?? "bundle-size-comment.md";
    writeFileSync(out, renderComment(snapshot, history.snapshots));
    console.log(`wrote ${out}`);
    return;
  }

  console.error("usage: bundle-size.ts <record|comment> [--dist=dir] [--history=file] [--out=file]");
  process.exit(1);
}

main();
