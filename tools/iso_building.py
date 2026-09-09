"""Opaque 2:1 isometric primitives for PixelTown buildings.

Lot centre is (i=0, j=0, k=0). +i is east, +j is south, +k is up in pixels.
South face is the screen-left wall; east face is the screen-right wall.
Never extract photos. Never scale. Alpha is 0 or 255.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

BASE_TILE_W = 128
BASE_TILE_H = 64
PIXEL_SCALE = 1
TILE_W = BASE_TILE_W
TILE_H = BASE_TILE_H
SEGMENTS = ("dawn", "noon", "dusk", "night")


def set_scale(scale: int) -> None:
    """Author at 2x (or more). Game still uses 128×64 tiles via worldScale 1/scale."""
    global PIXEL_SCALE, TILE_W, TILE_H
    if scale < 1:
        raise ValueError("scale must be >= 1")
    PIXEL_SCALE = scale
    TILE_W = BASE_TILE_W * scale
    TILE_H = BASE_TILE_H * scale


def hash2(x: int, y: int) -> float:
    return (((x * 374761393 + y * 668265263) * 1597334677) & 0xFFFFFFFF) / 4294967296


def rgb(r: int, g: int, b: int, a: int = 255) -> tuple[int, int, int, int]:
    return (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)), a)


class Sprite:
    def __init__(self, w: int, h: int):
        self.w = w
        self.h = h
        self.px = np.zeros((h, w, 4), dtype=np.uint8)

    def put(self, x: int, y: int, c: tuple[int, int, int, int]) -> None:
        if 0 <= x < self.w and 0 <= y < self.h and c[3]:
            self.px[y, x] = c


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
    half_w = TILE_W / 2
    half_h = TILE_H / 2
    for sx in range(x0, x1 + 1):
        i = j1 + (sx - ox) / half_w
        if i < i0 - 0.02 or i > i1 + 0.02:
            continue
        for sy in range(y0, y1 + 1):
            k = oy + (i + j1) * half_h - sy
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
    half_w = TILE_W / 2
    half_h = TILE_H / 2
    for sx in range(x0, x1 + 1):
        j = i1 - (sx - ox) / half_w
        if j < j0 - 0.02 or j > j1 + 0.02:
            continue
        for sy in range(y0, y1 + 1):
            k = oy + (i1 + j) * half_h - sy
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


def fill_top_disk(
    spr: Sprite,
    ox: int,
    oy: int,
    ic: float,
    jc: float,
    k1: float,
    radius: float,
    color: tuple[int, int, int, int],
) -> None:
    x0, y0, x1, y1 = bbox(
        [project(ox, oy, ic + di, jc + dj, k1) for di in (-radius, radius) for dj in (-radius, radius)]
    )
    half_w = TILE_W / 2
    half_h = TILE_H / 2
    r2 = radius * radius
    for sx in range(x0, x1 + 1):
        for sy in range(y0, y1 + 1):
            u = (sx - ox) / half_w
            v = (sy - oy + k1) / half_h
            i = (u + v) / 2
            j = (v - u) / 2
            if (i - ic) ** 2 + (j - jc) ** 2 <= r2:
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
        x0, y0 = project(ox, oy, i, j1, k0)
        for t in range(int(k1 - k0) + 1):
            spr.put(x0, y0 - t, ink)
    x0, y0 = project(ox, oy, i1, j0, k0)
    for t in range(int(k1 - k0) + 1):
        spr.put(x0, y0 - t, ink)
    steps_i = max(1, int(round((i1 - i0) * TILE_W / 2)))
    for t in range(steps_i + 1):
        i = i0 + (i1 - i0) * t / steps_i
        spr.put(*project(ox, oy, i, j0, k1), ink)
        spr.put(*project(ox, oy, i, j1, k1), ink)
        spr.put(*project(ox, oy, i, j1, k0), ink)
    steps_j = max(1, int(round((j1 - j0) * TILE_W / 2)))
    for t in range(steps_j + 1):
        j = j0 + (j1 - j0) * t / steps_j
        spr.put(*project(ox, oy, i0, j, k1), ink)
        spr.put(*project(ox, oy, i1, j, k1), ink)
        spr.put(*project(ox, oy, i1, j, k0), ink)


def paint_curtain(
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
    face: str,
    color_at,
    lit_only: bool = False,
) -> None:
    """Inset glass panes. `color_at(floor, col) -> rgba | None`."""
    dk = (k1 - k0) / floors
    for floor in range(floors):
        kz0 = k0 + floor * dk + 1.0
        kz1 = k0 + (floor + 1) * dk - 0.2
        if kz1 <= kz0:
            continue
        for col in range(cols):
            color = color_at(floor, col)
            if color is None:
                continue
            if lit_only and color[3] == 0:
                continue
            u0 = (col + 0.10) / cols
            u1 = (col + 0.90) / cols
            if face == "south":
                fill_south(dest, ox, oy, i0 + (i1 - i0) * u0, i0 + (i1 - i0) * u1, j1, kz0, kz1, color)
            else:
                fill_east(dest, ox, oy, i1, j0 + (j1 - j0) * u0, j0 + (j1 - j0) * u1, kz0, kz1, color)


def canvas_for(foot: int, max_k: float, extra_up: int = 24, pad: int = 8) -> tuple[int, int, int, int]:
    width = foot * TILE_W + pad * 2
    height = int(max_k) + extra_up + TILE_H + pad * 2
    ox = width // 2
    oy = height - pad - TILE_H // 2
    return width, height, ox, oy


def export_building(
    building_id: str,
    base_px: np.ndarray,
    light_frames: list[np.ndarray],
    ox: int,
    oy: int,
    out_dir: Path,
    floors: int,
    footprint: tuple[int, int] = (2, 2),
    preview_dir: Path = Path("/tmp/bldg"),
) -> dict:
    ys, xs = np.nonzero(base_px[:, :, 3])
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    base_cut = base_px[y0:y1, x0:x1].copy()
    if base_cut.shape[1] % 2:
        base_cut = np.pad(base_cut, ((0, 0), (0, 1), (0, 0)))
    if base_cut.shape[0] % 2:
        base_cut = np.pad(base_cut, ((0, 1), (0, 0), (0, 0)))
    base_cut[base_cut[:, :, 3] > 0, 3] = 255
    light_cuts = []
    for frame in light_frames:
        cut = frame[y0:y1, x0:x1].copy()
        if cut.shape[1] % 2:
            cut = np.pad(cut, ((0, 0), (0, 1), (0, 0)))
        if cut.shape[0] % 2:
            cut = np.pad(cut, ((0, 1), (0, 0), (0, 0)))
        cut[cut[:, :, 3] < 40] = 0
        light_cuts.append(cut)
    sheet = np.concatenate(light_cuts, axis=1)
    sw, sh = int(base_cut.shape[1]), int(base_cut.shape[0])
    origin_x = (ox - x0) / sw
    origin_y = (oy - y0) / sh
    out_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(base_cut).save(out_dir / f"{building_id}.png")
    Image.fromarray(sheet).save(out_dir / f"{building_id}-lights.png")
    meta = {
        "id": building_id,
        "source": "procedural 2:1 isometric pixel draw",
        "spriteWidth": sw,
        "spriteHeight": sh,
        "worldScale": 1 / PIXEL_SCALE,
        "footprint": {"width": footprint[0], "depth": footprint[1]},
        "origin": {"x": round(origin_x, 5), "y": round(origin_y, 5)},
        "tile": {"width": BASE_TILE_W, "height": BASE_TILE_H},
        "lights": {
            "url": f"assets/buildings/{building_id}-lights.png",
            "frames": list(SEGMENTS),
        },
        "floors": floors,
    }
    (out_dir / f"{building_id}.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    preview_dir.mkdir(parents=True, exist_ok=True)
    preview = np.zeros((sh, sw * 4, 4), dtype=np.uint8)
    for i, glow in enumerate(light_cuts):
        col = preview[:, i * sw : (i + 1) * sw]
        col[:] = base_cut
        a = glow[:, :, 3:4].astype(np.float32) / 255
        col[:, :, :3] = np.clip(col[:, :, :3].astype(np.float32) * (1 - a * 0.35) + glow[:, :, :3] * a, 0, 255)
        col[:, :, 3] = 255
    Image.fromarray(preview).convert("RGB").save(preview_dir / f"{building_id}-preview.png")
    grass = np.zeros((sh + 24, sw + 24, 4), dtype=np.uint8)
    grass[:, :] = (86, 140, 72, 255)
    mask = base_cut[:, :, 3] > 0
    grass[14 : 14 + sh, 12 : 12 + sw][mask] = base_cut[mask]
    Image.fromarray(grass).save(preview_dir / f"{building_id}-grass.png")

    report = validate_sprite(base_cut, light_cuts)
    print(
        f"{building_id} {sw}x{sh} origin=({origin_x:.5f},{origin_y:.5f}) "
        f"lot=({ox - x0},{oy - y0}) {report}"
    )
    return meta


def validate_sprite(base_cut: np.ndarray, light_cuts: list[np.ndarray]) -> str:
    partial = int(((base_cut[:, :, 3] > 0) & (base_cut[:, :, 3] < 255)).sum())
    leaks = 0
    opaque = base_cut[:, :, 3] > 0
    for frame in light_cuts:
        leaks += int(((frame[:, :, 3] > 0) & ~opaque).sum())
    if partial:
        raise SystemExit(f"soft alpha pixels: {partial}")
    if leaks:
        raise SystemExit(f"lights leak outside silhouette: {leaks}")
    if base_cut.shape[0] % 2 or base_cut.shape[1] % 2:
        raise SystemExit(f"odd sprite size {base_cut.shape[1]}x{base_cut.shape[0]}")
    return "ok"
