import * as C from "./constants";
import type { ReadState, Rect } from "./model";

export function menuItems(s: Pick<ReadState, "screen">): readonly string[] {
  return s.screen === "title"
    ? C.TITLE_ITEMS
    : s.screen === "paused"
      ? C.PAUSE_ITEMS
      : s.screen === "gameover"
        ? C.GAMEOVER_ITEMS
        : [];
}
export function menuItemRect(s: ReadState, index: number): Rect | null {
  if (!Number.isInteger(index) || index < 0 || index >= menuItems(s).length)
    return null;
  return {
    x: s.screen === "title" ? 104 : 450,
    y: (s.screen === "title" ? 400 : 355) + index * 62,
    w: 360,
    h: 50,
  };
}
