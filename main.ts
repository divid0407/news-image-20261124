// "The World Today" — a one-day world news poster for Tuesday 24 November 2026.
// Drawn entirely in code (Node 22, standard library only) and written to
// /output/entry.png. No network, no fonts, no image assets: every letter comes
// from the small 5x7 bitmap font below, and every picture from flat shapes.
// The six stories were all first reported on 24 November 2026.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// PNG encoding (truecolour, 8-bit, filter 0 on every row)
// ---------------------------------------------------------------------------

const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour RGB
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0; // filter: none
    rgb.copy(raw, y * (1 + width * 3) + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Framebuffer and flat-shape drawing
// ---------------------------------------------------------------------------

const W = 1024;
const H = 1024;
const fb = Buffer.alloc(W * H * 3);

type RGB = [number, number, number];

function px(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  fb[i] = c[0]; fb[i + 1] = c[1]; fb[i + 2] = c[2];
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) px(i, j, c);
}

function hline(x0: number, x1: number, y: number, c: RGB): void {
  for (let x = x0; x <= x1; x++) px(x, y, c);
}

function vline(x: number, y0: number, y1: number, c: RGB): void {
  for (let y = y0; y <= y1; y++) px(x, y, c);
}

function thickHline(x0: number, x1: number, y: number, t: number, c: RGB): void {
  fillRect(x0, y - Math.floor(t / 2), x1 - x0 + 1, t, c);
}

function thickVline(x: number, y0: number, y1: number, t: number, c: RGB): void {
  fillRect(x - Math.floor(t / 2), y0, t, y1 - y0 + 1, c);
}

// Bresenham line, t pixels thick (drawn as small squares along the line).
function line(x0: number, y0: number, x1: number, y1: number, t: number, c: RGB): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  const r = Math.floor(t / 2);
  for (;;) {
    fillRect(x - r, y - r, t, t, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y));
    hline(cx - half, cx + half, cy + y, c);
  }
}

function ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
  for (let a = 0; a < 360; a += 1) {
    const rad = (a * Math.PI) / 180;
    for (let k = 0; k < t; k++) {
      px(Math.round(cx + (r + k - Math.floor(t / 2)) * Math.cos(rad)),
         Math.round(cy + (r + k - Math.floor(t / 2)) * Math.sin(rad)), c);
    }
  }
}

function rectOutline(x: number, y: number, w: number, h: number, t: number, c: RGB): void {
  fillRect(x, y, w, t, c);
  fillRect(x, y + h - t, w, t, c);
  fillRect(x, y, t, h, c);
  fillRect(x + w - t, y, t, h, c);
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font (capitals, digits and the punctuation the poster needs).
// Each glyph is 7 rows of 5 cells; '1' is ink, '0' is empty.
// ---------------------------------------------------------------------------

const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  ',': ['00000', '00000', '00000', '00000', '00100', '00100', '01000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
};

const GLYPH_W = 5;
const GLYPH_H = 7;

function textWidth(text: string, scale: number): number {
  if (text.length === 0) return 0;
  return text.length * (GLYPH_W * scale + scale) - scale;
}

function drawChar(x: number, y: number, ch: string, scale: number, c: RGB): void {
  const g = FONT[ch];
  if (!g) return;
  for (let r = 0; r < GLYPH_H; r++) {
    for (let col = 0; col < GLYPH_W; col++) {
      if (g[r][col] === '1') fillRect(x + col * scale, y + r * scale, scale, scale, c);
    }
  }
}

function drawText(x: number, y: number, text: string, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of text) {
    drawChar(cx, y, ch, scale, c);
    cx += GLYPH_W * scale + scale;
  }
}

function drawTextCentred(cx: number, y: number, text: string, scale: number, c: RGB): void {
  drawText(cx - Math.floor(textWidth(text, scale) / 2), y, text, scale, c);
}

