/// <reference types="node" />
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import {
  ConstantClock,
  createEngine,
  SequenceClock,
} from "@clockwyrks/simple-2d";
import type { Engine, Game } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import { BACKGROUND, game } from "./game";
import type { FathomDebugApi, FathomState, ReadState } from "./game";
import {
  blank,
  center,
  clone,
  exits,
  flood,
  indexOf,
  initial,
  lineClear,
  maze,
  neighbor,
  put,
  sameTile,
} from "./world";
import { debug } from "./debug";
import { illuminate } from "./simulation";

type TestEngine = Engine<FathomState, FathomDebugApi>;
const engines: TestEngine[] = [];
const cache = new Map<string, Promise<Response>>();
beforeAll(() => {
  vi.stubGlobal("fetch", async (url: string) => {
    if (!cache.has(url))
      cache.set(
        url,
        readFile(new URL(`../${url}`, import.meta.url)).then(
          (bytes) => new Response(bytes),
        ),
      );
    return (await cache.get(url)!).clone();
  });
  vi.stubGlobal("createImageBitmap", async (blob: Blob) =>
    loadImage(Buffer.from(await blob.arrayBuffer())),
  );
});
afterEach(() => {
  for (const e of engines) e.destroy();
  engines.length = 0;
});
afterAll(() => vi.unstubAllGlobals());

async function harness(step = 1000 / C.TICK_HZ, draw = false) {
  const events = new EventTarget();
  const canvas = createCanvas(C.STAGE_W, C.STAGE_H);
  const testGame: Game<FathomState, FathomDebugApi> = {
    ...game,
    render: draw ? game.render : () => {},
  };
  const engine = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: C.STAGE_W,
    height: C.STAGE_H,
    game: testGame,
    background: BACKGROUND,
    clock: new ConstantClock(step),
    layout: C.LAYOUT,
    surface: {
      cssWidth: () => C.STAGE_W,
      cssHeight: () => C.STAGE_H,
      dpr: () => 1,
      events: () => events,
    },
  });
  engines.push(engine);
  await engine.initialize();
  const key = (code: string, down = true) =>
    events.dispatchEvent(
      Object.assign(new Event(down ? "keydown" : "keyup"), {
        code,
        repeat: false,
      }),
    );
  const press = async (code: string) => {
    key(code);
    await engine.advance(1);
    key(code, false);
  };
  const pose = (fn: (d: FathomDebugApi, s: ReadState) => FathomState) =>
    engine.apply((s) => fn(engine.debug, s));
  return { engine, key, press, pose, events, canvas };
}
function fixture(paths: [number, number][]): string[] {
  const rows = blank("#");
  for (const [x, y] of paths) put(rows, x, y, ".");
  return rows;
}
function hall(y = 4): string[] {
  return fixture(Array.from({ length: 30 }, (_, i) => [i + 1, y]));
}
async function scenario() {
  const h = await harness();
  h.pose((d, s) => d.setMaze(s, hall()));
  h.pose((d, s) => d.clearPlankton(s));
  h.pose((d, s) => d.clearPredators(s));
  h.pose((d, s) => d.setForagerTile(s, 3, 4));
  h.pose((d, s) => d.setScreen(s, "playing"));
  return h;
}

describe("the laid-out trench", () => {
  it("is mirrored, single-width, connected and has no dead ends", () => {
    const rows = maze();
    const distances = flood(rows, initial().start, false);
    let count = 0;
    let neighborCount = 0;
    const corridors: { tx: number; ty: number }[] = [];
    for (let ty = 0; ty < C.GRID_ROWS; ty++)
      for (let tx = 0; tx < C.GRID_COLS; tx++) {
        const t = rows[ty][tx];
        const mirror = rows[ty][C.GRID_COLS - 1 - tx];
        if (!/[dg]/.test(t + mirror)) expect(t).toBe(mirror);
        if (t !== ".") continue;
        count++;
        const p = { tx, ty };
        corridors.push(p);
        const degree = exits(rows, p).length;
        neighborCount += degree;
        expect(degree).toBeGreaterThanOrEqual(2);
        expect(distances[indexOf(p)]).toBeGreaterThanOrEqual(0);
        expect(
          rows[ty]?.[tx + 1] === "." &&
            rows[ty + 1]?.[tx] === "." &&
            rows[ty + 1]?.[tx + 1] === ".",
        ).toBe(false);
      }
    const seen = new Set<number>();
    const runs: number[] = [];
    for (const p of corridors) {
      if (seen.has(indexOf(p)) || exits(rows, p).length !== 2) continue;
      const q = [p];
      seen.add(indexOf(p));
      for (let i = 0; i < q.length; i++)
        for (const dir of exits(rows, q[i])) {
          const n = neighbor(rows, q[i], dir)!;
          if (!seen.has(indexOf(n)) && exits(rows, n).length === 2) {
            seen.add(indexOf(n));
            q.push(n);
          }
        }
      runs.push(q.length);
    }
    const meanRun = runs.reduce((a, b) => a + b, 0) / runs.length;
    expect(neighborCount / count).toBeGreaterThanOrEqual(C.MAZE_OPENNESS_MIN);
    expect(neighborCount / count).toBeLessThanOrEqual(C.MAZE_OPENNESS_MAX);
    expect(
      count / ((C.GRID_COLS - 2) * (C.GRID_ROWS - 2)),
    ).toBeGreaterThanOrEqual(C.MAZE_DENSITY_MIN);
    expect(meanRun).toBeGreaterThanOrEqual(C.MAZE_MAZING_MIN);
    expect(meanRun).toBeLessThanOrEqual(C.MAZE_MAZING_MAX);
    expect(rows.filter((r) => r[0] === ".")).toHaveLength(1);
    expect(rows.join("").split("g")).toHaveLength(2);
    for (let ty = 7; ty <= 9; ty++)
      for (let tx = 16; tx <= 19; tx++) {
        expect(rows[ty][tx]).toBe("d");
        expect(exits(rows, { tx, ty })).toHaveLength(0);
        expect(
          flood(rows, initial().start)[indexOf({ tx, ty })],
        ).toBeGreaterThan(0);
      }
  });
});

