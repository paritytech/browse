#!/usr/bin/env bun

/**
 * Bundle size measurement, history keeping, and PR reporting.
 *
 * `record` appends a snapshot of the built app to the history file that main
 * carries in a workflow artifact. `comment` measures the same way and renders
 * the chart a pull request comment shows, one point per week of main and this
 * build as a single dot.
 *
 * History reaches further back than the artifact does. `bundle-size-history.json`
 * holds the weekly builds measured when this was written, and the artifact
 * carries what main has recorded since.
 *
 * The dots are bar series squashed by `themeCSS`. Mermaid line plots draw no
 * point markers, and every series starts at the first category, so the dot for
 * this build has no other way to land on the right category.
 */

import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The build `make -C app deploy` uploads to Bulletin. */
const PUBLISHED_TARGET = "spa";

interface Snapshot {
  date: string;
  sha: string;
  raw: number;
  gzip: number;
}

interface History {
  snapshots: Snapshot[];
}

/** Snapshots the chart plots before the dot, oldest first. */
const CHART_POINTS = 12;

/** Snapshots the history file keeps. */
const HISTORY_LIMIT = 200;

/** Weekly builds measured once, so the chart has a trend from the first run. */
const SEED_FILE = join(dirname(fileURLToPath(import.meta.url)), "bundle-size-history.json");

const CHART_WIDTH = 820;
const CHART_HEIGHT = 280;
const DOT_SIZE = 13;
const TREND_DOT_SIZE = 8;

const TREND_COLOR = "#8b949e";
const DOT_COLOR = "#2f81f7";

const MARKER = "<!-- bundle-size -->";

function formatBytes(bytes: number): string {
  if (Math.abs(bytes) >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (Math.abs(bytes) >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
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

/** Sizes the files Bulletin stores, which are the bytes as built. */
function measure(dist: string): Pick<Snapshot, "raw" | "gzip"> {
  const dir = join(dist, PUBLISHED_TARGET);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`no ${PUBLISHED_TARGET} build found under ${dist}`);
  }
  let raw = 0;
  let gzip = 0;
  for (const file of walk(dir)) {
    const content = readFileSync(file);
    raw += content.length;
    gzip += gzipSync(content).length;
  }
  return { raw, gzip };
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

/** Formats a snapshot timestamp as the `MM-DD` tick under a point. */
function axisLabel(date: string): string {
  return new Date(date).toISOString().slice(5, 10);
}

/** The ISO week a snapshot belongs to, which is the bucket the chart plots. */
function isoWeek(date: string): string {
  const day = new Date(date);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7) + 3);
  const firstThursday = new Date(Date.UTC(day.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((day.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
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

/** Styles one bar series into dots, showing either the last bar or all but it. */
function dotStyle(plot: number, size: number, squash: string, last: boolean): string {
  const shape = `height: ${size}px; rx: 50%; ry: 50%; transform-box: fill-box; transform-origin: center; transform: scaleX(${squash})`;
  return last
    ? `.bar-plot-${plot} rect { display: none }.bar-plot-${plot} rect:last-of-type { display: block; ${shape} }`
    : `.bar-plot-${plot} rect { ${shape} }.bar-plot-${plot} rect:last-of-type { display: none }`;
}

/**
 * Builds the mermaid chart, the history of main as a line of dots and this
 * build as the dot above the `PR` tick.
 *
 * The line stops one category short of that dot on purpose. A pull request is
 * a proposal, not a point on the branch history the line draws.
 */
function chart(history: Snapshot[], current: number): string {
  const values = [...history.map((snapshot) => snapshot.raw), current];
  const scale = chartScale(Math.max(...values));
  const scaled = values.map((value) => value / scale.divisor);
  const high = Math.max(...scaled) * 1.1;

  const categories = [...history.map((snapshot) => axisLabel(snapshot.date)), "PR"];
  const width = barWidth(categories.length);
  const css = [
    dotStyle(1, TREND_DOT_SIZE, (TREND_DOT_SIZE / width).toFixed(3), false),
    dotStyle(2, DOT_SIZE, (DOT_SIZE / width).toFixed(3), true),
  ].join("");

  const init = {
    themeCSS: css,
    themeVariables: {
      xyChart: { plotColorPalette: `${TREND_COLOR}, ${TREND_COLOR}, ${DOT_COLOR}` },
    },
    xyChart: { width: CHART_WIDTH, height: CHART_HEIGHT },
  };

  const point = (value: number) => value.toFixed(scale.decimals);
  const trend = scaled.slice(0, -1).map(point);
  const floor = point(0);
  const dot = [...trend.map(() => floor), point(scaled[scaled.length - 1]!)];

  return [
    "```mermaid",
    `%%{init: ${JSON.stringify(init)}}%%`,
    "xychart-beta",
    `    title "Evolution of the bundle published to Bulletin, last ${history.length} weeks"`,
    `    x-axis [${categories.map((label) => `"${label}"`).join(", ")}]`,
    `    y-axis "${scale.unit}" 0 --> ${point(high)}`,
    `    line [${trend.join(", ")}]`,
    `    bar [${[...trend, floor].join(", ")}]`,
    `    bar [${dot.join(", ")}]`,
    "```",
  ].join("\n");
}

/** Reduces the history to the last build of each week. */
function weekly(history: Snapshot[]): Snapshot[] {
  const byWeek = new Map<string, Snapshot>();
  for (const snapshot of history) byWeek.set(isoWeek(snapshot.date), snapshot);
  return [...byWeek.values()];
}

function renderComment(current: Snapshot, history: Snapshot[]): string {
  const plotted = weekly(history).slice(-CHART_POINTS);
  const body =
    plotted.length > 0
      ? chart(plotted, current.raw)
      : `This build publishes ${formatBytes(current.raw)} to Bulletin. There is no history to chart yet.`;
  return `${[MARKER, "### How much the bundle size changes", "", body].join("\n")}\n`;
}

function merge(history: Snapshot[], incoming: Snapshot[]): Snapshot[] {
  const shas = new Set(incoming.map((snapshot) => snapshot.sha));
  return [...history.filter((snapshot) => !shas.has(snapshot.sha)), ...incoming]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-HISTORY_LIMIT);
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
  const historyPath = args.history ?? ".bundle-size/history.json";
  const recorded = readHistory(historyPath).snapshots;
  const sha = args.sha ?? headSha();
  const snapshot: Snapshot = {
    date: args.date ?? commitDate(sha),
    sha,
    ...measure(args.dist ?? "app/dist"),
  };

  if (command === "record") {
    writeHistory(historyPath, { snapshots: merge(recorded, [snapshot]) });
    console.log(`recorded ${formatBytes(snapshot.raw)} at ${snapshot.sha.slice(0, 7)}`);
    return;
  }

  if (command === "comment") {
    const history = merge(readHistory(SEED_FILE).snapshots, recorded);
    writeFileSync(args.out ?? "bundle-size-comment.md", renderComment(snapshot, history));
    console.log("wrote the comment");
    return;
  }

  console.error("usage: bundle-size.ts <record|comment> [--dist=dir] [--history=file] [--out=file]");
  process.exit(1);
}

main();