// Greedy word wrap: returns lines that fit maxWidth pixels at this scale.
function wrapText(text: string, maxWidth: number, scale: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur === '' ? w : cur + ' ' + w;
    if (textWidth(trial, scale) <= maxWidth) {
      cur = trial;
    } else {
      if (cur !== '') lines.push(cur);
      cur = w;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------------------
// Palette and story data — every story was first reported on 24 November 2026.
// ---------------------------------------------------------------------------

const PAPER: RGB = [246, 241, 231];
const INK: RGB = [25, 25, 25];
const WHITE: RGB = [255, 255, 255];
const NAVY: RGB = [20, 33, 61];
const GOLD: RGB = [232, 181, 77];
const GREY: RGB = [90, 86, 78];
const PANEL_LINE: RGB = [200, 192, 172];

interface Story {
  kicker: string;
  colour: RGB;
  headline: string;
  caption: string;
  icon: 'chip' | 'satellite' | 'scales' | 'building' | 'globe' | 'virus';
}

const STORIES: Story[] = [
  {
    kicker: 'TECH',
    colour: [29, 78, 216],
    headline: 'HUANG IS BACK AT NVIDIA',
    caption: 'NVIDIA REINSTATES JENSEN HUANG AS CHIEF EXECUTIVE, DAYS AFTER HE QUIT, AFTER DONALD TRUMP PRESSED THE BOARD.',
    icon: 'chip',
  },
  {
    kicker: 'SPACE',
    colour: [109, 40, 217],
    headline: 'NATO WARNS OVER SPACE WEAPON',
    caption: 'NATO VOWS TO DEFEND SPACE AFTER REPORTS RUSSIA MAY PUT A NUCLEAR WEAPON IN ORBIT.',
    icon: 'satellite',
  },
  {
    kicker: 'LAW',
    colour: [15, 118, 110],
    headline: '14 NATIONS BACK GENOCIDE RULING',
    caption: 'FOURTEEN COUNTRIES ENDORSE THE ICJ RULING THAT MYANMAR COMMITTED GENOCIDE AGAINST THE ROHINGYA.',
    icon: 'scales',
  },
  {
    kicker: 'WAR',
    colour: [180, 35, 24],
    headline: 'ZAPORIZHZHIA STRIKE KILLS TWO',
    caption: 'AN OVERNIGHT RUSSIAN ATTACK HITS AN APARTMENT BLOCK: 2 KILLED, 40 WOUNDED, AMONG THEM FOUR CHILDREN.',
    icon: 'building',
  },
  {
    kicker: 'CLIMATE',
    colour: [21, 128, 61],
    headline: 'COP31 ENDS WITH NO DEAL',
    caption: 'THE UN CLIMATE SUMMIT CLOSES WITHOUT AGREEMENT AS TALKS SPLIT OVER FOSSIL FUELS.',
    icon: 'globe',
  },
  {
    kicker: 'HEALTH',
    colour: [194, 65, 12],
    headline: 'US LOSES MEASLES-FREE STATUS',
    caption: 'AMERICA LOSES ITS MEASLES ELIMINATION STATUS AFTER MORE THAN 25 YEARS.',
    icon: 'virus',
  },
];

// ---------------------------------------------------------------------------
// Icons: flat pictograms drawn with the same primitives, 84 x 84.
// ---------------------------------------------------------------------------

function drawIcon(kind: Story['icon'], x: number, y: number, c: RGB): void {
  const cx = x + 42;
  const cy = y + 42;
  if (kind === 'chip') {
    fillRect(x + 16, y + 16, 52, 52, c);
    fillRect(x + 30, y + 30, 24, 24, PAPER);
    fillRect(x + 38, y + 38, 8, 8, c);
    for (let i = 0; i < 3; i++) {
      fillRect(x + 24 + i * 18, y + 6, 6, 10, c);
      fillRect(x + 24 + i * 18, y + 68, 6, 10, c);
      fillRect(x + 6, y + 24 + i * 18, 10, 6, c);
      fillRect(x + 68, y + 24 + i * 18, 10, 6, c);
    }
  } else if (kind === 'satellite') {
    fillRect(x + 34, y + 34, 18, 18, c);
    fillRect(x + 8, y + 38, 20, 10, c);
    fillRect(x + 56, y + 38, 20, 10, c);
    vline(x + 18, y + 38, y + 48, PAPER);
    vline(x + 66, y + 38, y + 48, PAPER);
    line(x + 52, y + 34, x + 66, y + 18, 3, c);
    fillCircle(x + 68, y + 16, 5, c);
    fillRect(x + 38, y + 52, 8, 8, c);
    line(x + 42, y + 60, x + 42, y + 72, 3, c);
  } else if (kind === 'scales') {
    thickVline(cx, y + 12, y + 66, 4, c);
    thickHline(x + 12, x + 72, y + 18, 4, c);
    fillRect(cx - 12, y + 66, 24, 6, c);
    fillCircle(cx, y + 10, 4, c);
    line(x + 18, y + 18, x + 12, y + 44, 3, c);
    line(x + 18, y + 18, x + 24, y + 44, 3, c);
    line(x + 66, y + 18, x + 60, y + 44, 3, c);
    line(x + 66, y + 18, x + 72, y + 44, 3, c);
    fillRect(x + 8, y + 44, 20, 5, c);
    fillRect(x + 56, y + 44, 20, 5, c);
  } else if (kind === 'building') {
    fillRect(x + 18, y + 30, 48, 44, c);
    for (let r = 0; r < 3; r++) {
      for (let col = 0; col < 3; col++) {
        fillRect(x + 26 + col * 14, y + 38 + r * 12, 7, 7, PAPER);
      }
    }
    line(x + 52, y + 30, x + 44, y + 44, 3, PAPER);
    line(x + 44, y + 44, x + 52, y + 56, 3, PAPER);
    fillCircle(x + 28, y + 16, 8, GREY);
    fillCircle(x + 44, y + 10, 10, GREY);
    fillCircle(x + 60, y + 18, 7, GREY);
  } else if (kind === 'globe') {
    ring(cx, cy + 4, 30, 3, c);
    for (const dy of [-16, 0, 16]) {
      const half = Math.floor(Math.sqrt(30 * 30 - dy * dy));
      hline(cx - half, cx + half, cy + 4 + dy, c);
    }
    for (const dx of [-15, 15]) {
      const half = Math.floor(Math.sqrt(30 * 30 - dx * dx));
      vline(cx + dx, cy + 4 - half, cy + 4 + half, c);
    }
    fillCircle(x + 66, y + 12, 7, [21, 128, 61]);
    line(x + 66, y + 12, x + 74, y + 4, 2, [21, 128, 61]);
  } else if (kind === 'virus') {
    for (let a = 0; a < 8; a++) {
      const rad = (a * Math.PI) / 4;
      line(
        Math.round(cx + 18 * Math.cos(rad)), Math.round(cy + 18 * Math.sin(rad)),
        Math.round(cx + 30 * Math.cos(rad)), Math.round(cy + 30 * Math.sin(rad)), 3, c,
      );
      fillCircle(Math.round(cx + 32 * Math.cos(rad)), Math.round(cy + 32 * Math.sin(rad)), 3, c);
    }
    fillCircle(cx, cy, 18, c);
    fillCircle(cx - 6, cy - 4, 3, PAPER);
    fillCircle(cx + 6, cy + 5, 3, PAPER);
    fillCircle(cx + 7, cy - 7, 2, PAPER);
  }
}

// ---------------------------------------------------------------------------
// Poster layout
// ---------------------------------------------------------------------------

function drawMasthead(): void {
  fillRect(24, 24, W - 48, 148, NAVY);
  drawTextCentred(W / 2, 44, 'THE WORLD TODAY', 6, WHITE);
  fillRect(112, 108, W - 224, 4, GOLD);
  drawTextCentred(W / 2, 122, 'TUESDAY, 24 NOVEMBER 2026', 4, GOLD);
  drawTextCentred(W / 2, 152, 'SIX STORIES THAT DEFINED THE DAY', 2, WHITE);
}

function drawPanel(s: Story, x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, WHITE);
  rectOutline(x, y, w, h, 2, PANEL_LINE);
  // Kicker chip.
  const kw = textWidth(s.kicker, 2) + 16;
  fillRect(x + 14, y + 12, kw, 22, s.colour);
  drawText(x + 22, y + 17, s.kicker, 2, WHITE);
  // Headline, up to two lines.
  const headLines = wrapText(s.headline, w - 28, 3);
  let hy = y + 46;
  for (const ln of headLines.slice(0, 2)) {
    drawText(x + 14, hy, ln, 3, INK);
    hy += 26;
  }
  // Icon at left, caption to its right.
  const iy = y + 108;
  fillRect(x + 14, iy, 84, 84, PAPER);
  rectOutline(x + 14, iy, 84, 84, 2, PANEL_LINE);
  drawIcon(s.icon, x + 14, iy, s.colour);
  const capLines = wrapText(s.caption, w - 28 - 84 - 12, 2);
  let cy = iy + 2;
  for (const ln of capLines.slice(0, 5)) {
    drawText(x + 14 + 84 + 12, cy, ln, 2, GREY);
    cy += 21;
  }
  // Colour bar at the foot of the panel.
  fillRect(x + 14, y + h - 12, w - 28, 4, s.colour);
}

function drawFooter(): void {
  drawTextCentred(W / 2, 980, 'ALL EVENTS REPORTED ON 24 NOVEMBER 2026', 2, GREY);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  fillRect(0, 0, W, H, PAPER);
  rectOutline(12, 12, W - 24, H - 24, 3, INK);
  drawMasthead();
  const gap = 16;
  const pw = (W - 48 - gap) / 2;
  const ph = 248;
  const top = 188;
  for (let i = 0; i < STORIES.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    drawPanel(STORIES[i], 24 + col * (pw + gap), top + row * (ph + gap), pw, ph);
  }
  drawFooter();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  writeFileSync(join(outDir, 'entry.png'), encodePng(W, H, fb));
}

main();
