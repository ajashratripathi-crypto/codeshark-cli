import { hex, bold, dim, stripAnsi } from "./ansi.js";
import { modelLabel, loadConfig, activeModelId } from "./config.js";
import { findModel } from "./models.js";

const WORDMARK = "CODESHARK";
const WORDMARK_GLYPHS: Record<string, string[]> = {
  "C": [
    "01111",
    "10000",
    "10000",
    "10000",
    "10000",
    "10000",
    "01111"
  ],
  "O": [
    "01110",
    "10001",
    "10001",
    "10001",
    "10001",
    "10001",
    "01110"
  ],
  "D": [
    "11110",
    "10001",
    "10001",
    "10001",
    "10001",
    "10001",
    "11110"
  ],
  "E": [
    "11111",
    "10000",
    "10000",
    "11110",
    "10000",
    "10000",
    "11111"
  ],
  "S": [
    "01111",
    "10000",
    "10000",
    "01110",
    "00001",
    "00001",
    "11110"
  ],
  "H": [
    "10001",
    "10001",
    "10001",
    "11111",
    "10001",
    "10001",
    "10001"
  ],
  "A": [
    "01110",
    "10001",
    "10001",
    "11111",
    "10001",
    "10001",
    "10001"
  ],
  "R": [
    "11110",
    "10001",
    "10001",
    "11110",
    "10100",
    "10010",
    "10001"
  ],
  "K": [
    "10001",
    "10010",
    "10100",
    "11000",
    "10100",
    "10010",
    "10001"
  ]
};

function interpolate(start: number, end: number, amount: number): number {
  return Math.round(start + (end - start) * amount);
}

function gradientColor(index: number, length: number): string {
  type Stop = readonly [string, number, number, number];
  const stops: readonly [Stop, Stop, Stop] = [
    ["#0b2a5b", 11, 42, 91],
    ["#1677c8", 22, 119, 200],
    ["#9bdcff", 155, 220, 255],
  ] as const;
  const amount = length <= 1 ? 0 : index / (length - 1);
  const start = amount <= 0.5 ? stops[0] : stops[1];
  const end = amount <= 0.5 ? stops[1] : stops[2];
  const segmentAmount = amount <= 0.5 ? amount * 2 : (amount - 0.5) * 2;
  const [, startR, startG, startB] = start;
  const [, endR, endG, endB] = end;
  return `#${[interpolate(startR, endR, segmentAmount), interpolate(startG, endG, segmentAmount), interpolate(startB, endB, segmentAmount)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function renderWordmark(plain: boolean, columns: number): string {
  // Leave a spare column to avoid terminal auto-wrap.
  if (columns < 56) return plain ? WORDMARK : bold(hex("#9bdcff", WORDMARK));
  const pixelWidth = columns >= 101 ? 2 : 1;
  const letters = [...WORDMARK.toUpperCase()];
  const sharkStart = 4;
  const sharkLength = letters.length - sharkStart;
  return Array.from({ length: 7 }, (_, row) => {
    const parts: string[] = [];
    letters.forEach((letter, letterIndex) => {
      const glyph = WORDMARK_GLYPHS[letter]!;
      const pixels = [...glyph[row]!].map((pixel) => {
        if (pixel === "0") return " ".repeat(pixelWidth);
        const block = "\u2588".repeat(pixelWidth);
        if (plain) return block;
        return letterIndex < sharkStart ? bold(hex("#f8fafc", block)) : hex(gradientColor(letterIndex - sharkStart, sharkLength), block);
      });
      parts.push(pixels.join(""));
    });
    return parts.join(" ");
  }).join("\n");
}

export interface BannerOptions {
  plain?: boolean;
  columns?: number;
  modelLine?: string;
  cwd?: string;
  footer?: string;
}

export function renderBanner(opts: BannerOptions = {}): string {
  const plain = opts.plain ?? false;
  const cfg = loadConfig();
  const entry = findModel(activeModelId(cfg));
  const baseLabel = modelLabel(cfg);
  const modelLine =
    opts.modelLine ?? (entry ? `${baseLabel} · ${entry.context} context` : baseLabel);
  const cwd = opts.cwd ?? process.cwd();

  const title = renderWordmark(plain, opts.columns ?? process.stdout.columns ?? 80);
  const sub = plain ? modelLine : hex("#8ba3ba", modelLine);
  const dir = plain ? cwd : dim(cwd);

  const lines = [...title.split("\n").map((line) => "  " + line), "", "  " + sub, "  " + dir];

  if (opts.footer) lines.push("", opts.footer);
  return lines.join("\n") + "\n";
}

export function printBanner(opts: BannerOptions = {}): void {
  process.stdout.write(renderBanner(opts));
}

export function bannerHasTitle(text: string): boolean {
  const clean = stripAnsi(text);
  return clean.includes(WORDMARK) || [56, 101].some((columns) =>
    clean.includes(renderWordmark(true, columns).split("\n").map((line) => "  " + line).join("\n")),
  );
}