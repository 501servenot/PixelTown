"""Emerald glass tower: curtain wall, stone podium, setback wing, roof kit."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from iso_building import (
    SEGMENTS,
    Sprite,
    canvas_for,
    draw_box,
    export_building,
    fill_south,
    fill_top,
    fill_top_disk,
    hash2,
    paint_curtain,
    project,
    rgb,
    set_scale,
)

set_scale(2)

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public/assets/buildings"

INK = rgb(28, 32, 38)
MULLION = rgb(24, 32, 40)
STONE_S = rgb(186, 168, 142)
STONE_E = rgb(226, 210, 184)
STONE_T = rgb(240, 228, 204)
ROOF = rgb(58, 64, 72)
ROOF_E = rgb(78, 86, 96)
ROOF_T = rgb(92, 100, 110)
METAL_S = rgb(90, 98, 108)
METAL_E = rgb(140, 148, 158)
METAL_T = rgb(168, 176, 186)
BUSH_S = rgb(40, 92, 48)
BUSH_E = rgb(62, 128, 68)
BUSH_T = rgb(86, 154, 78)
PAD_S = rgb(52, 58, 64)
PAD_E = rgb(72, 80, 88)
PAD_T = rgb(48, 54, 60)
HELIPAD = rgb(36, 102, 64)
HELIPAD_H = rgb(236, 240, 244)
WIN_DAWN = rgb(255, 186, 96)
WIN_DUSK = rgb(255, 208, 120)
WIN_NIGHT = rgb(255, 220, 140)
LOBBY_LIT = rgb(255, 228, 170)

PODIUM_H = 64
PODIUM_FLOORS = 3
WING_FLOORS = 16
WING_H = WING_FLOORS * 12
SHAFT_FLOORS = 42
SHAFT_H = SHAFT_FLOORS * 12
CROWN_FLOORS = 12
CROWN_H = CROWN_FLOORS * 12
CAP_H = 16
SPIRE_H = 56


def glass_tone(face: str, floor: int, col: int) -> tuple[int, int, int, int]:
    band = 0.70 + 0.30 * (0.5 + 0.5 * __import__("math").sin(col * 1.15 + 0.35))
    jitter = 0.88 + 0.12 * hash2(floor + 3, col + 11)
    t = band * jitter
    if face == "south":
        return rgb(int(22 * t + 8), int(58 * t + 14), int(74 * t + 18))
    return rgb(int(48 * t + 18), int(96 * t + 28), int(118 * t + 32))


def pane_lit(segment: str, floor: int, col: int, lobby: bool = False) -> bool:
    roll = hash2(floor + 19, col + 4)
    if lobby:
        if segment == "noon":
            return roll < 0.15
        if segment == "dawn":
            return True
        return True
    if segment == "noon":
        return roll < 0.04
    if segment == "dawn":
        return floor < 3 or roll < 0.14
    if segment == "dusk":
        return roll < 0.48 or floor % 4 == 0
    return roll < 0.80 and not (0.86 < roll < 0.91)


def lit_color(segment: str) -> tuple[int, int, int, int]:
    if segment == "dawn":
        return WIN_DAWN
    if segment == "dusk":
        return WIN_DUSK
    return WIN_NIGHT


def draw_scene(base: Sprite, lights: Sprite, ox: int, oy: int, segment: str) -> None:
    glow = lit_color(segment)

    # stone podium 2×2
    draw_box(base, ox, oy, -1.0, 1.0, -1.0, 1.0, 0, PODIUM_H, STONE_S, STONE_E, STONE_T, INK)

    def lobby_base(floor: int, col: int, face: str):
        return rgb(30, 48, 62) if face == "south" else rgb(54, 86, 104)

    paint_curtain(base, ox, oy, -1.0, 1.0, -1.0, 1.0, 12, PODIUM_H - 8, PODIUM_FLOORS, 7, "south", lambda f, c: lobby_base(f, c, "south"))
    paint_curtain(base, ox, oy, -1.0, 1.0, -1.0, 1.0, 12, PODIUM_H - 8, PODIUM_FLOORS, 7, "east", lambda f, c: lobby_base(f, c, "east"))
    paint_curtain(lights, ox, oy, -1.0, 1.0, -1.0, 1.0, 12, PODIUM_H - 8, PODIUM_FLOORS, 7, "south", lambda f, c: LOBBY_LIT if pane_lit(segment, f, c, lobby=True) else None, lit_only=True)
    paint_curtain(lights, ox, oy, -1.0, 1.0, -1.0, 1.0, 12, PODIUM_H - 8, PODIUM_FLOORS, 7, "east", lambda f, c: LOBBY_LIT if pane_lit(segment, f, c, lobby=True) else None, lit_only=True)

    fill_south(base, ox, oy, 0.18, 0.52, 1.0, 4, 36, rgb(36, 32, 30))
    draw_box(base, ox, oy, 0.10, 0.60, 0.86, 1.02, 36, 44, rgb(210, 214, 218), rgb(232, 234, 238), rgb(244, 246, 248), rgb(70, 74, 80))

    draw_box(base, ox, oy, -0.96, -0.68, 0.68, 0.96, 0, 16, BUSH_S, BUSH_E, BUSH_T, rgb(20, 48, 26))
    draw_box(base, ox, oy, 0.68, 0.96, -0.96, -0.68, 0, 14, BUSH_S, BUSH_E, BUSH_T, rgb(20, 48, 26))
    draw_box(base, ox, oy, 0.70, 0.94, 0.70, 0.94, 0, 12, BUSH_S, BUSH_E, BUSH_T, rgb(20, 48, 26))

    for i in (0.72, 0.82, 0.92):
        draw_box(base, ox, oy, i, i + 0.03, 0.92, 0.96, 16, 52, rgb(228, 230, 234), rgb(240, 242, 246), rgb(248, 250, 252), rgb(80, 84, 90))

    deck = float(PODIUM_H)
    # mid-rise shoulder on the NW, then the tall shaft from the lot centre
    wing = (-0.96, 0.12, -0.96, 0.12, deck, deck + WING_H)
    draw_box(base, ox, oy, *wing, MULLION, rgb(32, 42, 52), ROOF_T, INK)
    paint_curtain(base, ox, oy, *wing, WING_FLOORS, 6, "south", lambda f, c: glass_tone("south", f, c))
    paint_curtain(base, ox, oy, *wing, WING_FLOORS, 6, "east", lambda f, c: glass_tone("east", f + 3, c))
    paint_curtain(lights, ox, oy, *wing, WING_FLOORS, 6, "south", lambda f, c: glow if pane_lit(segment, f, c) else None, lit_only=True)
    paint_curtain(lights, ox, oy, *wing, WING_FLOORS, 6, "east", lambda f, c: glow if pane_lit(segment, f, c + 3) else None, lit_only=True)
    draw_box(base, ox, oy, -0.96, 0.12, -0.96, 0.12, deck + WING_H, deck + WING_H + 10, ROOF, ROOF_E, ROOF_T, INK)

    shaft = (-0.58, 0.58, -0.58, 0.58, deck, deck + SHAFT_H)
    draw_box(base, ox, oy, *shaft, MULLION, rgb(34, 44, 54), ROOF_T, INK)
    paint_curtain(base, ox, oy, *shaft, SHAFT_FLOORS, 8, "south", lambda f, c: glass_tone("south", f, c))
    paint_curtain(base, ox, oy, *shaft, SHAFT_FLOORS, 8, "east", lambda f, c: glass_tone("east", f, c))
    paint_curtain(lights, ox, oy, *shaft, SHAFT_FLOORS, 8, "south", lambda f, c: glow if pane_lit(segment, f + 8, c) else None, lit_only=True)
    paint_curtain(lights, ox, oy, *shaft, SHAFT_FLOORS, 8, "east", lambda f, c: glow if pane_lit(segment, f + 8, c + 2) else None, lit_only=True)

    crown_k0 = deck + SHAFT_H
    crown = (-0.36, 0.36, -0.36, 0.36, crown_k0, crown_k0 + CROWN_H)
    draw_box(base, ox, oy, *crown, MULLION, rgb(34, 44, 54), ROOF_T, INK)
    paint_curtain(base, ox, oy, *crown, CROWN_FLOORS, 4, "south", lambda f, c: glass_tone("south", f + 40, c))
    paint_curtain(base, ox, oy, *crown, CROWN_FLOORS, 4, "east", lambda f, c: glass_tone("east", f + 40, c))
    paint_curtain(lights, ox, oy, *crown, CROWN_FLOORS, 4, "south", lambda f, c: glow if pane_lit(segment, f + 50, c) else None, lit_only=True)
    paint_curtain(lights, ox, oy, *crown, CROWN_FLOORS, 4, "east", lambda f, c: glow if pane_lit(segment, f + 50, c + 1) else None, lit_only=True)

    cap_k0 = crown_k0 + CROWN_H
    draw_box(base, ox, oy, -0.42, 0.42, -0.42, 0.42, cap_k0, cap_k0 + CAP_H, ROOF, ROOF_E, ROOF_T, INK)

    roof = cap_k0 + CAP_H
    draw_box(base, ox, oy, -0.28, 0.00, 0.04, 0.30, roof, roof + 14, METAL_S, METAL_E, METAL_T, rgb(40, 44, 50))
    draw_box(base, ox, oy, 0.04, 0.28, 0.08, 0.32, roof, roof + 10, METAL_S, METAL_E, METAL_T, rgb(40, 44, 50))
    fill_top_disk(base, ox, oy, 0.08, -0.04, roof, 0.16, HELIPAD)
    fill_top(base, ox, oy, 0.02, 0.05, -0.12, 0.04, roof, HELIPAD_H)
    fill_top(base, ox, oy, 0.11, 0.14, -0.12, 0.04, roof, HELIPAD_H)
    fill_top(base, ox, oy, 0.02, 0.14, -0.06, -0.03, roof, HELIPAD_H)

    draw_box(base, ox, oy, -0.22, 0.10, -0.38, -0.28, roof, roof + 24, rgb(22, 56, 68), rgb(36, 86, 102), rgb(48, 70, 82), INK)
    if segment in {"dusk", "night"}:
        fill_south(lights, ox, oy, -0.18, 0.06, -0.28, roof + 4, roof + 20, rgb(80, 220, 210, 180))

    draw_box(base, ox, oy, -0.05, 0.05, -0.05, 0.05, roof, roof + SPIRE_H, rgb(160, 40, 48), rgb(200, 56, 64), rgb(120, 28, 36), rgb(40, 12, 16))
    if segment in {"dusk", "night"}:
        tx, ty = project(ox, oy, 0, 0, roof + SPIRE_H)
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                if dx * dx + dy * dy <= 4:
                    lights.put(tx + dx, ty + dy, rgb(255, 52, 68, 255 if dx * dx + dy * dy <= 1 else 110))


def main() -> None:
    max_k = PODIUM_H + SHAFT_H + CROWN_H + CAP_H + SPIRE_H
    width, height, ox, oy = canvas_for(2, max_k, extra_up=16)
    frames = []
    base_px = None
    for segment in SEGMENTS:
        base = Sprite(width, height)
        lights = Sprite(width, height)
        draw_scene(base, lights, ox, oy, segment)
        if base_px is None:
            base_px = base.px.copy()
        frames.append(lights.px.copy())
    assert base_px is not None
    export_building(
        "glass-tower-teal",
        base_px,
        frames,
        ox,
        oy,
        OUT_DIR,
        floors=PODIUM_FLOORS + SHAFT_FLOORS + CROWN_FLOORS,
    )


if __name__ == "__main__":
    main()