describe("engine integration and menus", () => {
  it("loads all art, initializes the full JSON snapshot, and registers readable diagnostics", async () => {
    const { engine } = await harness();
    const snap = engine.debug.snapshot(engine.state);
    expect(engine.state.assets["trench-walls"]).toHaveLength(19);
    expect(Object.values(engine.state.assets).flat()).toHaveLength(75);
    expect(snap).toMatchObject({
      version: C.FATHOM_DEBUG_VERSION,
      screen: "title",
      score: 0,
      lives: C.START_LIVES,
      menuIndex: 0,
      titleIndex: 0,
    });
    expect(snap.visibility.join("")).toBe(
      "u".repeat(C.GRID_COLS * C.GRID_ROWS),
    );
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    expect(engine.diagnostics().every((v) => v.error === undefined)).toBe(true);
    expect(engine.diagnostics().map((v) => v.name)).toContain("windowRadius");
  });
  it("wraps menus, remembers how-to selection, and starts a fresh counted dive", async () => {
    const h = await harness();
    await h.press("ArrowUp");
    expect(h.engine.state.menuIndex).toBe(1);
    await h.press("Enter");
    expect(h.engine.state.screen).toBe("howto");
    await h.press("Escape");
    expect(h.engine.state.menuIndex).toBe(1);
    expect(h.engine.state.titleIndex).toBe(1);
    await h.press("ArrowDown");
    await h.press("Enter");
    expect(h.engine.state.screen).toBe("countdown");
    expect(h.engine.state.predators.every((p) => !p.released)).toBe(true);
    await h.engine.advance(C.TICK_HZ * 2 - 1);
    expect(h.engine.state.screen).toBe("playing");
    expect(h.engine.state.predators.every((p) => !p.released)).toBe(true);
    await h.engine.advance(1);
    expect(h.engine.state.predators[0].released).toBe(true);
  });
  it("Escape pauses once, freezes the world and resumes once; restart resets the run", async () => {
    const h = await scenario();
    await h.press("Escape");
    expect(h.engine.state.screen).toBe("paused");
    const before = h.engine.debug.snapshot(h.engine.state);
    await h.engine.advance(C.TICK_HZ);
    const after = h.engine.debug.snapshot(h.engine.state);
    expect({ ...after, simTime: 0 }).toEqual({ ...before, simTime: 0 });
    await h.press("Escape");
    expect(h.engine.state.screen).toBe("playing");
    await h.press("KeyP");
    await h.press("ArrowDown");
    await h.press("Enter");
    expect(h.engine.state.screen).toBe("countdown");
    expect(h.engine.state.tiles).toEqual(maze());
  });
  it("pointer and touch confirmation require both edges in the same region", async () => {
    const h = await harness();
    const send = (type: string, x: number, y: number, device = "mouse") =>
      h.events.dispatchEvent(
        Object.assign(new Event(type), {
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: device,
          isPrimary: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
        }),
      );
    send("pointerdown", 120, 420);
    send("pointerup", 120, 480);
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("title");
    expect(h.engine.state.menuIndex).toBe(1);
    send("pointerdown", 120, 480, "touch");
    send("pointerup", 120, 480, "touch");
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("howto");
    send("pointerdown", 1000, 600);
    send("pointerup", 1000, 600);
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("title");
    expect(h.engine.state.menuIndex).toBe(1);
  });
  it("renders all seven screens with the real engine and canvas", async () => {
    const h = await harness(1000 / C.TICK_HZ, true);
    for (const screen of [
      "title",
      "howto",
      "countdown",
      "playing",
      "paused",
      "cleared",
      "gameover",
    ] as const) {
      h.pose((d, s) => d.setScreen(s, screen));
      await h.engine.advance(1);
      expect(
        h.canvas
          .getContext("2d")
          .getImageData(0, 0, C.STAGE_W, C.STAGE_H)
          .data.some((v) => v > 0),
      ).toBe(true);
    }
  });
});

