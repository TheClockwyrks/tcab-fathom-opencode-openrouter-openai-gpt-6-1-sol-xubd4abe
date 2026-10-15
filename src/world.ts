import * as C from "./constants";
import type {
  Body,
  Direction,
  FathomState,
  Predator,
  ReadState,
  Screen,
  TilePoint,
} from "./model";

export const DIRECTIONS: readonly Direction[] = ["up", "down", "left", "right"];
export const VECTORS: Record<Direction, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
export const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};
export const blank = (char: string): string[] =>
  Array.from({ length: C.GRID_ROWS }, () => char.repeat(C.GRID_COLS));
export const indexOf = (p: TilePoint): number => p.ty * C.GRID_COLS + p.tx;
export const sameTile = (a: TilePoint, b: TilePoint): boolean =>
  a.tx === b.tx && a.ty === b.ty;
export const distance = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => Math.hypot(a.x - b.x, a.y - b.y);
export const center = (tx: number, ty: number): Body => ({
  tx,
  ty,
  x: C.GRID_ORIGIN_X + (tx + 0.5) * C.TILE,
  y: C.GRID_ORIGIN_Y + (ty + 0.5) * C.TILE,
  dir: "up",
});
export function locate(b: Body): void {
  b.tx = Math.floor((b.x - C.GRID_ORIGIN_X) / C.TILE);
  b.ty = Math.floor((b.y - C.GRID_ORIGIN_Y) / C.TILE);
}
export function put(
  rows: string[],
  tx: number,
  ty: number,
  char: string,
): void {
  rows[ty] = rows[ty].slice(0, tx) + char + rows[ty].slice(tx + 1);
}
export function maze(): string[] {
  const rows = blank("#");
  for (const y of [1, 4, 7, 10, 13, 16])
    for (let x = 1; x < C.GRID_COLS - 1; x++) put(rows, x, y, ".");
  for (const x of [1, 5, 9, 13, 22, 26, 30, 34])
    for (let y = 1; y < C.GRID_ROWS - 1; y++) put(rows, x, y, ".");
  for (let x = 16; x <= 19; x++) put(rows, x, 4, "#");
  for (const y of [7, 10]) for (let x = 14; x <= 21; x++) put(rows, x, y, "#");
  for (let x = 15; x <= 20; x++) put(rows, x, 5, ".");
  for (let x = 13; x <= 22; x++) put(rows, x, 11, ".");
  for (let y = 7; y <= 9; y++)
    for (let x = 16; x <= 19; x++) put(rows, x, y, "d");
  put(rows, 17, 6, "g");
  put(rows, 0, 7, ".");
  put(rows, C.GRID_COLS - 1, 7, ".");
  return rows;
}
export function wrapRow(rows: readonly string[]): number {
  return rows.findIndex(
    (row) => row[0] === "." && row[C.GRID_COLS - 1] === ".",
  );
}
export function neighbor(
  rows: readonly string[],
  p: TilePoint,
  dir: Direction,
): TilePoint | null {
  const [dx, dy] = VECTORS[dir];
  let tx = p.tx + dx;
  const ty = p.ty + dy;
  if ((tx < 0 || tx >= C.GRID_COLS) && p.ty === wrapRow(rows))
    tx = (tx + C.GRID_COLS) % C.GRID_COLS;
  return tx >= 0 && tx < C.GRID_COLS && ty >= 0 && ty < C.GRID_ROWS
    ? { tx, ty }
    : null;
}
export function open(
  rows: readonly string[],
  p: TilePoint | null,
  den = false,
): boolean {
  if (!p) return false;
  const tile = rows[p.ty]?.[p.tx];
  return tile === "." || (den && (tile === "g" || tile === "d"));
}
export function exits(
  rows: readonly string[],
  p: TilePoint,
  den = false,
): Direction[] {
  return DIRECTIONS.filter((dir) => open(rows, neighbor(rows, p, dir), den));
}
export function flood(
  rows: readonly string[],
  origin: TilePoint,
  den = true,
): number[] {
  const distances = Array<number>(C.GRID_COLS * C.GRID_ROWS).fill(-1);
  if (!open(rows, origin, den)) return distances;
  const queue = [origin];
  distances[indexOf(origin)] = 0;
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    for (const dir of exits(rows, p, den)) {
      const next = neighbor(rows, p, dir)!;
      if (distances[indexOf(next)] !== -1) continue;
      distances[indexOf(next)] = distances[indexOf(p)] + 1;
      queue.push(next);
    }
  }
  return distances;
}
export function route(
  rows: readonly string[],
  b: Body,
  goal: TilePoint,
  den = false,
): Direction | null {
  const distances = flood(rows, goal, den);
  let best: Direction | null = null;
  let cost = Infinity;
  for (const dir of exits(rows, b, den)) {
    const n = neighbor(rows, b, dir)!;
    const d = distances[indexOf(n)];
    if (d >= 0 && d < cost) {
      cost = d;
      best = dir;
    }
  }
  return best;
}
export function random(s: FathomState): number {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}
export function wander(s: FathomState, b: Body): Direction | null {
  const choices = exits(s.tiles, b);
  const forward = choices.filter((d) => d !== OPPOSITE[b.dir]);
  const list = forward.length ? forward : choices;
  return list.length ? list[Math.floor(random(s) * list.length)] : null;
}

