import * as C from "./constants";
import type { Body, FathomState, Predator, Pulse, TilePoint } from "./model";
import { menuItems } from "./menus";
import {
  blank,
  center,
  changeScreen,
  distance,
  exits,
  flood,
  freshDive,
  indexOf,
  lineClear,
  neighbor,
  open,
  OPPOSITE,
  put,
  random,
  reconcile,
  resetAttempt,
  route,
  sameTile,
  segmentDistance,
  travel,
  wander,
} from "./world";

export const COUNTDOWN_TIME = 2;
export const CLEAR_TIME = 2;
const down = (n: number): number => Math.max(0, n - C.TICK_DT);
type Cues = Set<C.CueName>;

function confirm(s: FathomState): FathomState {
  const index = s.menuIndex;
  if (s.screen === "title") {
    s.titleIndex = index!;
    if (index === 0) return freshDive(s, "countdown");
    changeScreen(s, "howto");
  } else if (s.screen === "paused") {
    if (index === 0) changeScreen(s, "playing");
    else return freshDive(s, index === 1 ? "countdown" : "title");
  } else if (s.screen === "gameover")
    return freshDive(s, index === 0 ? "countdown" : "title");
  return s;
}
function controls(s: FathomState, cues: Cues): FathomState {
  const actions = new Set(s.pending);
  s.pending = [];
  if (s.screen === "playing") {
    if (actions.has("pause")) {
      changeScreen(s, "paused");
      return s;
    }
    if (actions.has("a") && s.sonar.cooldown === 0) {
      cast(s, s.forager, "cyan", null);
      s.sonar.cooldown = C.SONAR_COOLDOWN;
      cues.add(C.CUES.sonar);
    }
    if (actions.has("b") && s.ink.cooldown === 0) {
      s.inkClouds.push({
        x: s.forager.x,
        y: s.forager.y,
        radius: C.INK_RADIUS,
        remaining: C.INK_LIFE,
      });
      s.ink.cooldown = C.INK_COOLDOWN;
      cues.add(C.CUES.ink);
    }
  } else if (s.screen === "howto") {
    if (actions.has("confirm") || actions.has("back"))
      return freshDive(s, "title");
  } else if (
    s.screen === "paused" &&
    (actions.has("pause") || actions.has("back"))
  )
    changeScreen(s, "playing");
  else if (s.screen === "gameover" && actions.has("back"))
    return freshDive(s, "title");
  else {
    const items = menuItems(s);
    if (items.length) {
      if (actions.has("up"))
        s.menuIndex = (s.menuIndex! + items.length - 1) % items.length;
      if (actions.has("down")) s.menuIndex = (s.menuIndex! + 1) % items.length;
      if (actions.has("confirm")) return confirm(s);
    }
  }
  return s;
}
export function cast(
  s: FathomState,
  b: TilePoint,
  tint: Pulse["tint"],
  owner: number | null,
): void {
  s.pulses.push({
    source: owner === null ? "forager" : "gloamfin",
    tint,
    ox: b.tx,
    oy: b.ty,
    front: 0,
    range: owner === null ? s.sonar.range : C.GLOAMFIN_PING_RANGE,
    owner,
    caught: false,
    distances: flood(s.tiles, b),
  });
}
function acquire(p: Predator, tile: TilePoint): void {
  if (p.state !== "chase") {
    p.chaseSpeed = C.GLOAMFIN_CHASE_SPEED;
    if (p.kind !== "lanternjaw") p.alertLeft = C.ALERT_TIME;
  }
  p.state = "chase";
  p.fix = { tx: tile.tx, ty: tile.ty };
  p.linger = C.LINGER_TIME;
  if (p.kind === "flarefish") {
    if (p.flaring) p.fadeLeft = 0.35;
    p.flareCharging = false;
    p.flaring = false;
    p.flareRadius = 0;
    p.flarePhase = 0;
  }
}
function drop(p: Predator): void {
  p.state = "wander";
  p.fix = null;
  p.linger = 0;
  if (p.kind === "flarefish") {
    p.flareIn = C.FLARE_INTERVAL;
    p.flareCharging = false;
    p.flaring = false;
    p.flareRadius = 0;
    p.flarePhase = 0;
  }
}
function waves(s: FathomState): void {
  for (const pulse of s.pulses) {
    const previous = pulse.front;
    pulse.front += C.SONAR_WAVE_SPEED * C.TICK_DT;
    const arrived = (p: TilePoint) => {
      const d = pulse.distances[indexOf(p)];
      return d >= 0 && d <= pulse.range && d >= previous && d < pulse.front;
    };
    if (pulse.source === "forager") {
      for (let ty = 0; ty < C.GRID_ROWS; ty++)
        for (let tx = 0; tx < C.GRID_COLS; tx++) {
          if (!arrived({ tx, ty })) continue;
          s.tileMarks[indexOf({ tx, ty })] = C.SONAR_MARK_TIME;
          for (const dir of ["up", "down", "left", "right"] as const) {
            const p = neighbor(s.tiles, { tx, ty }, dir);
            if (p && s.tiles[p.ty][p.tx] === "#")
              s.tileMarks[indexOf(p)] = C.SONAR_MARK_TIME;
          }
        }
      for (const p of s.predators) {
        if (p.state === "den" || !arrived(p) || p.kind === "lanternjaw")
          continue;
        p.markLeft = C.SONAR_MARK_TIME;
        if (p.kind === "gloamfin" && p.mind) acquire(p, s.forager);
      }
    } else if (!pulse.caught && arrived(s.forager)) {
      pulse.caught = true;
      const p = pulse.owner === null ? null : s.predators[pulse.owner];
      if (p?.kind === "gloamfin" && p.mind && p.state !== "den")
        acquire(p, s.forager);
    }
  }
  s.pulses = s.pulses.filter((p) => p.front <= p.range);
}
function ping(
  s: FathomState,
  p: Predator,
  i: number,
  tint: "violet" | "orange",
  cues: Cues,
): void {
  cast(s, p, tint, i);
  p.pingIn = C.GLOAMFIN_PING_INTERVAL;
  p.sincePing = 0;
  cues.add(C.CUES.predatorPing);
}
function sense(s: FathomState, p: Predator, i: number, cues: Cues): void {
  const d = distance(p, s.forager);
  if (p.kind === "gloamfin") {
    const wasLocked = p.hearingLock;
    p.hearingLock = d <= C.GLOAMFIN_HEAR;
    p.pingIn = down(p.pingIn);
    p.sincePing += C.TICK_DT;
    if (p.hearingLock) acquire(p, s.forager);
    if (wasLocked && !p.hearingLock) p.pingIn = 0;
    if (p.state === "chase") {
      p.chaseSpeed = Math.min(
        C.GLOAMFIN_CHASE_SPEED,
        p.chaseSpeed +
          ((C.GLOAMFIN_CHASE_SPEED - C.GLOAMFIN_CORNER_SPEED) * C.TICK_DT) /
            C.GLOAMFIN_RAMP_TIME,
      );
      if (
        p.fix &&
        sameTile(p, p.fix) &&
        !sameTile(p, s.forager) &&
        distance(p, center(p.tx, p.ty)) < 1e-6
      ) {
        p.state = "search";
        p.searchTime = 0;
        p.searchPing = false;
      }
    }
    if (p.state === "search") {
      p.searchTime += C.TICK_DT;
      if (p.searchTime >= C.GLOAMFIN_GIVEUP) drop(p);
    }
    if (!p.hearingLock && p.sincePing + 1e-8 >= C.GLOAMFIN_PING_MIN_GAP) {
      if (
        p.state === "search" &&
        !p.searchPing &&
        p.searchTime + 1e-8 >= C.GLOAMFIN_SEARCH_DELAY
      ) {
        ping(s, p, i, "orange", cues);
        p.searchPing = true;
      } else if (p.pingIn <= 1e-8) ping(s, p, i, "violet", cues);
    }
    return;
  }
  const blinded = s.inkClouds.some(
    (c) => segmentDistance(c, p, s.forager) <= c.radius,
  );
  if (blinded) {
    if (p.state !== "wander") drop(p);
  } else if (
    (d <= p.detectRange! && lineClear(s.tiles, p, s.forager)) ||
    (p.flaring && d <= C.FLARE_RADIUS)
  )
    acquire(p, s.forager);
  else if (p.state === "chase") {
    p.linger = down(p.linger);
    if (p.linger <= 1e-8) drop(p);
  }
  if (p.kind === "flarefish" && p.state === "wander") {
    if (p.flareCharging || p.flaring) {
      p.flarePhase += C.TICK_DT;
      if (p.flareCharging && p.flarePhase + 1e-8 >= C.FLARE_CHARGE) {
        p.flareCharging = false;
        p.flaring = true;
        p.flareRadius = C.FLARE_RADIUS;
        p.flarePhase = 0;
        cues.add(C.CUES.flare);
      } else if (p.flaring && p.flarePhase + 1e-8 >= C.FLARE_BLOOM) {
        p.flaring = false;
        p.flareRadius = 0;
        p.flareIn = C.FLARE_INTERVAL;
        p.flarePhase = 0;
        p.fadeLeft = 0.35;
      }
    } else {
      p.flareIn = down(p.flareIn);
      if (p.flareIn <= 1e-8) {
        p.flareCharging = true;
        p.flarePhase = 0;
      }
    }
    // A bloom can take its fix on the very tick it opens, through rock.
    if (!blinded && p.flaring && d <= C.FLARE_RADIUS) acquire(p, s.forager);
  }
}
function predatorTravel(s: FathomState, p: Predator): void {
  if (!p.travel) return;
  travel(
    s.tiles,
    p,
    p.speed * C.TICK_DT,
    () => {
      let dir;
      if (p.state === "den") {
        const gateRow = s.tiles.findIndex((row) => row.includes("g"));
        if (gateRow < 0) return null;
        const gate = { tx: s.tiles[gateRow].indexOf("g"), ty: gateRow };
        const goals = exits(s.tiles, gate)
          .map((d) => neighbor(s.tiles, gate, d)!)
          .filter((t) => open(s.tiles, t));
        dir = goals.length ? route(s.tiles, p, goals[0], true) : null;
      } else if (p.state === "chase" && p.fix) {
        dir = sameTile(p, p.fix) ? null : route(s.tiles, p, p.fix);
      } else if (p.state === "search" && p.fix) {
        const distances = flood(s.tiles, p.fix, false);
        const choices = exits(s.tiles, p).filter(
          (d) =>
            distances[indexOf(neighbor(s.tiles, p, d)!)] <=
            C.GLOAMFIN_SEARCH_ROAM,
        );
        const forward = choices.filter((d) => d !== OPPOSITE[p.dir]);
        const list = forward.length ? forward : choices;
        dir = list.length
          ? list[Math.floor(random(s) * list.length)]
          : route(s.tiles, p, p.fix);
      } else dir = wander(s, p);
      if (
        dir &&
        p.kind === "gloamfin" &&
        p.state === "chase" &&
        dir !== p.dir &&
        dir !== OPPOSITE[p.dir]
      ) {
        p.chaseSpeed = C.GLOAMFIN_CORNER_SPEED;
        p.speed = p.chaseSpeed;
      }
      return dir;
    },
    p.state === "den",
    () => p.speed,
  );
  if (p.state === "den" && s.tiles[p.ty][p.tx] === ".") p.state = "wander";
}
function predators(s: FathomState, cues: Cues): void {
  s.predators.forEach((p, i) => {
    if (p.releaseAt !== null && s.playTime + 1e-8 >= p.releaseAt)
      p.released = true;
    if (!p.mind) return;
    if (p.state === "den") {
      if (!p.released || !s.tiles.some((row) => row.includes("d"))) return;
    } else sense(s, p, i, cues);
    reconcilePredatorSpeed(p);
    // Reversal toward a newly acquired fix is legal between centers.
    if (p.state === "chase" && p.fix && !sameTile(p, p.fix)) {
      const toward = route(s.tiles, p, p.fix);
      if (toward === OPPOSITE[p.dir]) p.dir = toward;
    }
    predatorTravel(s, p);
  });
}
function reconcilePredatorSpeed(p: Predator): void {
  p.speed =
    p.kind === "lanternjaw" && p.state !== "chase"
      ? C.DRIFTER_SPEED
      : p.kind === "gloamfin" && p.state === "chase"
        ? p.chaseSpeed
        : C.PREDATOR_SPEED;
}
function forager(s: FathomState): void {
  const b = s.forager;
  if (!s.held.length) {
    b.moving = false;
    return;
  }
  if (s.desired === OPPOSITE[b.dir]) b.dir = s.desired;
  b.moving = travel(s.tiles, b, C.FORAGER_SPEED * C.TICK_DT, () => {
    if (open(s.tiles, neighbor(s.tiles, b, s.desired))) return s.desired;
    return open(s.tiles, neighbor(s.tiles, b, b.dir)) ? b.dir : null;
  });
}
function drifters(s: FathomState): void {
  s.drifterIn = down(s.drifterIn);
  if (
    s.drifterIn <= 1e-8 &&
    s.planktonRemaining > 0 &&
    s.drifters.length < C.DRIFTER_MAX
  ) {
    const ty = s.tiles.findIndex((row) => row.includes("g"));
    if (ty >= 0) {
      const gate = { tx: s.tiles[ty].indexOf("g"), ty };
      const dir = exits(s.tiles, gate)[0];
      const p = dir ? neighbor(s.tiles, gate, dir) : null;
      if (p) {
        s.drifters.push({
          ...center(p.tx, p.ty),
          lit: false,
          mind: true,
          travel: true,
        });
        s.drifterIn = C.DRIFTER_INTERVAL;
      }
    }
  }
  for (const d of s.drifters)
    if (d.mind && d.travel)
      travel(s.tiles, d, C.DRIFTER_SPEED * C.TICK_DT, () => wander(s, d));
}
function contact(s: FathomState, cues: Cues): void {
  if (s.predators.some((p) => p.state !== "den" && sameTile(p, s.forager))) {
    cues.add(C.CUES.caught);
    if (s.lives === 0) changeScreen(s, "gameover");
    else {
      s.lives--;
      resetAttempt(s);
    }
    return;
  }
  s.drifters = s.drifters.filter((d) => {
    if (!sameTile(d, s.forager)) return true;
    s.score += C.SCORE_DRIFTER;
    return false;
  });
  const { tx, ty } = s.forager;
  if (s.tiles[ty]?.[tx] === "." && s.plankton[ty][tx] === "*") {
    put(s.plankton, tx, ty, "-");
    s.planktonRemaining--;
    s.score += C.SCORE_PLANKTON;
    s.brightness = Math.min(1, s.brightness + C.BRIGHT_PER_EAT);
    s.brightHold = C.BRIGHT_HOLD;
    cues.add(C.CUES.eat);
    if (s.planktonRemaining === 0) {
      s.score += C.SCORE_CLEAR;
      changeScreen(s, "cleared");
      cues.add(C.CUES.descend);
    }
  }
}