describe("fixed-step travel, feeding and progression", () => {
  it("moves at a constant rate, stops on release and reverses between centers", async () => {
    const h = await scenario();
    const start = h.engine.state.forager.x;
    h.key("ArrowRight");
    await h.engine.advance(15);
    expect(h.engine.state.forager.x).toBeCloseTo(
      start + C.FORAGER_SPEED * 15 * C.TICK_DT,
    );
    h.key("ArrowLeft");
    await h.engine.advance(1);
    expect(h.engine.state.forager.dir).toBe("left");
    h.key("ArrowRight", false);
    h.key("ArrowLeft", false);
    const x = h.engine.state.forager.x;
    await h.engine.advance(60);
    expect(h.engine.state.forager.x).toBe(x);
    expect(h.engine.state.forager.moving).toBe(false);
  });
  it("buffers a perpendicular turn until the center of a junction", async () => {
    const h = await scenario();
    const rows = hall();
    for (let y = 4; y <= 8; y++) put(rows, 5, y, ".");
    h.pose((d, s) => d.setMaze(s, rows));
    h.key("ArrowRight");
    await h.engine.advance(40);
    h.key("ArrowDown");
    await h.engine.advance(15);
    expect(h.engine.state.forager.dir).toBe("right");
    expect(h.engine.state.forager.y).toBe(center(3, 4).y);
    await h.engine.advance(20);
    expect(h.engine.state.forager.dir).toBe("down");
    expect(h.engine.state.forager.x).toBe(center(5, 4).x);
  });
  it("crosses the wrap continuously without a snap or speed change", async () => {
    const h = await scenario();
    const rows = blank("#");
    rows[4] = ".".repeat(C.GRID_COLS);
    h.pose((d, s) => d.setMaze(s, rows));
    h.pose((d, s) => d.setForagerTile(s, 0, 4));
    h.key("ArrowLeft");
    await h.engine.advance(16);
    expect(h.engine.state.forager.x).toBeCloseTo(
      C.GRID_ORIGIN_X + C.GRID_COLS * C.TILE - C.FORAGER_SPEED * C.TICK_DT,
    );
    await h.engine.advance(14);
    expect(h.engine.state.forager.x).toBeCloseTo(center(35, 4).x);
  });
  it("integrates the same simulation under uneven frame subdivision", async () => {
    const a = await scenario();
    const b = await scenario();
    a.key("ArrowRight");
    b.key("ArrowRight");
    a.engine.setClock(new ConstantClock(1000 / 60));
    b.engine.setClock(new SequenceClock([5, 11, 34]));
    await a.engine.advance(60);
    await b.engine.advance(60);
    expect(a.engine.debug.snapshot(a.engine.state)).toEqual(
      b.engine.debug.snapshot(b.engine.state),
    );
  });
  it("eats on entry, holds brightness, then halves on the specified curve", async () => {
    const h = await scenario();
    h.pose((d, s) => d.setPlankton(s, 3, 4, true));
    h.pose((d, s) => d.setPlankton(s, 20, 4, true));
    const cues: string[] = [];
    h.engine.events.on("cue:played", (e) => cues.push(e.cue));
    await h.engine.advance(1);
    expect(h.engine.state.score).toBe(C.SCORE_PLANKTON);
    expect(h.engine.state.brightness).toBe(C.BRIGHT_PER_EAT);
    expect(h.engine.state.brightHold).toBe(C.BRIGHT_HOLD);
    await h.engine.advance(C.TICK_HZ);
    expect(h.engine.state.brightness).toBeCloseTo(C.BRIGHT_PER_EAT);
    await h.engine.advance(C.BRIGHT_HALFLIFE * C.TICK_HZ);
    expect(h.engine.state.brightness).toBeCloseTo(C.BRIGHT_PER_EAT / 2);
    expect(cues).toEqual([C.CUES.eat]);
  });
  it("only eating the final mote clears a maze, awards the bonus and descends fresh", async () => {
    const h = await scenario();
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("playing");
    h.pose((d, s) => d.setPlankton(s, 3, 4, true));
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("cleared");
    expect(h.engine.state.score).toBe(C.SCORE_PLANKTON + C.SCORE_CLEAR);
    await h.engine.advance(C.TICK_HZ * 2);
    expect(h.engine.state).toMatchObject({
      screen: "countdown",
      depth: 2,
      lives: C.START_LIVES,
    });
    expect(h.engine.state.predators).toHaveLength(4);
    expect(h.engine.state.planktonRemaining).toBeGreaterThan(200);
  });
  it("returns creatures to the den on contact while preserving food, score and memory", async () => {
    const h = await scenario();
    await h.engine.advance(1);
    h.pose((d, s) => d.setScore(s, 123));
    h.pose((d, s) => d.addPredator(s, "lanternjaw", 3, 4));
    h.pose((d, s) => d.setPredatorMind(s, 0, false));
    await h.engine.advance(1);
    expect(h.engine.state).toMatchObject({
      screen: "countdown",
      lives: C.START_LIVES - 1,
      score: 123,
    });
    expect(h.engine.state.planktonRemaining).toBe(0);
    expect(h.engine.state.visibility.join("")).toContain("r");
    expect(
      h.engine.state.predators.every((p) => p.state === "den" && !p.released),
    ).toBe(true);
  });
  it("ends only when caught with no reserve, and game-over back restores the title", async () => {
    const h = await scenario();
    h.pose((d, s) => d.setLives(s, 0));
    h.pose((d, s) => d.addPredator(s, "flarefish", 3, 4));
    await h.engine.advance(1);
    expect(h.engine.state.screen).toBe("gameover");
    await h.press("Escape");
    expect(h.engine.state).toMatchObject({
      screen: "title",
      depth: 1,
      score: 0,
      lives: C.START_LIVES,
    });
  });
});