/** Integrate to each encountered center before choosing another edge. Wrap uses
 * the same distance budget as an ordinary edge, including partial crossings. */
export function travel(
  rows: readonly string[],
  b: Body,
  units: number,
  choose: () => Direction | null,
  den = false,
  speed?: () => number,
): boolean {
  if (!open(rows, b, den)) return false;
  let moved = false;
  let seconds = speed ? units / speed() : 0;
  while (units > 1e-8) {
    const c = center(b.tx, b.ty);
    const atCenter = Math.abs(b.x - c.x) < 1e-7 && Math.abs(b.y - c.y) < 1e-7;
    if (atCenter) {
      b.x = c.x;
      b.y = c.y;
      const dir = choose();
      if (!dir || !open(rows, neighbor(rows, b, dir), den)) break;
      b.dir = dir;
    }
    // A Gloamfin loses speed at a corner. Spend the remaining time at the
    // newly chosen rate, including a center encountered partway through a tick.
    if (speed) units = seconds * speed();
    const [dx, dy] = VECTORS[b.dir];
    let toCenter = dx ? (c.x - b.x) * dx : (c.y - b.y) * dy;
    if (toCenter < 1e-7) {
      if (!open(rows, neighbor(rows, b, b.dir), den)) break;
      toCenter += C.TILE;
    }
    const step = Math.min(units, toCenter);
    b.x += dx * step;
    b.y += dy * step;
    units -= step;
    if (speed) seconds -= step / speed();
    moved = true;
    const width = C.GRID_COLS * C.TILE;
    if (b.x < C.GRID_ORIGIN_X) b.x += width;
    if (b.x >= C.GRID_ORIGIN_X + width) b.x -= width;
    locate(b);
  }
  return moved;
}

/** Grid traversal of a segment. The destination rock can be illuminated, but
 * is never transparent to another tile or to a hunter. */
