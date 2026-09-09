"""Draw the needle tower as opaque 2:1 isometric pixels. No photos, no scale."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public/assets/buildings"
OUT_BASE = OUT_DIR / "needle-tower.png"
OUT_LIGHTS = OUT_DIR / "needle-tower-lights.png"
OUT_META = OUT_DIR / "needle-tower.json"
OUT_PREVIEW = Path("/tmp/bldg/needle-drawn-preview.png")
OUT_GRASS = Path("/tmp/bldg/needle-on-grass.png")

TILE_W = 256
TILE_H = 128
FOOT = 2
SEGMENTS = ("dawn", "noon", "dusk", "night")
PODIUM_H = 56
PODIUM_FLOORS = 2
SHAFT_FLOORS = 16
SHAFT_FLOOR_H = 12
SHAFT_H = SHAFT_FLOORS * SHAFT_FLOOR_H

INK = (42, 32, 26, 255)
PODIUM_S = (168, 124, 78, 255)
PODIUM_E = (214, 168, 104, 255)
PODIUM_T = (236, 200, 136, 255)
SHAFT_S = (148, 158, 168, 255)
SHAFT_E = (214, 220, 226, 255)
SHAFT_T = (236, 240, 244, 255)
WIN_OFF = (32, 40, 52, 255)
WIN_DAWN = (255, 176, 78, 255)
WIN_DUSK = (255, 198, 96, 255)
WIN_NIGHT = (255, 214, 118, 255)
BUSH_S = (46, 98, 42, 255)
BUSH_E = (74, 136, 56, 255)
BUSH_T = (102, 158, 68, 255)
METAL_S = (92, 98, 108, 255)
METAL_E = (138, 146, 156, 255)
METAL_T = (168, 176, 184, 255)
DOOR = (48, 38, 34, 255)


def hash2(x: int, y: int) -> float:
    return (((x * 374761393 + y * 668265263) * 1597334677) & 0xFFFFFFFF) / 4294967296


class Sprite:
    def __init__(self, w: int, h: int):
        self.w = w
        self.h = h
        self.px = np.zeros((h, w, 4), dtype=np.uint8)

    def put(self, x: int, y: int, c: tuple[int, int, int, int]) -> None:
        if 0 <= x < self.w and 0 <= y < self.h and c[3]:
            self.px[y, x] = c

    def clear(self, x: int, y: int) -> None:
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y, x] = 0


def project(ox: int, oy: int, i: float, j: float, k: float) -> tuple[int, int]:
    return (
        int(round(ox + (i - j) * (TILE_W / 2))),
        int(round(oy + (i + j) * (TILE_H / 2) - k)),
    )


def bbox(points: list[tuple[int, int]]) -> tuple[int, int, int, int]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def fill_south(
    spr: Sprite,
    ox: int,
    oy: int,
    i0: float,
    i1: float,
    j1: float,
    k0: float,
    k1: float,
    color: tuple[int, int, int, int],
) -> None:
    x0, y0, x1, y1 = bbox([project(ox, oy, i, j1, k) for i in (i0, i1) for k in (k0, k1)])
    for sx in range(x0, x1 + 1):
        i = j1 + (sx - ox) / (TILE_W / 2)
        if i < i0 - 0.02 or i > i1 + 0.02:
            continue
        for sy in range(y0, y1 + 1):
            k = oy + (i + j1) * (TILE_H / 2) - sy
            if k0 - 0.02 <= k <= k1 + 0.02:
                spr.put(sx, sy, color)


def fill_east(
    spr: Sprite,
    ox: int,
    oy: int,
    i1: float,
    j0: float,
    j1: float,
    k0: float,
    k1: float,
    color: tuple[int, int, int, int],
) -> None:
    x0, y0, x1, y1 = bbox([project(ox, oy, i1, j, k) for j in (j0, j1) for k in (k0, k1)])
    for sx in range(x0, x1 + 1):
        j = i1 - (sx - ox) / (TILE_W / 2)
        if j < j0 - 0.02 or j > j1 + 0.02:
            continue
        for sy in range(y0, y1 + 1):
            k = oy + (i1 + j) * (TILE_H / 2) - sy
            if k0 - 0.02 <= k <= k1 + 0.02:
                spr.put(sx, sy, color)


def fill_top(
    spr: Sprite,
    ox: int,
    oy: int,
    i0: float,
    i1: float,
    j0: float,
    j1: float,
    k1: float,
    color: tuple[int, int, int, int],
) -> None:
    x0, y0, x1, y1 = bbox([project(ox, oy, i, j, k1) for i in (i0, i1) for j in (j0, j1)])
    half_w = TILE_W / 2
    half_h = TILE_H / 2
    for sx in range(x0, x1 + 1):
        for sy in range(y0, y1 + 1):
            u = (sx - ox) / half_w
            v = (sy - oy + k1) / half_h
            i = (u + v) / 2
            j = (v - u) / 2
            if i0 - 0.02 <= i <= i1 + 0.02 and j0 - 0.02 <= j <= j1 + 0.02:
                spr.put(sx, sy, color)


def draw_box(
    spr: Sprite,
    ox: int,
    oy: int,
    i0: float,
    i1: float,
    j0: float,
    j1: float,
    k0: float,
    k1: float,
    south: tuple[int, int, int, int],
    east: tuple[int, int, int, int],
    top: tuple[int, int, int, int],
    ink: tuple[int, int, int, int],
) -> None:
    fill_south(spr, ox, oy, i0, i1, j1, k0, k1, south)
    fill_east(spr, ox, oy, i1, j0, j1, k0, k1, east)
    fill_top(spr, ox, oy, i0, i1, j0, j1, k1, top)
    for i in (i0, i1):
        for j in (j0, j1):
            x0, y0 = project(ox, oy, i, j, k0)
            x1, y1 = project(ox, oy, i, j, k1)
            for t in range(int(k1 - k0) + 1):
                spr.put(x0, y0 - t, ink)
    for t in range(int(round((i1 - i0) * TILE_W / 2)) + 1):
        u = t / max((i1 - i0) * TILE_W / 2, 1)
        i = i0 + (i1 - i0) * u
        spr.put(*project(ox, oy, i, j0, k1), ink)
        spr.put(*project(ox, oy, i, j1, k1), ink)
        spr.put(*project(ox, oy, i, j1, k0), ink)
    for t in range(int(round((j1 - j0) * TILE_W / 2)) + 1):
        u = t / max((j1 - j0) * TILE_W / 2, 1)
        j = j0 + (j1 - j0) * u
        spr.put(*project(ox, oy, i0, j, k1), ink)
        spr.put(*project(ox, oy, i1, j, k1), ink)
        spr.put(*project(ox, oy, i1, j, k0), ink)


def paint_face_windows(
    dest: Sprite,
    ox: int,
    oy: int,
    i0: float,
    i1: float,
    j0: float,
    j1: float,
    k0: float,
    k1: float,
    floors: int,
    cols: int,
    occupancy: list[bool],
    color: tuple[int, int, int, int],
    face: str,
    lit_only: bool,
    slit: int = 2,
) -> None:
    height = k1 - k0
    floor_h = height / floors
    for floor in range(floors):
        lit = occupancy[floor] if floor < len(occupancy) else False
        if lit_only and not lit:
            continue
        kz0 = k0 + floor * floor_h + max(1.0, floor_h * 0.38)
        kz1 = min(kz0 + slit, k1 - 1)
        if kz1 <= kz0:
            continue
        for col in range(cols):
            u0 = (col + 0.28) / cols
            u1 = (col + 0.72) / cols
            if face == "south":
                fill_south(dest, ox, oy, i0 + (i1 - i0) * u0, i0 + (i1 - i0) * u1, j1, kz0, kz1, color)
            else:
                fill_east(dest, ox, oy, i1, j0 + (j1 - j0) * u0, j0 + (j1 - j0) * u1, kz0, kz1, color)


def paint_floor_seams(
    dest: Sprite,
    ox: int,
    oy: int,
    i0: float,
    i1: float,
    j0: float,
    j1: float,
    k0: float,
    k1: float,
    floors: int,
    color: tuple[int, int, int, int],
) -> None:
    height = k1 - k0
    for floor in range(1, floors):
        k = k0 + floor * height / floors
        fill_south(dest, ox, oy, i0, i1, j1, k, k + 0.8, color)
        fill_east(dest, ox, oy, i1, j0, j1, k, k + 0.8, color)


def occupancy(segment: str) -> tuple[list[bool], list[bool]]:
    podium, shaft = [], []
    for i in range(PODIUM_FLOORS):
        if segment == "noon":
            podium.append(False)
        elif segment == "dawn":
            podium.append(i == 0)
        else:
            podium.append(True)
    for i in range(SHAFT_FLOORS):
        roll = hash2(i + 11, 19)
        if segment == "noon":
            shaft.append(roll < 0.04)
        elif segment == "dawn":
            shaft.append(i < 2 or roll < 0.12)
        elif segment == "dusk":
            shaft.append(i < 4 or roll < 0.5 or i % 5 == 0)
        else:
            shaft.append(roll < 0.84 and not (0.88 < roll < 0.93))
    return podium, shaft


def win_color(segment: str) -> tuple[int, int, int, int]:
    if segment == "dawn":
        return WIN_DAWN
    if segment == "dusk":
        return WIN_DUSK
    return WIN_NIGHT


def draw_scene(base: Sprite, lights: Sprite, ox: int, oy: int, segment: str) -> None:
    podium_on, shaft_on = occupancy(segment)
    glow = win_color(segment)

    # podium 2×2, k = 0..28
    p = (-1.0, 1.0, -1.0, 1.0, 0.0, float(PODIUM_H))
    draw_box(base, ox, oy, *p, PODIUM_S, PODIUM_E, PODIUM_T, INK)
    paint_floor_seams(base, ox, oy, *p, PODIUM_FLOORS, (120, 88, 54, 255))
    paint_face_windows(base, ox, oy, *p, PODIUM_FLOORS, 4, podium_on, WIN_OFF, "south", False)
    paint_face_windows(base, ox, oy, *p, PODIUM_FLOORS, 4, podium_on, WIN_OFF, "east", False)
    paint_face_windows(lights, ox, oy, *p, PODIUM_FLOORS, 4, podium_on, glow, "south", True)
    paint_face_windows(lights, ox, oy, *p, PODIUM_FLOORS, 4, podium_on, glow, "east", True)

    fill_south(base, ox, oy, 0.35, 0.62, 1.0, 4, 32, DOOR)

    draw_box(base, ox, oy, -0.96, -0.70, 0.70, 0.96, 0, 20, BUSH_S, BUSH_E, BUSH_T, (22, 48, 24, 255))
    draw_box(base, ox, oy, 0.70, 0.96, -0.96, -0.70, 0, 18, BUSH_S, BUSH_E, BUSH_T, (22, 48, 24, 255))
    draw_box(base, ox, oy, 0.62, 0.88, 0.62, 0.88, 0, 16, BUSH_S, BUSH_E, BUSH_T, (22, 48, 24, 255))

    deck = float(PODIUM_H)
    draw_box(base, ox, oy, 0.58, 0.80, -0.86, -0.64, deck, deck + 10, (186, 190, 198, 255), (226, 228, 232, 255), (240, 242, 244, 255), (70, 74, 80, 255))

    # shaft 1×1 sitting on the podium deck
    s = (-0.48, 0.48, -0.48, 0.48, float(PODIUM_H), float(PODIUM_H + SHAFT_H))
    draw_box(base, ox, oy, *s, SHAFT_S, SHAFT_E, SHAFT_T, (56, 64, 74, 255))
    paint_floor_seams(base, ox, oy, *s, SHAFT_FLOORS, (118, 126, 136, 255))
    paint_face_windows(base, ox, oy, *s, SHAFT_FLOORS, 3, shaft_on, WIN_OFF, "south", False)
    paint_face_windows(base, ox, oy, *s, SHAFT_FLOORS, 3, shaft_on, WIN_OFF, "east", False)
    paint_face_windows(lights, ox, oy, *s, SHAFT_FLOORS, 3, shaft_on, glow, "south", True)
    paint_face_windows(lights, ox, oy, *s, SHAFT_FLOORS, 3, shaft_on, WIN_NIGHT, "east", True)

    # cap + mast
    cap_k0 = float(PODIUM_H + SHAFT_H)
    draw_box(base, ox, oy, -0.54, 0.54, -0.54, 0.54, cap_k0, cap_k0 + 12, PODIUM_S, PODIUM_E, (196, 154, 96, 255), INK)
    draw_box(base, ox, oy, -0.18, 0.18, -0.18, 0.18, cap_k0 + 12, cap_k0 + 28, METAL_S, METAL_E, METAL_T, (48, 52, 58, 255))

    mast_k = cap_k0 + 28
    for n in range(14):
        stripe = (196, 44, 52, 255) if n % 2 else (236, 236, 238, 255)
        draw_box(
            base, ox, oy, -0.04, 0.04, -0.04, 0.04, mast_k, mast_k + 8,
            stripe, stripe, stripe, (40, 20, 24, 255) if n % 2 else (80, 80, 84, 255),
        )
        mast_k += 8
    draw_box(
        base, ox, oy, -0.03, 0.03, -0.03, 0.03, mast_k, mast_k + 10,
        (64, 36, 88, 255), (88, 52, 110, 255), (48, 28, 68, 255), (24, 12, 32, 255),
    )
    if segment in {"dusk", "night"}:
        tx, ty = project(ox, oy, 0, 0, mast_k + 10)
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                if dx * dx + dy * dy <= 4:
                    lights.put(tx + dx, ty + dy, (255, 52, 68, 255 if dx * dx + dy * dy <= 1 else 120))

    draw_box(base, ox, oy, -0.92, -0.64, 0.52, 0.80, deck, deck + 16, METAL_S, METAL_E, METAL_T, (40, 44, 50, 255))
    draw_box(base, ox, oy, 0.60, 0.86, 0.18, 0.44, deck, deck + 12, (186, 190, 198, 255), (226, 228, 232, 255), (240, 242, 244, 255), (70, 74, 80, 255))


def main() -> None:
    pad = 8
    width = FOOT * TILE_W + pad * 2
    # north tip of lot is oy-64; mast adds ~70 above podium+shaft
    height = PODIUM_H + SHAFT_H + 90 + TILE_H + pad * 2
    ox = width // 2
    oy = height - pad - TILE_H // 2

    frames: list[np.ndarray] = []
    base_px = None
    for segment in SEGMENTS:
        base = Sprite(width, height)
        lights = Sprite(width, height)
        draw_scene(base, lights, ox, oy, segment)
        if base_px is None:
            base_px = base.px.copy()
        frames.append(lights.px.copy())

    assert base_px is not None
    ys, xs = np.nonzero(base_px[:, :, 3])
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    if (x1 - x0) % 2:
        x1 = min(base_px.shape[1], x1 + 1)
    if (y1 - y0) % 2:
        y1 = min(base_px.shape[0], y1 + 1)
    base_cut = base_px[y0:y1, x0:x1].copy()
    base_cut[base_cut[:, :, 3] > 0, 3] = 255
    light_cuts = []
    for frame in frames:
        cut = frame[y0:y1, x0:x1].copy()
        cut[cut[:, :, 3] < 40] = 0
        light_cuts.append(cut)
    sheet = np.concatenate(light_cuts, axis=1)

    origin_x = (ox - x0) / base_cut.shape[1]
    origin_y = (oy - y0) / base_cut.shape[0]
    sw, sh = int(base_cut.shape[1]), int(base_cut.shape[0])

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(base_cut).save(OUT_BASE)
    Image.fromarray(sheet).save(OUT_LIGHTS)
    OUT_META.write_text(
        json.dumps(
            {
                "id": "needle-tower",
                "source": "procedural 2:1 isometric pixel draw",
                "spriteWidth": sw,
                "spriteHeight": sh,
                "worldScale": 0.5,
                "footprint": {"width": 2, "depth": 2},
                "origin": {"x": round(origin_x, 5), "y": round(origin_y, 5)},
                "tile": {"width": 128, "height": 64},
                "lights": {"url": "assets/buildings/needle-tower-lights.png", "frames": list(SEGMENTS)},
                "floors": PODIUM_FLOORS + SHAFT_FLOORS,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    preview = np.zeros((sh, sw * 4, 4), dtype=np.uint8)
    for i, glow in enumerate(light_cuts):
        col = preview[:, i * sw : (i + 1) * sw]
        col[:] = base_cut
        a = glow[:, :, 3:4].astype(np.float32) / 255
        col[:, :, :3] = np.clip(col[:, :, :3].astype(np.float32) * (1 - a * 0.35) + glow[:, :, :3] * a, 0, 255)
        col[:, :, 3] = 255
    OUT_PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(preview).convert("RGB").save(OUT_PREVIEW)

    grass = np.zeros((sh + 24, sw + 24, 4), dtype=np.uint8)
    grass[:, :] = (86, 140, 72, 255)
    gy, gx = 14, 12
    mask = base_cut[:, :, 3] > 0
    grass[gy : gy + sh, gx : gx + sw][mask] = base_cut[mask]
    Image.fromarray(grass).save(OUT_GRASS)
    print(f"base {sw}x{sh} origin=({origin_x:.5f},{origin_y:.5f}) lot=({ox - x0},{oy - y0})")


if __name__ == "__main__":
    main()