describe("senses, sonar and ink", () => {
  it("rock blocks light while the first rock face is illuminated; a window reveals nothing", async () => {
    const h = await scenario();
    const rows = hall();
    put(rows, 5, 4, "#");
    h.pose((d, s) => d.setMaze(s, rows));
    await h.engine.advance(1);
    expect(h.engine.state.visibility[4][5]).toBe("l");
    expect(h.engine.state.visibility[4][6]).toBe("u");
    expect(h.engine.state.visibility[4][8]).toBe("u");
    expect(lineClear(rows, center(3, 4), center(6, 4))).toBe(false);
  });
  it("retains revealed terrain when the outer window shrinks or the forager moves", async () => {
    const h = await scenario();
    await h.engine.advance(1);
    h.pose((d, s) => d.setForagerTile(s, 20, 4));
    await h.engine.advance(1);
    expect(h.engine.state.visibility[4][3]).toBe("r");
    h.pose((d, s) => d.clearFog(s));
    h.pose((d, s) => d.reconcile(s));
    expect(h.engine.state.visibility.join("")).not.toContain("r");
  });
  it("sonar floods around a corner at arrival time and never exposes amber bodies", async () => {
    const h = await scenario();
    const rows = fixture([
      [3, 4],
      [4, 4],
      [5, 4],
      [5, 5],
      [5, 6],
      [5, 7],
      [5, 8],
      [6, 8],
      [7, 8],
    ]);
    h.pose((d, s) => d.setMaze(s, rows));
    h.pose((d, s) => d.addPredator(s, "gloamfin", 5, 8));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    h.pose((d, s) => d.addPredator(s, "lanternjaw", 6, 8));
    h.pose((d, s) => d.setPredatorMind(s, 1, false));
    h.pose((d, s) => d.spawnDrifter(s, 7, 8));
    h.pose((d, s) => d.setDrifterMind(s, 0, false));
    await h.press("Space");
    expect(h.engine.state.predators[0].state).toBe("wander");
    await h.engine.advance(55);
    expect(h.engine.state.predators[0]).toMatchObject({
      state: "chase",
      lit: true,
      alert: true,
    });
    expect(h.engine.state.predators[1].lit).toBe(false);
    expect(h.engine.state.drifters[0].lit).toBe(false);
    expect(h.engine.state.visibility[8][5]).toBe("l");
    expect(h.engine.state.sonar.ready).toBe(false);
    await h.engine.advance(130);
    expect(h.engine.state.sonar.ready).toBe(true);
  });
  it("ink drops a light-hunter fix immediately but leaves close hearing intact", async () => {
    const h = await scenario();
    h.pose((d, s) => d.addPredator(s, "lanternjaw", 5, 4));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    h.pose((d, s) => d.addPredator(s, "gloamfin", 4, 4));
    h.pose((d, s) => d.setPredatorTravel(s, 1, false));
    await h.engine.advance(1);
    expect(h.engine.state.predators[0].state).toBe("chase");
    await h.press("ShiftLeft");
    expect(h.engine.state.predators[0].state).toBe("wander");
    expect(h.engine.state.predators[1]).toMatchObject({
      state: "chase",
      hearingLock: true,
    });
    expect(h.engine.state.inkClouds[0]).toMatchObject({
      radius: C.INK_RADIUS,
      x: center(3, 4).x,
    });
    await h.engine.advance(C.TICK_HZ * C.INK_LIFE);
    expect(h.engine.state.inkClouds).toHaveLength(0);
  });
  it("muting preserves gameplay and the seven event cues", async () => {
    const h = await scenario();
    const events: { cue: string; gain: number }[] = [];
    h.engine.events.on("cue:played", (e) => events.push(e));
    await h.press("KeyM");
    await h.press("Space");
    expect(h.engine.state.muted).toBe(true);
    expect(h.engine.state.pulses).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({ cue: C.CUES.sonar, gain: 0 }),
    );
    h.pose((d, s) => d.reset(s));
    expect(h.engine.state.muted).toBe(true);
  });
});

