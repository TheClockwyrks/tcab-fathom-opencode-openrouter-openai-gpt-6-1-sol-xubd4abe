import * as C from "./constants";
import type { Body, ReadState } from "./model";
import { menuItemRect, menuItems } from "./menus";
import { center, distance, exits, indexOf, neighbor } from "./world";
import { CLEAR_TIME, COUNTDOWN_TIME } from "./simulation";

export const BACKGROUND = "#03060c";
const INK = "#c8f7ef";
const CYAN = "#78edd8";
const DIM = "#608e92";
const LINE = "#183039";
const FONT = '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
type Context = CanvasRenderingContext2D;
const face = { down: 0, up: 2, left: 4, right: 6 };

function text(
  ctx: Context,
  str: string,
  x: number,
  y: number,
  size = 14,
  color = INK,
  align: CanvasTextAlign = "left",
): void {
  ctx.font = `${size >= 40 ? "600" : "400"} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}
function spaced(
  ctx: Context,
  str: string,
  x: number,
  y: number,
  size: number,
  spacing: number,
  color = INK,
): void {
  for (const char of str) {
    text(ctx, char, x, y, size, color);
    x += size * 0.6 + spacing;
  }
}
function line(
  ctx: Context,
  x: number,
  y: number,
  x2: number,
  y2: number,
  color = LINE,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function circle(
  ctx: Context,
  x: number,
  y: number,
  r: number,
  color: string,
  width = 1,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}
function glow(
  ctx: Context,
  x: number,
  y: number,
  radius: number,
  color: string,
  strength = 0.3,
): void {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "transparent");
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}
function sprite(
  ctx: Context,
  s: ReadState,
  sheet: string,
  frame: number,
  x: number,
  y: number,
  size = C.TILE,
): void {
  const image = s.assets[sheet]?.[frame];
  if (image)
    ctx.drawImage(image as ImageBitmap, x - size / 2, y - size / 2, size, size);
}
function amber(ctx: Context, b: Pick<Body, "x" | "y">): void {
  glow(ctx, b.x, b.y, 24, "#ff6d38", 0.65);
  ctx.shadowColor = "#ff713d";
  ctx.shadowBlur = 10;
  ctx.fillStyle = "#ffc58d";
  ctx.beginPath();
  ctx.arc(b.x, b.y, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}
function tile(
  ctx: Context,
  s: ReadState,
  tx: number,
  ty: number,
  visibility: string,
): void {
  const x = C.GRID_ORIGIN_X + tx * C.TILE;
  const y = C.GRID_ORIGIN_Y + ty * C.TILE;
  if (visibility === "u") {
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(x, y, C.TILE, C.TILE);
    return;
  }
  const type = s.tiles[ty][tx];
  let frame = type === "g" ? 18 : 16;
  if (type === "#") {
    frame =
      (s.tiles[ty - 1]?.[tx] === "#" ? 1 : 0) +
      (s.tiles[ty]?.[tx + 1] === "#" ? 2 : 0) +
      (s.tiles[ty + 1]?.[tx] === "#" ? 4 : 0) +
      (s.tiles[ty]?.[tx - 1] === "#" ? 8 : 0);
  }
  ctx.save();
  ctx.globalAlpha = visibility === "l" ? 1 : 0.3;
  sprite(ctx, s, "trench-walls", frame, x + C.TILE / 2, y + C.TILE / 2);
  if (type === "." && s.plankton[ty][tx] === "*") {
    ctx.shadowColor = CYAN;
    ctx.shadowBlur = visibility === "l" ? 8 : 0;
    ctx.fillStyle = "#b5f5e2";
    ctx.beginPath();
    ctx.arc(x + C.TILE / 2, y + C.TILE / 2, C.PLANKTON_DOT / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
function terrain(ctx: Context, s: ReadState, demo = false): void {
  for (let ty = 0; ty < C.GRID_ROWS; ty++)
    for (let tx = 0; tx < C.GRID_COLS; tx++)
      tile(ctx, s, tx, ty, demo ? "l" : s.visibility[ty][tx]);
}
function clipCircle(ctx: Context, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
}
function mazeView(ctx: Context, s: ReadState): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    C.GRID_ORIGIN_X,
    C.GRID_ORIGIN_Y,
    C.GRID_COLS * C.TILE,
    C.GRID_ROWS * C.TILE,
  );
  ctx.clip();
  ctx.save();
  clipCircle(ctx, s.forager.x, s.forager.y, s.windowRadius);
  terrain(ctx, s);
  glow(ctx, s.forager.x, s.forager.y, s.windowRadius, "#2bafab", 0.14);
  for (const d of s.drifters) {
    if (d.lit)
      sprite(ctx, s, "drifter", Math.floor(s.simTime * 8) % 8, d.x, d.y);
    amber(ctx, d);
  }
  for (const p of s.predators)
    if (p.state !== "den" && p.kind === "lanternjaw") amber(ctx, p);
  ctx.restore();
  for (const p of s.predators)
    if (p.flaring && p.state !== "den") {
      ctx.save();
      clipCircle(ctx, p.x, p.y, C.FLARE_RADIUS);
      terrain(ctx, s);
      for (const d of s.drifters)
        if (distance(p, d) <= C.FLARE_RADIUS) {
          sprite(ctx, s, "drifter", Math.floor(s.simTime * 8) % 8, d.x, d.y);
          amber(ctx, d);
        }
      ctx.restore();
    }
  for (const cloud of s.inkClouds) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, cloud.remaining);
    const g = ctx.createRadialGradient(
      cloud.x,
      cloud.y,
      cloud.radius * 0.3,
      cloud.x,
      cloud.y,
      cloud.radius,
    );
    g.addColorStop(0, "#000105");
    g.addColorStop(0.8, "#010209f2");
    g.addColorStop(1, "#00010700");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cloud.x, cloud.y, cloud.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  for (const pulse of s.pulses) {
    const color =
      pulse.tint === "cyan"
        ? "#75fff1"
        : pulse.tint === "violet"
          ? "#be91ff"
          : "#ff9e60";
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    for (let ty = 0; ty < C.GRID_ROWS; ty++)
      for (let tx = 0; tx < C.GRID_COLS; tx++) {
        const d = pulse.distances[indexOf({ tx, ty })];
        const crest = pulse.front - d;
        if (d < 0 || d > pulse.range || crest < -0.3 || crest > 1.3) continue;
        const b = center(tx, ty);
        const alpha = Math.max(0, 1 - Math.abs(crest - 0.2) / 1.4);
        ctx.globalAlpha = alpha * 0.12;
        ctx.fillStyle = color;
        ctx.fillRect(b.x - 14, b.y - 14, 28, 28);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const dir of exits(s.tiles, b, true)) {
          const n = center(
            neighbor(s.tiles, b, dir)!.tx,
            neighbor(s.tiles, b, dir)!.ty,
          );
          // Wrap edges are drawn at their mouth, never across the entire stage.
          if (distance(b, n) > C.TILE + 1) continue;
          ctx.moveTo(b.x, b.y);
          ctx.lineTo((b.x + n.x) / 2, (b.y + n.y) / 2);
        }
        ctx.stroke();
      }
    ctx.restore();
  }
  for (const p of s.predators) {
    if (p.state === "den") continue;
    if (p.lit) {
      ctx.save();
      if (p.markLeft > 0 && !p.alert)
        ctx.globalAlpha = Math.max(0.25, p.markLeft / C.SONAR_MARK_TIME);
      const frame =
        p.kind === "lanternjaw" && p.state === "wander"
          ? 8 + (Math.floor(s.simTime * 8) % 8)
          : face[p.dir] + (Math.floor(s.simTime * 7) % 2);
      sprite(ctx, s, p.kind, frame, p.x, p.y);
      ctx.restore();
    }
    if (p.alert) {
      const color = p.kind === "gloamfin" ? "#c496ff" : "#ffc389";
      const progress = 1 - p.alertLeft / C.ALERT_TIME;
      ctx.save();
      ctx.globalAlpha = 1 - progress;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      circle(ctx, p.x, p.y, 16 + progress * 36, color, 2);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const r = 22 + progress * 34;
        line(
          ctx,
          p.x + Math.cos(a) * r,
          p.y + Math.sin(a) * r,
          p.x + Math.cos(a) * (r + 12),
          p.y + Math.sin(a) * (r + 12),
          color,
        );
      }
      ctx.restore();
    }
    if (p.flareCharging || p.flaring || p.fadeLeft > 0) {
      const frame = p.flareCharging
        ? Math.min(2, Math.floor((p.flarePhase / C.FLARE_CHARGE) * 3))
        : p.flaring
          ? 3 + Math.min(2, Math.floor((p.flarePhase / C.FLARE_BLOOM) * 3))
          : p.fadeLeft > 0.175
            ? 6
            : 7;
      ctx.save();
      ctx.globalAlpha = p.flareCharging ? 0.65 : 0.6;
      sprite(ctx, s, "flare-bloom", frame, p.x, p.y, C.FLARE_RADIUS * 2);
      ctx.restore();
    }
  }
  glow(ctx, s.forager.x, s.forager.y, 38 + s.brightness * 16, "#7cfff0", 0.45);
  sprite(
    ctx,
    s,
    "glimmerfin",
    face[s.forager.dir] +
      (s.forager.moving ? Math.floor(s.simTime * 9) % 2 : 0),
    s.forager.x,
    s.forager.y,
  );
  ctx.restore();
  // Quiet instrument markings frame the dark without exposing any terrain.
  const x = C.GRID_ORIGIN_X;
  const y = C.GRID_ORIGIN_Y;
  const w = C.GRID_COLS * C.TILE;
  const h = C.GRID_ROWS * C.TILE;
  for (const [a, b, dx, dy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ]) {
    line(ctx, a, b, a + dx * 18, b, "#26434b");
    line(ctx, a, b, a, b + dy * 18, "#26434b");
  }
}
function gauge(
  ctx: Context,
  label: string,
  key: string,
  x: number,
  fraction: number,
  color: string,
): void {
  text(ctx, key, x, 682, 11, DIM);
  text(ctx, label, x + 57, 682, 12, fraction >= 1 ? color : DIM);
  ctx.fillStyle = "#13232b";
  ctx.fillRect(x, 693, 206, 3);
  ctx.fillStyle = color;
  ctx.fillRect(x, 693, 206 * Math.max(0, fraction), 3);
  text(
    ctx,
    fraction >= 1 ? "READY" : "CHARGING",
    x + 206,
    682,
    10,
    DIM,
    "right",
  );
}
function hud(ctx: Context, s: ReadState): void {
  text(ctx, String(s.score).padStart(6, "0"), 64, 61, 48);
  text(ctx, "SCORE", 263, 28, 10, DIM);
  spaced(ctx, C.TITLE_TEXT, 557, 38, 20, 4, CYAN);
  text(ctx, C.TAGLINE_TEXT, 640, 59, 9, DIM, "center");
  text(
    ctx,
    `PLANKTON  ${String(s.planktonRemaining).padStart(3, "0")}`,
    1216,
    32,
    12,
    INK,
    "right",
  );
  text(
    ctx,
    `${C.DIVE_LABEL}  /  G ${s.brightness.toFixed(2)}`,
    1216,
    54,
    11,
    DIM,
    "right",
  );
  line(ctx, 64, 71, 1216, 71);
  text(ctx, "RESERVE", 64, 679, 10, DIM);
  for (let i = 0; i < s.lives; i++)
    sprite(ctx, s, "glimmerfin", 6, 144 + i * 27, 684, 24);
  gauge(
    ctx,
    "SONAR",
    "SPACE",
    373,
    1 - s.sonar.cooldown / C.SONAR_COOLDOWN,
    CYAN,
  );
  gauge(
    ctx,
    "INK",
    "SHIFT",
    636,
    1 - s.ink.cooldown / C.INK_COOLDOWN,
    "#9c9bcf",
  );
  text(
    ctx,
    `DEPTH ${String(s.depth).padStart(2, "0")}`,
    1216,
    684,
    18,
    INK,
    "right",
  );
  text(
    ctx,
    `${s.muted ? "M  SOUND OFF" : "M  SOUND ON"}    P  PAUSE`,
    1216,
    706,
    9,
    DIM,
    "right",
  );
}
function menu(ctx: Context, s: ReadState): void {
  menuItems(s).forEach((label, i) => {
    const rect = menuItemRect(s, i)!;
    const selected = s.menuIndex === i;
    ctx.fillStyle = selected ? "#102b30" : "#081219";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = selected ? "#6bcebd" : "#1a3038";
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    if (selected) {
      ctx.fillStyle = CYAN;
      ctx.fillRect(rect.x, rect.y, 3, rect.h);
    }
    text(ctx, label, rect.x + 24, rect.y + 31, 16, selected ? INK : DIM);
    text(
      ctx,
      selected ? "↗" : `0${i + 1}`,
      rect.x + rect.w - 24,
      rect.y + 31,
      16,
      selected ? CYAN : "#36555e",
      "right",
    );
  });
}
function atmosphere(ctx: Context): void {
  glow(ctx, 934, 348, 440, "#0b6669", 0.13);
  ctx.save();
  // Bathymetric contour lines: decorative chartwork, never gameplay terrain.
  for (let k = 0; k < 9; k++) {
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const r =
        264 + k * 30 + Math.sin(a * 5 + k * 0.6) * 12 + Math.sin(a * 3) * 20;
      const x = 920 + Math.cos(a) * r * 1.08;
      const y = 350 + Math.sin(a) * r * 0.93;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = k % 3 === 0 ? "#0e242c" : "#0a1b23";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
  for (let i = 0; i < 50; i++) {
    ctx.fillStyle = i % 5 ? "#173039" : "#3b696b";
    ctx.fillRect((i * 251 + 37) % C.STAGE_W, (i * 137 + 81) % C.STAGE_H, 1, 1);
  }
}
function title(ctx: Context, s: ReadState): void {
  atmosphere(ctx);
  line(ctx, 64, 64, 1216, 64);
  text(ctx, "F / 01", 64, 44, 13, CYAN);
  text(ctx, "ABYSSAL EXPLORATION DIVISION", 163, 44, 10, DIM);
  text(ctx, `DIVE SERIES  /  ${C.DIVE_LABEL}`, 1216, 44, 11, DIM, "right");
  spaced(ctx, "A LIGHT IN THE HADAL ZONE", 106, 174, 11, 2, CYAN);
  spaced(ctx, C.TITLE_TEXT, 98, 284, 92, 2);
  spaced(ctx, C.TAGLINE_TEXT, 106, 325, 15, 4, CYAN);
  text(ctx, "Graze the glow. Read the echoes.", 106, 365, 14, DIM);
  menu(ctx, s);
  text(ctx, "↑ ↓ SELECT    ENTER DIVE", 106, 560, 10, DIM);
  const x = 916;
  const y = 342;
  const r = 220;
  circle(ctx, x, y, r + 19, "#183a40");
  circle(ctx, x, y, r + 26, "#0d242c");
  ctx.save();
  clipCircle(ctx, x, y, r);
  ctx.translate(x - s.forager.x, y - s.forager.y);
  terrain(ctx, s, true);
  const shade = ctx.createRadialGradient(
    s.forager.x,
    s.forager.y,
    0,
    s.forager.x,
    s.forager.y,
    r,
  );
  shade.addColorStop(0, "#03060c10");
  shade.addColorStop(0.5, "#03060c50");
  shade.addColorStop(1, "#03060cf5");
  ctx.fillStyle = shade;
  ctx.fillRect(s.forager.x - r, s.forager.y - r, r * 2, r * 2);
  glow(ctx, s.forager.x, s.forager.y, 120, "#43cbbb", 0.25);
  sprite(ctx, s, "glimmerfin", 6, s.forager.x, s.forager.y);
  amber(ctx, { x: s.forager.x + 148, y: s.forager.y - 96 });
  ctx.restore();
  circle(ctx, x, y, r, "#357d7a");
  circle(ctx, x, y, 96, "#3c9c8f30");
  circle(ctx, x, y, 160, "#3c9c8f20");
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const outer = i % 4 ? r + 13 : r + 18;
    line(
      ctx,
      x + Math.cos(a) * (r + 7),
      y + Math.sin(a) * (r + 7),
      x + Math.cos(a) * outer,
      y + Math.sin(a) * outer,
      i % 4 ? "#1d4348" : "#5a9992",
    );
  }
  line(ctx, x - 11, y, x - 5, y, CYAN);
  line(ctx, x + 5, y, x + 11, y, CYAN);
  text(ctx, "FIG. 01   /   THE FORAGER'S WINDOW", x, 622, 10, DIM, "center");
  text(
    ctx,
    "THE MORE YOU EAT, THE MORE YOU SEE.",
    x,
    644,
    10,
    "#81bab3",
    "center",
  );
  line(ctx, 64, 676, 1216, 676);
  text(ctx, "36 × 18  /  UNCHARTED WATER", 64, 701, 10, DIM);
  text(
    ctx,
    "LIGHT DRAWS LIFE. LIFE DRAWS HUNTERS.",
    640,
    701,
    10,
    DIM,
    "center",
  );
  text(
    ctx,
    s.muted ? "M / SOUND OFF" : "M / SOUND ON",
    1216,
    701,
    10,
    DIM,
    "right",
  );
}
function howto(ctx: Context, s: ReadState): void {
  atmosphere(ctx);
  text(ctx, "FIELD GUIDE  /  01", 80, 66, 11, CYAN);
  text(ctx, "Learn to read the dark.", 80, 124, 40);
  text(ctx, "Your light is a lifeline. It is also a signal.", 80, 161, 14, DIM);
  line(ctx, 80, 188, 1200, 188);
  const rows = [
    [
      "01",
      "KEEP SWIMMING",
      "ARROWS / WASD",
      "Hold a direction to swim. Turn at corridor centers.",
    ],
    [
      "02",
      "LISTEN TO THE MAZE",
      "SPACE / SONAR",
      "Send an echo around corners. Hunters hear it too.",
    ],
    [
      "03",
      "VANISH IN INK",
      "SHIFT / INK",
      "Blind light-hunters. Sound still travels through.",
    ],
  ];
  rows.forEach((row, i) => {
    const y = 240 + i * 112;
    text(ctx, row[0], 80, y, 12, CYAN);
    text(ctx, row[1], 126, y, 15);
    text(ctx, row[2], 126, y + 25, 11, CYAN);
    text(ctx, row[3], 126, y + 50, 12, DIM);
  });
  line(ctx, 660, 215, 660, 560);
  const threats = [
    [
      "lanternjaw",
      "LANTERNJAW",
      "HUNTS LIGHT",
      "That amber glimmer could be a meal. Or jaws.",
    ],
    [
      "gloamfin",
      "GLOAMFIN",
      "HUNTS SOUND",
      "Violet echoes listen. Corners slow its chase.",
    ],
    [
      "flarefish",
      "FLAREFISH",
      "HUNTS IN A FLASH",
      "A warm charge warns you. Get clear of its bloom.",
    ],
  ];
  threats.forEach((row, i) => {
    const y = 242 + i * 112;
    sprite(ctx, s, row[0], 6, 716, y + 4);
    text(ctx, row[1], 754, y, 15, i === 1 ? "#c49cff" : "#f4b88c");
    text(ctx, row[2], 754, y + 23, 10, DIM);
    text(ctx, row[3], 700, y + 53, 12, DIM);
  });
  text(
    ctx,
    "Eat every mote to descend. Eating widens your window — and makes you easier to find.",
    80,
    596,
    13,
    INK,
  );
  text(
    ctx,
    "Explored rock stays remembered, but beyond your circle even familiar water is dark.",
    80,
    622,
    12,
    DIM,
  );
  line(ctx, 80, 650, 1200, 650);
  text(ctx, "ENTER / ESC / CLICK ANYWHERE TO RETURN", 80, 686, 12, CYAN);
  text(ctx, "P / PAUSE     M / MUTE", 1200, 686, 11, DIM, "right");
}
function overlay(ctx: Context, s: ReadState): void {
  ctx.fillStyle = "#03060cd9";
  ctx.fillRect(0, 80, C.STAGE_W, 576);
  if (s.screen === "countdown") {
    text(ctx, "DESCENT IN PROGRESS", 640, 299, 11, DIM, "center");
    spaced(ctx, C.TITLE_ITEMS[0], 545, 366, 48, 10, CYAN);
    text(
      ctx,
      String(Math.max(1, Math.ceil(COUNTDOWN_TIME - s.screenTime))),
      640,
      421,
      32,
      INK,
      "center",
    );
    text(
      ctx,
      "Hold a direction. Follow the light.",
      640,
      468,
      12,
      DIM,
      "center",
    );
  } else if (s.screen === "cleared") {
    text(ctx, "EVERY LIGHT ACCOUNTED FOR", 640, 288, 12, CYAN, "center");
    text(ctx, `DEPTH ${s.depth} CLEARED`, 640, 358, 42, INK, "center");
    text(
      ctx,
      `+${C.SCORE_CLEAR}   /   DESCENDING DEEPER`,
      640,
      406,
      14,
      DIM,
      "center",
    );
    line(
      ctx,
      520,
      454,
      520 + 240 * Math.min(1, s.screenTime / CLEAR_TIME),
      454,
      CYAN,
    );
  } else {
    text(ctx, "DIVE ON HOLD", 640, 248, 11, CYAN, "center");
    text(ctx, "PAUSED", 640, 310, 48, INK, "center");
    menu(ctx, s);
    text(ctx, "ESC / P TO RETURN TO THE WATER", 640, 584, 10, DIM, "center");
  }
}
export function render(s: ReadState, ctx: Context): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (s.screen === "title") title(ctx, s);
  else if (s.screen === "howto") howto(ctx, s);
  else if (s.screen === "gameover") {
    atmosphere(ctx);
    text(ctx, "SIGNAL LOST", 640, 181, 12, "#f6ae90", "center");
    text(ctx, "THE ABYSS KEEPS YOU.", 640, 249, 42, INK, "center");
    text(
      ctx,
      `SCORE ${String(s.score).padStart(6, "0")}   /   DEPTH ${s.depth}`,
      640,
      304,
      17,
      CYAN,
      "center",
    );
    menu(ctx, s);
    text(
      ctx,
      "There is always another light to follow.",
      640,
      552,
      12,
      DIM,
      "center",
    );
  } else {
    mazeView(ctx, s);
    hud(ctx, s);
    if (s.screen !== "playing") overlay(ctx, s);
  }
  ctx.restore();
}