export function lineClear(
  rows: readonly string[],
  a: { x: number; y: number },
  b: { x: number; y: number },
  allowEndRock = false,
): boolean {
  const ax = (a.x - C.GRID_ORIGIN_X) / C.TILE;
  const ay = (a.y - C.GRID_ORIGIN_Y) / C.TILE;
  const bx = (b.x - C.GRID_ORIGIN_X) / C.TILE;
  const by = (b.y - C.GRID_ORIGIN_Y) / C.TILE;
  let x = Math.floor(ax);
  let y = Math.floor(ay);
  const endX = Math.floor(bx);
  const endY = Math.floor(by);
  const dx = bx - ax;
  const dy = by - ay;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const deltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
  const deltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
  let maxX = dx === 0 ? Infinity : (sx > 0 ? x + 1 - ax : ax - x) * deltaX;
  let maxY = dy === 0 ? Infinity : (sy > 0 ? y + 1 - ay : ay - y) * deltaY;
  for (let guard = 0; guard < C.GRID_COLS + C.GRID_ROWS + 2; guard++) {
    if (x === endX && y === endY) return allowEndRock || rows[y]?.[x] !== "#";
    if (rows[y]?.[x] === "#" || rows[y]?.[x] === undefined) return false;
    if (Math.abs(maxX - maxY) < 1e-10) {
      if (rows[y]?.[x + sx] === "#" || rows[y + sy]?.[x] === "#") return false;
      x += sx;
      y += sy;
      maxX += deltaX;
      maxY += deltaY;
    } else if (maxX < maxY) {
      x += sx;
      maxX += deltaX;
    } else {
      y += sy;
      maxY += deltaY;
    }
  }
  return false;
}
export function segmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function makePredator(
  kind: C.PredatorKind,
  tx: number,
  ty: number,
  releaseAt: number | null,
): Predator {
  const gloam = kind === "gloamfin";
  const flare = kind === "flarefish";
  return {
    ...center(tx, ty),
    kind,
    state: releaseAt === null ? "wander" : "den",
    released: releaseAt === null,
    mind: true,
    travel: true,
    speed: C.PREDATOR_SPEED,
    alert: false,
    lit: false,
    detectRange: gloam ? null : C.LANTERN_RANGE_BASE,
    hearingRange: gloam ? C.GLOAMFIN_HEAR : null,
    hearingLock: gloam ? false : null,
    flareCharging: flare ? false : null,
    flaring: flare ? false : null,
    flareRadius: flare ? 0 : null,
    fix: null,
    linger: 0,
    alertLeft: 0,
    markLeft: 0,
    chaseSpeed: C.GLOAMFIN_CHASE_SPEED,
    pingIn: C.GLOAMFIN_PING_INTERVAL,
    sincePing: C.GLOAMFIN_PING_MIN_GAP,
    searchTime: 0,
    searchPing: false,
    flareIn: C.FLARE_INTERVAL,
    flarePhase: 0,
    fadeLeft: 0,
    releaseAt,
  };
}
export function roster(depth: number): Predator[] {
  const kinds = [
    ...C.DEN_ORDER,
    ...C.ROSTER_ADD_ORDER.slice(0, Math.min(depth, C.ROSTER_CAP_DEPTH) - 1),
  ];
  return kinds.map((kind, i) =>
    makePredator(
      kind,
      16 + (i % 4),
      8 + Math.floor(i / 4),
      i * C.DEN_RELEASE_GAP,
    ),
  );
}
export function clone(s: ReadState): FathomState {
  return {
    ...s,
    assets: s.assets as Record<string, ImageBitmap[]>,
    grid: { ...s.grid },
    sonar: { ...s.sonar },
    ink: { ...s.ink },
    tiles: [...s.tiles],
    plankton: [...s.plankton],
    visibility: [...s.visibility],
    forager: { ...s.forager },
    predators: s.predators.map((p) => ({
      ...p,
      fix: p.fix ? { ...p.fix } : null,
    })),
    drifters: s.drifters.map((d) => ({ ...d })),
    pulses: s.pulses.map((p) => ({ ...p, distances: [...p.distances] })),
    inkClouds: s.inkClouds.map((c) => ({ ...c })),
    start: { ...s.start },
    held: [...s.held],
    pending: [...s.pending],
    pointerDown: { ...s.pointerDown },
    tileMarks: [...s.tileMarks],
  };
}
export function reconcile(s: FathomState): FathomState {
  s.visionRadius = C.VISION_MIN + C.VISION_GAIN * s.brightness;
  s.windowRadius = C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * s.brightness;
  s.sonar.range = Math.max(
    C.SONAR_RANGE_MIN,
    C.SONAR_RANGE_BASE - (s.depth - 1),
  );
  s.sonar.ready = s.sonar.cooldown === 0;
  s.ink.ready = s.ink.cooldown === 0;
  s.planktonRemaining = s.plankton.join("").split("*").length - 1;
  locate(s.forager);
  for (const d of s.drifters) locate(d);
  for (const p of s.predators) {
    locate(p);
    p.speed =
      p.kind === "lanternjaw" && p.state !== "chase"
        ? C.DRIFTER_SPEED
        : p.kind === "gloamfin" && p.state === "chase"
          ? p.chaseSpeed
          : C.PREDATOR_SPEED;
    p.detectRange =
      p.kind === "gloamfin"
        ? null
        : C.LANTERN_RANGE_BASE + C.LANTERN_RANGE_GAIN * s.brightness;
    p.hearingRange = p.kind === "gloamfin" ? C.GLOAMFIN_HEAR : null;
  }
  return s;
}
export function initial(
  assets: Record<string, ImageBitmap[]> = {},
  muted = false,
): FathomState {
  const tiles = maze();
  const start = { tx: 17, ty: 13 };
  return reconcile({
    version: C.FATHOM_DEBUG_VERSION,
    screen: "title",
    menuIndex: 0,
    titleIndex: 0,
    depth: 1,
    score: 0,
    lives: C.START_LIVES,
    muted,
    planktonRemaining: 0,
    drifterIn: C.DRIFTER_INTERVAL,
    brightness: 0,
    brightHold: 0,
    visionRadius: C.VISION_MIN,
    windowRadius: C.KINDLE_VISION_MIN,
    sonar: { ready: true, cooldown: 0, range: C.SONAR_RANGE_BASE },
    ink: { ready: true, cooldown: 0 },
    grid: {
      cols: C.GRID_COLS,
      rows: C.GRID_ROWS,
      tile: C.TILE,
      originX: C.GRID_ORIGIN_X,
      originY: C.GRID_ORIGIN_Y,
    },
    tiles,
    plankton: tiles.map((row) => row.replace(/[^.]/g, "-").replace(/\./g, "*")),
    visibility: blank("u"),
    forager: { ...center(start.tx, start.ty), dir: "left", moving: false },
    predators: roster(1),
    drifters: [],
    pulses: [],
    inkClouds: [],
    simTime: 0,
    assets,
    accumulator: 0,
    screenTime: 0,
    playTime: 0,
    rng: 0xf47a01,
    start,
    desired: "left",
    held: [],
    pending: [],
    pointerDown: {},
    tileMarks: Array<number>(C.GRID_COLS * C.GRID_ROWS).fill(0),
  });
}
export function changeScreen(s: FathomState, screen: Screen): void {
  const previous = s.screen;
  s.screen = screen;
  s.screenTime = 0;
  s.pointerDown = {};
  s.menuIndex =
    screen === "title"
      ? s.titleIndex
      : screen === "paused" || screen === "gameover"
        ? 0
        : null;
  if (screen === "playing" && previous !== "paused") s.playTime = 0;
}
export function freshDive(
  s: FathomState,
  screen: "title" | "countdown",
): FathomState {
  const next = initial(s.assets, s.muted);
  next.titleIndex = s.titleIndex;
  next.simTime = s.simTime;
  next.accumulator = s.accumulator;
  changeScreen(next, screen);
  return next;
}
export function resetAttempt(s: FathomState): void {
  s.forager = { ...center(s.start.tx, s.start.ty), dir: "left", moving: false };
  s.desired = "left";
  s.brightness = 0;
  s.brightHold = 0;
  s.predators = roster(s.depth);
  s.drifters = [];
  s.drifterIn = C.DRIFTER_INTERVAL;
  s.pulses = [];
  s.inkClouds = [];
  s.sonar.cooldown = 0;
  s.ink.cooldown = 0;
  s.tileMarks.fill(0);
  s.playTime = 0;
  changeScreen(s, "countdown");
  reconcile(s);
}