describe("predator minds and drifters", () => {
  it("light detection grows with brightness, fires no Lanternjaw alert, and lingers two seconds", async () => {
    const h = await scenario();
    h.pose((d, s) => d.addPredator(s, "lanternjaw", 9, 4));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    await h.engine.advance(1);
    expect(h.engine.state.predators[0]).toMatchObject({
      state: "wander",
      speed: C.DRIFTER_SPEED,
      alert: false,
    });
    h.pose((d, s) => d.setBrightness(s, 1));
    h.pose((d, s) => d.setBrightHold(s, C.BRIGHT_HOLD));
    await h.engine.advance(1);
    expect(h.engine.state.predators[0]).toMatchObject({
      state: "chase",
      speed: C.PREDATOR_SPEED,
      alert: false,
    });
    h.pose((d, s) => d.setForagerTile(s, 25, 4));
    await h.engine.advance(C.TICK_HZ);
    expect(h.engine.state.predators[0].state).toBe("chase");
    await h.engine.advance(C.TICK_HZ + 1);
    expect(h.engine.state.predators[0].state).toBe("wander");
  });
  it("a den schedule releases on live time at exact five-second intervals", async () => {
    const h = await harness();
    h.pose((d, s) => d.setScreen(s, "playing"));
    for (let i = 0; i < 3; i++)
      h.pose((d, s) => d.setPredatorTravel(s, i, false));
    await h.engine.advance(1);
    expect(h.engine.state.predators.map((p) => p.released)).toEqual([
      true,
      false,
      false,
    ]);
    await h.engine.advance(C.TICK_HZ * C.DEN_RELEASE_GAP);
    expect(h.engine.state.predators.map((p) => p.released)).toEqual([
      true,
      true,
      false,
    ]);
    await h.engine.advance(C.TICK_HZ * C.DEN_RELEASE_GAP);
    expect(h.engine.state.predators.map((p) => p.released)).toEqual([
      true,
      true,
      true,
    ]);
    expect(h.engine.state.predators.every((p) => p.state === "den")).toBe(true);
  });
  it("pathfinds around rock, travels only open tiles and holds an isolated tile", async () => {
    const h = await scenario();
    const rows = fixture([
      [3, 4],
      [3, 5],
      [3, 6],
      [4, 6],
      [5, 6],
      [5, 5],
      [5, 4],
      [10, 4],
    ]);
    h.pose((d, s) => d.setMaze(s, rows));
    h.pose((d, s) => d.addPredator(s, "lanternjaw", 5, 4));
    h.pose((d, s) => d.setPredatorState(s, 0, "chase"));
    await h.engine.advance(30);
    const p = h.engine.state.predators[0];
    expect(p.y).toBeGreaterThan(center(5, 4).y);
    expect(rows[p.ty][p.tx]).toBe(".");
    h.pose((d, s) => d.setPredatorTile(s, 0, 10, 4));
    await h.engine.advance(100);
    expect(h.engine.state.predators[0].x).toBe(center(10, 4).x);
    expect(h.engine.state.predators[0].y).toBe(center(10, 4).y);
  });
  it("Gloamfin hearing ignores rock, alerts only on acquisition and stays silent under lock", async () => {
    const h = await scenario();
    const rows = hall();
    put(rows, 4, 4, "#");
    h.pose((d, s) => d.setMaze(s, rows));
    h.pose((d, s) => d.addPredator(s, "gloamfin", 5, 4));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    await h.engine.advance(1);
    expect(h.engine.state.predators[0]).toMatchObject({
      state: "chase",
      hearingLock: true,
      alert: true,
      speed: C.GLOAMFIN_CHASE_SPEED,
    });
    await h.engine.advance(C.TICK_HZ * 5);
    expect(h.engine.state.pulses).toHaveLength(0);
    expect(h.engine.state.predators[0].alert).toBe(false);
    h.pose((d, s) => d.setForagerTile(s, 10, 4));
    await h.engine.advance(1);
    expect(h.engine.state.pulses[0]).toMatchObject({
      source: "gloamfin",
      tint: "violet",
    });
  });
  it("Gloamfin corners drop its chase speed and it ramps back to the cap", async () => {
    const h = await scenario();
    const rows = fixture([
      [3, 4],
      [4, 4],
      [5, 4],
      [5, 5],
      [5, 6],
      [5, 7],
    ]);
    h.pose((d, s) => d.setMaze(s, rows));
    h.pose((d, s) => d.addPredator(s, "gloamfin", 5, 4));
    await h.engine.advance(1);
    expect(h.engine.state.predators[0].x).toBeCloseTo(
      center(5, 4).x - C.GLOAMFIN_CORNER_SPEED * C.TICK_DT,
    );
    h.pose((d, s) => d.setPredatorTile(s, 0, 5, 7));
    h.pose((d, s) => d.setPredatorState(s, 0, "chase"));
    h.pose((d, s) => d.setPredatorDir(s, 0, "up"));
    await h.engine.advance(101);
    expect(h.engine.state.predators[0].speed).toBeLessThan(
      C.GLOAMFIN_CHASE_SPEED,
    );
    expect(h.engine.state.predators[0].speed).toBeGreaterThanOrEqual(
      C.GLOAMFIN_CORNER_SPEED,
    );
  });
  it("Gloamfin searches a stale fix and casts its guaranteed orange ping", async () => {
    const h = await scenario();
    h.pose((d, s) => d.setForagerTile(s, 5, 4));
    h.pose((d, s) => d.addPredator(s, "gloamfin", 3, 4));
    h.pose((d, s) => d.setPredatorState(s, 0, "chase"));
    h.pose((d, s) => d.setForagerTile(s, 28, 4));
    await h.engine.advance(80);
    expect(h.engine.state.predators[0].state).toBe("search");
    await h.engine.advance(145);
    expect(h.engine.state.pulses.some((p) => p.tint === "orange")).toBe(true);
    await h.engine.advance(500);
    expect(h.engine.state.predators[0].state).toBe("wander");
  });
  it("Flarefish charges, blooms through rock and leaves remembered terrain when it ends", async () => {
    const h = await scenario();
    h.pose((d, s) => d.addPredator(s, "flarefish", 20, 4));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    await h.engine.advance(C.TICK_HZ * C.FLARE_INTERVAL);
    expect(h.engine.state.predators[0].flareCharging).toBe(true);
    await h.engine.advance(C.TICK_HZ * C.FLARE_CHARGE);
    expect(h.engine.state.predators[0].flaring).toBe(true);
    expect(h.engine.state.visibility[6][20]).toBe("l");
    await h.engine.advance(C.TICK_HZ * C.FLARE_BLOOM);
    expect(h.engine.state.predators[0].flaring).toBe(false);
    expect(h.engine.state.visibility[6][20]).toBe("r");
  });
  it("a moving forager can be caught during an already-burning flare, through rock", async () => {
    const h = await scenario();
    const rows = hall();
    put(rows, 16, 4, "#");
    h.pose((d, s) => d.setMaze(s, rows));
    h.pose((d, s) => d.addPredator(s, "flarefish", 20, 4));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    await h.engine.advance(
      C.TICK_HZ * (C.FLARE_INTERVAL + C.FLARE_CHARGE) + 10,
    );
    h.pose((d, s) => d.setForagerTile(s, 15, 4));
    await h.engine.advance(1);
    expect(h.engine.state.predators[0]).toMatchObject({
      state: "chase",
      alert: true,
      flaring: false,
    });
  });
  it("mind-off holds the whole creature; travel-off still permits sensing and alerts", async () => {
    const h = await scenario();
    h.pose((d, s) => d.addPredator(s, "flarefish", 5, 4));
    h.pose((d, s) => d.setPredatorMind(s, 0, false));
    await h.engine.advance(120);
    expect(h.engine.state.predators[0]).toMatchObject({
      state: "wander",
      alert: false,
      x: center(5, 4).x,
    });
    h.pose((d, s) => d.setPredatorMind(s, 0, true));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    await h.engine.advance(1);
    expect(h.engine.state.predators[0]).toMatchObject({
      state: "chase",
      alert: true,
      x: center(5, 4).x,
    });
  });
  it("admits drifters at the gate cadence, caps them, and awards the bonus on contact", async () => {
    const h = await harness();
    h.pose((d, s) => d.clearPredators(s));
    h.pose((d, s) => d.setScreen(s, "playing"));
    h.pose((d, s) => d.setDrifterIn(s, 0));
    await h.engine.advance(1);
    expect(h.engine.state.drifters).toHaveLength(1);
    h.pose((d, s) => d.setDrifterMind(s, 0, false));
    h.pose((d, s) => d.setDrifterIn(s, 0));
    await h.engine.advance(1);
    expect(h.engine.state.drifters).toHaveLength(C.DRIFTER_MAX);
    h.pose((d, s) => d.setDrifterMind(s, 1, false));
    h.pose((d, s) => d.setDrifterIn(s, 0));
    await h.engine.advance(1);
    expect(h.engine.state.drifters).toHaveLength(C.DRIFTER_MAX);
    const p = h.engine.state.drifters[0];
    const score = h.engine.state.score;
    h.pose((d, s) => d.setForagerTile(s, p.tx, p.ty));
    await h.engine.advance(1);
    expect(h.engine.state.score - score).toBeGreaterThanOrEqual(
      C.SCORE_DRIFTER,
    );
    expect(h.engine.state.drifters).toHaveLength(0);
  });
});

