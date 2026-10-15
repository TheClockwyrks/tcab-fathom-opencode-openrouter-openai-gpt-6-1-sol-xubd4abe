import * as C from "./constants";
import type {
  Direction,
  FathomDebugApi,
  FathomState,
  ReadState,
  Snapshot,
  TilePoint,
} from "./model";
import { menuItemRect, menuItems } from "./menus";
import {
  blank,
  center,
  changeScreen,
  clone,
  DIRECTIONS,
  flood,
  initial,
  makePredator,
  open,
  put,
  reconcile,
  roster,
} from "./world";

function valid(
  test: boolean,
  message = "Invalid debug argument",
): asserts test {
  if (!test) throw new RangeError(message);
}
function number(n: number, min = 0, max = Infinity, integer = false): void {
  valid(
    Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (!integer || Number.isInteger(n)),
  );
}
function boolean(b: boolean): void {
  valid(typeof b === "boolean");
}
function direction(d: Direction): void {
  valid(DIRECTIONS.includes(d));
}
function tile(s: ReadState, tx: number, ty: number, den = false): TilePoint {
  number(tx, 0, C.GRID_COLS - 1, true);
  number(ty, 0, C.GRID_ROWS - 1, true);
  valid(open(s.tiles, { tx, ty }, den), "Tile is closed to this creature");
  return { tx, ty };
}
function pose(s: ReadState, edit: (next: FathomState) => void): FathomState {
  const next = clone(s);
  edit(next);
  return reconcile(next);
}
function predator(s: FathomState, index: number) {
  number(index, 0, s.predators.length - 1, true);
  return s.predators[index];
}
function drifter(s: FathomState, index: number) {
  number(index, 0, s.drifters.length - 1, true);
  return s.drifters[index];
}
export function snapshot(s: ReadState): Snapshot {
  return {
    version: s.version,
    screen: s.screen,
    menuIndex: s.menuIndex,
    titleIndex: s.titleIndex,
    depth: s.depth,
    score: s.score,
    lives: s.lives,
    muted: s.muted,
    planktonRemaining: s.planktonRemaining,
    drifterIn: s.drifterIn,
    brightness: s.brightness,
    brightHold: s.brightHold,
    visionRadius: s.visionRadius,
    windowRadius: s.windowRadius,
    sonar: { ...s.sonar },
    ink: { ...s.ink },
    grid: { ...s.grid },
    tiles: [...s.tiles],
    plankton: [...s.plankton],
    visibility: [...s.visibility],
    forager: { ...s.forager },
    drifters: s.drifters.map((d) => ({
      x: d.x,
      y: d.y,
      tx: d.tx,
      ty: d.ty,
      lit: d.lit,
      mind: d.mind,
      travel: d.travel,
    })),
    predators: s.predators.map((p) => ({
      kind: p.kind,
      x: p.x,
      y: p.y,
      tx: p.tx,
      ty: p.ty,
      dir: p.dir,
      state: p.state,
      released: p.released,
      mind: p.mind,
      travel: p.travel,
      speed: p.speed,
      alert: p.alert,
      lit: p.lit,
      detectRange: p.detectRange,
      hearingRange: p.hearingRange,
      hearingLock: p.hearingLock,
      flareCharging: p.flareCharging,
      flaring: p.flaring,
      flareRadius: p.flareRadius,
    })),
    pulses: s.pulses.map((p) => ({
      source: p.source,
      tint: p.tint,
      ox: p.ox,
      oy: p.oy,
      front: p.front,
      range: p.range,
    })),
    inkClouds: s.inkClouds.map((c) => ({ ...c })),
    simTime: s.simTime,
  };
}
export const debug: FathomDebugApi = {
  version: C.FATHOM_DEBUG_VERSION,
  reset: (s) => initial(s.assets as Record<string, ImageBitmap[]>, s.muted),
  snapshot,
  reconcile: (s) => reconcile(clone(s)),
  setScreen: (s, screen) =>
    pose(s, (n) => {
      valid(
        [
          "title",
          "howto",
          "countdown",
          "playing",
          "paused",
          "cleared",
          "gameover",
        ].includes(screen),
      );
      changeScreen(n, screen);
    }),
  setMenuIndex: (s, index) =>
    pose(s, (n) => {
      number(index, 0, menuItems(s).length - 1, true);
      n.menuIndex = index;
    }),
  setTitleIndex: (s, index) =>
    pose(s, (n) => {
      number(index, 0, C.TITLE_ITEMS.length - 1, true);
      n.titleIndex = index;
    }),
  menuItemRect,
  setScore: (s, points) =>
    pose(s, (n) => {
      number(points, 0, Infinity, true);
      n.score = points;
    }),
  setLives: (s, lives) =>
    pose(s, (n) => {
      number(lives, 0, Infinity, true);
      n.lives = lives;
    }),
  setDepth: (s, depth) =>
    pose(s, (n) => {
      number(depth, 1, Infinity, true);
      n.depth = depth;
      n.predators = roster(depth);
    }),
  setMaze: (s, rows) =>
    pose(s, (n) => {
      valid(
        Array.isArray(rows) &&
          rows.length === C.GRID_ROWS &&
          rows.every(
            (row) =>
              typeof row === "string" &&
              row.length === C.GRID_COLS &&
              /^[#.dg]+$/.test(row),
          ),
        "Invalid maze layout",
      );
      const all = rows.join("");
      const gates = all.split("g").length - 1;
      valid(!/[dg]/.test(all) || gates === 1, "A den needs exactly one gate");
      n.tiles = [...rows];
      for (const p of n.pulses)
        p.distances = flood(n.tiles, { tx: p.ox, ty: p.oy });
    }),
  setPlankton: (s, tx, ty, present) =>
    pose(s, (n) => {
      tile(s, tx, ty);
      boolean(present);
      put(n.plankton, tx, ty, present ? "*" : "-");
    }),
  clearPlankton: (s) =>
    pose(s, (n) => {
      n.plankton = blank("-");
    }),
  clearFog: (s) =>
    pose(s, (n) => {
      n.visibility = blank("u");
      n.tileMarks.fill(0);
    }),
  setForagerTile: (s, tx, ty) =>
    pose(s, (n) => {
      tile(s, tx, ty);
      n.forager = { ...center(tx, ty), dir: s.forager.dir, moving: false };
    }),
  setForagerDir: (s, dir) =>
    pose(s, (n) => {
      direction(dir);
      n.forager.dir = dir;
      n.desired = dir;
      n.forager.moving = false;
    }),
  setBrightness: (s, g) =>
    pose(s, (n) => {
      number(g, 0, 1);
      n.brightness = g;
    }),
  setBrightHold: (s, seconds) =>
    pose(s, (n) => {
      number(seconds, 0, C.BRIGHT_HOLD);
      n.brightHold = seconds;
    }),
  clearPredators: (s) =>
    pose(s, (n) => {
      n.predators = [];
    }),
  addPredator: (s, kind, tx, ty) =>
    pose(s, (n) => {
      valid(C.DEN_ORDER.includes(kind));
      tile(s, tx, ty);
      n.predators.push(makePredator(kind, tx, ty, null));
    }),
  setPredatorTile: (s, index, tx, ty) =>
    pose(s, (n) => {
      tile(s, tx, ty, true);
      Object.assign(predator(n, index), center(tx, ty), {
        dir: predator(n, index).dir,
      });
    }),
  setPredatorDir: (s, index, dir) =>
    pose(s, (n) => {
      direction(dir);
      predator(n, index).dir = dir;
    }),
  setPredatorState: (s, index, value) =>
    pose(s, (n) => {
      const p = predator(n, index);
      valid(["den", "wander", "chase"].includes(value));
      valid(
        value === "den"
          ? /[dg]/.test(n.tiles[p.ty][p.tx])
          : n.tiles[p.ty][p.tx] === ".",
      );
      p.state = value;
      p.fix = value === "chase" ? { tx: n.forager.tx, ty: n.forager.ty } : null;
      p.linger = value === "chase" ? C.LINGER_TIME : 0;
      p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
      p.alert = false;
      p.alertLeft = 0;
      p.hearingLock = p.kind === "gloamfin" ? false : null;
      if (p.kind === "flarefish") {
        p.flareCharging = false;
        p.flaring = false;
        p.flareRadius = 0;
        p.flarePhase = 0;
        p.flareIn = C.FLARE_INTERVAL;
      }
    }),
  setPredatorReleased: (s, i, b) =>
    pose(s, (n) => {
      boolean(b);
      predator(n, i).released = b;
    }),
  setPredatorMind: (s, i, b) =>
    pose(s, (n) => {
      boolean(b);
      predator(n, i).mind = b;
    }),
  setPredatorTravel: (s, i, b) =>
    pose(s, (n) => {
      boolean(b);
      predator(n, i).travel = b;
    }),
  spawnDrifter: (s, tx, ty) =>
    pose(s, (n) => {
      tile(s, tx, ty);
      n.drifters.push({
        ...center(tx, ty),
        lit: false,
        mind: true,
        travel: true,
      });
    }),
  clearDrifters: (s) =>
    pose(s, (n) => {
      n.drifters = [];
    }),
  setDrifterMind: (s, i, b) =>
    pose(s, (n) => {
      boolean(b);
      drifter(n, i).mind = b;
    }),
  setDrifterTravel: (s, i, b) =>
    pose(s, (n) => {
      boolean(b);
      drifter(n, i).travel = b;
    }),
  setDrifterIn: (s, seconds) =>
    pose(s, (n) => {
      number(seconds, 0, C.DRIFTER_INTERVAL);
      n.drifterIn = seconds;
    }),
  setSonarCooldown: (s, seconds) =>
    pose(s, (n) => {
      number(seconds);
      n.sonar.cooldown = seconds;
    }),
  setInkCooldown: (s, seconds) =>
    pose(s, (n) => {
      number(seconds);
      n.ink.cooldown = seconds;
    }),
};
