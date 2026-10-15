import type { Game, UpdateApi } from "@clockwyrks/simple-2d";
import * as C from "./constants";
import type { FathomDebugApi, FathomState, ReadState } from "./model";
import { debug } from "./debug";
import { menuItemRect, menuItems } from "./menus";
import { BACKGROUND, render } from "./render";
import { illuminate, tick } from "./simulation";
import { clone, DIRECTIONS, initial } from "./world";

export type * from "./model";
export type { PredatorKind } from "./constants";
export { BACKGROUND };

function input(s: FathomState, api: UpdateApi): void {
  if (api.input.pressed("mute")) api.audio.setMuted(!api.audio.muted());
  s.muted = api.audio.muted();
  const held = DIRECTIONS.filter((d) => api.input.value(d) > 0);
  const newest = held.filter((d) => !s.held.includes(d));
  if (newest.length) s.desired = newest[newest.length - 1];
  s.held = held;
  const actions =
    s.screen === "playing"
      ? ["a", "b", "pause"]
      : s.screen === "countdown" || s.screen === "cleared"
        ? []
        : [
            "up",
            "down",
            "confirm",
            "back",
            ...(s.screen === "paused" ? ["pause"] : []),
          ];
  for (const name of actions) if (api.input.pressed(name)) s.pending.push(name);
  for (const sample of api.input.pointerSamples()) {
    let hit = -1;
    for (let i = 0; i < menuItems(s).length; i++) {
      const r = menuItemRect(s, i)!;
      if (
        sample.x >= r.x &&
        sample.x < r.x + r.w &&
        sample.y >= r.y &&
        sample.y < r.y + r.h
      )
        hit = i;
    }
    if (hit >= 0) s.menuIndex = hit;
    if (sample.type === "down" && sample.button === "primary")
      s.pointerDown[sample.id] = s.screen === "howto" ? -2 : hit;
    if (sample.type === "up") {
      const pressed = s.pointerDown[sample.id];
      delete s.pointerDown[sample.id];
      if (
        (hit >= 0 && pressed === hit) ||
        (s.screen === "howto" && pressed === -2)
      )
        s.pending.push("confirm");
    }
  }
}

export const game: Game<FathomState, FathomDebugApi> = {
  async initialize(api) {
    for (const name of C.ACTIONS)
      api.input.register(name, { keys: [...C.BINDINGS[name]] });
    const tones = [
      [C.CUES.eat, 640, 960, 65],
      [C.CUES.sonar, 980, 140, 420],
      [C.CUES.ink, 130, 48, 260],
      [C.CUES.predatorPing, 380, 710, 260],
      [C.CUES.flare, 180, 1240, 520],
      [C.CUES.caught, 220, 38, 550],
      [C.CUES.descend, 440, 1320, 700],
    ] as const;
    for (const [cue, freq, freqTo, durationMs] of tones)
      api.audio.define(cue, {
        freq,
        freqTo,
        durationMs,
        gain: 0.12,
        wave: cue === C.CUES.caught || cue === C.CUES.ink ? "triangle" : "sine",
      });
    const sheets: readonly (readonly [string, number])[] = [
      ["glimmerfin", 8],
      ["lanternjaw", 16],
      ["gloamfin", 8],
      ["flarefish", 8],
      ["drifter", 8],
      ["flare-bloom", 8],
      ["trench-walls", 19],
    ];
    const assets = Object.fromEntries(
      await Promise.all(
        sheets.map(async ([name, count]) => [
          name,
          await Promise.all(
            Array.from({ length: count }, (_, i) =>
              api.assets.loadImage(`${name}/${i}.png`),
            ),
          ),
        ]),
      ),
    );
    for (const name of [
      "screen",
      "depth",
      "score",
      "lives",
      "brightness",
      "visionRadius",
      "windowRadius",
      "planktonRemaining",
    ] as const)
      api.diagnostics.register(name, (s) => s[name]);
    api.diagnostics.register("sonar cooldown", (s) => s.sonar.cooldown);
    api.diagnostics.register("ink cooldown", (s) => s.ink.cooldown);
    api.diagnostics.register(
      "forager",
      (s) => `${s.forager.tx},${s.forager.ty} ${s.forager.dir}`,
    );
    for (let i = 0; i < C.ROSTER_CAP * C.DEN_ORDER.length; i++)
      api.diagnostics.register(`predator ${i}`, (s) => {
        const p = s.predators[i];
        return p
          ? `${p.kind} ${p.state} ${p.tx},${p.ty} ${p.speed.toFixed(1)} alert:${p.alert}`
          : "none";
      });
    return [initial(assets), debug];
  },
  update(state: ReadState, api, dt) {
    let next = clone(state);
    input(next, api);
    next.accumulator += dt;
    while (next.accumulator + 1e-10 >= C.TICK_DT) {
      next.accumulator = Math.max(0, next.accumulator - C.TICK_DT);
      const result = tick(next);
      next = result.state;
      for (const cue of result.cues) api.audio.play(cue);
    }
    if (next.screen === "playing" || next.screen === "countdown")
      illuminate(next);
    return next;
  },
  render(s, api) {
    render(s, api.ctx);
  },
};