describe("debug poses and invariants", () => {
  it("rejects invalid domains loudly and accepts exempt fixtures unchanged", () => {
    const s = initial();
    expect(() => debug.setBrightness(s, 1.1)).toThrow(RangeError);
    expect(() => debug.setDepth(s, 0)).toThrow(RangeError);
    expect(() => debug.setLives(s, 0.5)).toThrow(RangeError);
    expect(() => debug.setMaze(s, ["."])).toThrow(RangeError);
    const rows = hall();
    put(rows, 1, 1, "d");
    expect(() => debug.setMaze(s, rows)).toThrow(RangeError);
    const open = blank(".");
    expect(debug.setMaze(s, open).tiles).toEqual(open);
    expect(() => debug.setPredatorTile(s, 4, 1, 1)).toThrow(RangeError);
    expect(() => debug.setForagerTile(s, 0, 0)).toThrow(RangeError);
    expect(debug.menuItemRect(s, 9)).toBe(null);
    expect(debug.menuItemRect(debug.setScreen(s, "playing"), 0)).toBe(null);
  });
  it("poses are immutable, reconcile is idempotent and neither lights nor advances anything", () => {
    const s = initial();
    const before = debug.snapshot(s);
    const next = debug.setBrightness(s, 0.7);
    expect(debug.snapshot(s)).toEqual(before);
    expect(next.windowRadius).toBe(
      C.KINDLE_VISION_MIN + C.KINDLE_VISION_GAIN * 0.7,
    );
    expect(debug.reconcile(next)).toEqual(
      debug.reconcile(debug.reconcile(next)),
    );
    expect(next.visibility).toEqual(s.visibility);
    expect(next.simTime).toBe(0);
    const depth = debug.setDepth(next, 999);
    expect(depth.predators).toHaveLength(C.ROSTER_CAP * C.DEN_ORDER.length);
    expect(depth.sonar.range).toBe(C.SONAR_RANGE_MIN);
  });
  it("reset restores a title-screen value while preserving the mute preference", () => {
    let s = initial();
    s.muted = true;
    s = debug.setScore(s, 500);
    s = debug.setTitleIndex(s, 1);
    s = debug.setDepth(s, 3);
    expect(debug.snapshot(debug.reset(s))).toEqual(
      debug.snapshot(initial({}, true)),
    );
  });
  it("a fixture with no den holds den occupants inert and accepts closed body positions", async () => {
    const h = await harness();
    h.pose((d, s) => d.setMaze(s, hall()));
    h.pose((d, s) => d.setScreen(s, "playing"));
    const before = h.engine.state.predators.map((p) => [p.x, p.y]);
    await h.engine.advance(C.TICK_HZ * 10);
    expect(h.engine.state.predators.map((p) => [p.x, p.y])).toEqual(before);
    expect(
      h.engine.state.predators.every((p) => !p.lit && p.state === "den"),
    ).toBe(true);
  });
  it("drawing visibility is independent of the circular rendering mask", () => {
    const s = initial();
    put(s.visibility, 1, 1, "r");
    illuminate(s);
    expect(s.visibility[1][1]).toBe("r");
    expect(sameTile(s.forager, s.start)).toBe(true);
  });
  it("cooldown and creature poses are unconditional, derived values agree, and no pose eats", () => {
    let s = initial();
    s = debug.setScreen(s, "gameover");
    s = debug.setForagerDir(s, "right");
    s = debug.setSonarCooldown(s, 27);
    s = debug.setInkCooldown(s, 15);
    expect(s.sonar).toMatchObject({ cooldown: 27, ready: false });
    expect(s.ink).toMatchObject({ cooldown: 15, ready: false });
    s = debug.setMenuIndex(s, 1);
    s = debug.setPredatorReleased(s, 0, true);
    s = debug.setPredatorTile(s, 0, 1, 1);
    s = debug.setPredatorState(s, 0, "wander");
    expect(s.predators[0]).toMatchObject({
      speed: C.DRIFTER_SPEED,
      state: "wander",
      released: true,
    });
    s = debug.setPredatorTile(s, 0, 16, 8);
    s = debug.setPredatorState(s, 0, "den");
    expect(s.predators[0]).toMatchObject({ state: "den", lit: false });
    for (let i = 0; i < 3; i++) s = debug.spawnDrifter(s, 1, 1);
    expect(s.drifters).toHaveLength(3);
    s = debug.setDrifterTravel(s, 0, false);
    const food = s.planktonRemaining;
    s = debug.setPlankton(s, 1, 1, false);
    expect(s.planktonRemaining).toBe(food - 1);
    expect(s.score).toBe(0);
    s = debug.clearDrifters(s);
    expect(s.drifters).toEqual([]);
    expect(s.screen).toBe("gameover");
    expect(() => debug.setMenuIndex(debug.setScreen(s, "howto"), 0)).toThrow(
      RangeError,
    );
  });
});