export function illuminate(s: FathomState): void {
  const flares = s.predators.filter((p) => p.state !== "den" && p.flaring);
  const passive = new Set<number>();
  for (let ty = 0; ty < C.GRID_ROWS; ty++)
    for (let tx = 0; tx < C.GRID_COLS; tx++) {
      const b = center(tx, ty);
      const index = indexOf(b);
      const light =
        distance(b, s.forager) <= s.visionRadius &&
        lineClear(s.tiles, s.forager, b, true);
      if (light) passive.add(index);
      const lit =
        light ||
        s.tileMarks[index] > 0 ||
        flares.some((p) => distance(p, b) <= C.FLARE_RADIUS);
      put(
        s.visibility,
        tx,
        ty,
        lit ? "l" : s.visibility[ty][tx] === "u" ? "u" : "r",
      );
    }
  const litBody = (b: Body) =>
    passive.has(indexOf(b)) ||
    flares.some((p) => distance(p, b) <= C.FLARE_RADIUS);
  for (const p of s.predators) {
    p.alert = p.kind !== "lanternjaw" && p.alertLeft > 1e-8;
    p.lit =
      p.state !== "den" &&
      (litBody(p) || (p.kind !== "lanternjaw" && p.markLeft > 0) || p.alert);
  }
  for (const d of s.drifters) d.lit = litBody(d);
}