describe("the drawn Kindle window", () => {
  it("uses a true pixel-level circle over remembered terrain, leaving memory intact outside", async () => {
    const h = await harness(1000 / C.TICK_HZ, true);
    h.pose((d, s) => d.clearPredators(s));
    h.pose((d, s) => d.clearPlankton(s));
    h.pose((d, s) => d.setForagerTile(s, 17, 13));
    h.pose((d, s) => d.setScreen(s, "playing"));
    h.pose((d, s) => d.spawnDrifter(s, 23, 13));
    h.pose((d, s) => d.setDrifterMind(s, 0, false));
    h.engine.apply((s) => ({ ...clone(s), visibility: blank("r") }));
    await h.engine.advance(1);
    const ctx = h.canvas.getContext("2d");
    const f = h.engine.state.forager;
    const pixel = (x: number, y: number) => [
      ...ctx.getImageData(x, y, 1, 1).data,
    ];
    const outside = center(24, 13);
    const inside = center(22, 13);
    expect(pixel(outside.x, outside.y)).toEqual([3, 6, 12, 255]);
    expect(pixel(inside.x, inside.y)).not.toEqual([3, 6, 12, 255]);
    expect(h.engine.state.visibility[13][24]).toBe("r");
    // Both points fall in one tile, but lie on opposite sides of the circle.
    expect(pixel(f.x + 191, f.y + 8)).not.toEqual([3, 6, 12, 255]);
    expect(pixel(f.x + 195, f.y + 8)).toEqual([3, 6, 12, 255]);
  });
  it("draws active pulses, ink, alert bursts, disguises, and the three beats of a flare", async () => {
    const h = await harness(1000 / 60, true);
    h.pose((d, s) => d.clearPredators(s));
    h.pose((d, s) => d.setForagerTile(s, 13, 13));
    h.pose((d, s) => d.setScreen(s, "playing"));
    h.pose((d, s) => d.addPredator(s, "gloamfin", 13, 11));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    h.pose((d, s) => d.addPredator(s, "lanternjaw", 17, 13));
    h.pose((d, s) => d.setPredatorMind(s, 1, false));
    h.pose((d, s) => d.spawnDrifter(s, 13, 14));
    h.pose((d, s) => d.setDrifterTravel(s, 0, false));
    await h.press("Space");
    await h.press("ShiftLeft");
    await h.engine.advance(12);
    expect(h.engine.state.inkClouds).toHaveLength(1);
    expect(h.engine.state.predators[0].alert).toBe(true);
    expect(h.engine.state.pulses.some((p) => p.source === "forager")).toBe(
      true,
    );
    h.pose((d, s) => d.clearPredators(s));
    h.pose((d, s) => d.addPredator(s, "flarefish", 30, 4));
    h.pose((d, s) => d.setPredatorTravel(s, 0, false));
    h.engine.setClock(new ConstantClock(C.FLARE_INTERVAL * 1000));
    await h.engine.advance(1);
    expect(h.engine.state.predators[0].flareCharging).toBe(true);
    h.engine.setClock(new ConstantClock((C.FLARE_CHARGE * 1000) / 2));
    await h.engine.advance(2);
    expect(h.engine.state.predators[0].flaring).toBe(true);
    h.engine.setClock(new ConstantClock((C.FLARE_BLOOM * 1000) / 2));
    await h.engine.advance(2);
    expect(h.engine.state.predators[0].fadeLeft).toBeGreaterThan(0);
  });
});