/** The entire world clock, independent of rendering and of frame subdivision. */
export function tick(state: FathomState): { state: FathomState; cues: Cues } {
  const cues: Cues = new Set();
  let s = controls(state, cues);
  s.simTime += C.TICK_DT;
  s.screenTime += C.TICK_DT;
  if (s.screen === "playing" || s.screen === "countdown") illuminate(s);
  if (s.screen === "countdown") {
    if (s.screenTime + 1e-8 >= COUNTDOWN_TIME) changeScreen(s, "playing");
  } else if (s.screen === "cleared") {
    if (s.screenTime + 1e-8 >= CLEAR_TIME) {
      const next = freshDive(s, "countdown");
      next.depth = s.depth + 1;
      next.score = s.score;
      next.lives = s.lives;
      resetAttempt(next);
      next.visibility = blank("u");
      s = next;
    }
  } else if (s.screen === "playing") {
    s.sonar.cooldown = down(s.sonar.cooldown);
    s.ink.cooldown = down(s.ink.cooldown);
    if (s.sonar.cooldown < 1e-8) s.sonar.cooldown = 0;
    if (s.ink.cooldown < 1e-8) s.ink.cooldown = 0;
    const decayTime = Math.max(0, C.TICK_DT - s.brightHold);
    s.brightHold = down(s.brightHold);
    s.brightness *= 0.5 ** (decayTime / C.BRIGHT_HALFLIFE);
    s.tileMarks = s.tileMarks.map(down);
    s.inkClouds = s.inkClouds
      .map((c) => ({ ...c, remaining: down(c.remaining) }))
      .filter((c) => c.remaining > 1e-8);
    reconcile(s);
    for (const p of s.predators) {
      p.markLeft = down(p.markLeft);
      p.alertLeft = down(p.alertLeft);
      p.fadeLeft = down(p.fadeLeft);
    }
    forager(s);
    waves(s);
    predators(s, cues);
    drifters(s);
    contact(s, cues);
    s.playTime += C.TICK_DT;
  }
  reconcile(s);
  if (s.screen === "playing" || s.screen === "countdown") illuminate(s);
  return { state: s, cues };
}
