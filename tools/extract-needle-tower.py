"""Extract the needle tower, scale it to a 2x 2×2 lot, and bake time-of-day lights.

The source is already drawn at a 2:1 camera, so we scale uniformly. The atlas is
stored at 2x (lot 512px wide) and drawn at worldScale 0.5 so zooming in still
has extra pixels. Lights are a 4-frame sheet: dawn, noon, dusk, night.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SHEET = Path.home() / ".cursor/projects/Users-dp-my-project-PixelTown/assets/image-d335db8a-cfdf-43cc-ad38-618c2bae8db3.png"
OUT_DIR = ROOT / "public/assets/buildings"
OUT_BASE = OUT_DIR / "needle-tower.png"
OUT_LIGHTS = OUT_DIR / "needle-tower-lights.png"
OUT_META = OUT_DIR / "needle-tower.json"
OUT_PREVIEW = Path("/tmp/bldg/needle-atlas-preview.png")

TILE_WIDTH = 128
TILE_HEIGHT = 64
FOOTPRINT_W = 2
FOOTPRINT_D = 2
PIXELS_PER_TILE = 2  # store 2x, draw at 0.5
FLOOR_COUNT = 18
SEGMENTS = ("dawn", "noon", "dusk", "night")


def hash2(x: int, y: int) -> float:
    n = ((x * 374761393 + y * 668265263) * 1597334677) & 0xFFFFFFFF
    return n / 4294967296


def flood_background(rgb: np.ndarray) -> np.ndarray:
    """White (and the 3-row scanline junk at the top) connected to the border."""
    luma = rgb.astype(np.float32).mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    near_white = (luma >= 246) & (sat <= 14)
    near_white[:3] = True

    h, w = near_white.shape
    seed = np.zeros_like(near_white)
    seed[0, :] = near_white[0, :]
    seed[-1, :] = near_white[-1, :]
    seed[:, 0] = near_white[:, 0]
    seed[:, -1] = near_white[:, -1]

    labeled, _ = ndimage.label(near_white, np.ones((3, 3)))
    keep = np.zeros_like(near_white)
    for y, x in zip(*np.nonzero(seed)):
        if labeled[y, x]:
            keep |= labeled == labeled[y, x]
    return ~keep


def unmultiply_white(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Pull residual white fringe out of semi-transparent edge pixels."""
    a = np.clip(alpha, 0, 1)[..., None]
    premul = rgb.astype(np.float32) * a
    # Reconstruct as if composited over white, then undo.
    over_white = premul + 255 * (1 - a)
    rgb_out = np.where(a > 0.08, (over_white - 255 * (1 - a)) / np.maximum(a, 1e-4), 0)
    return np.clip(rgb_out, 0, 255)


def matte(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    fg = flood_background(rgb)
    fg = ndimage.binary_fill_holes(fg)
    # Soften the silhouette one pixel so LANCZOS does not stair-step.
    alpha = ndimage.gaussian_filter(fg.astype(np.float32), 0.45)
    alpha = np.clip((alpha - 0.2) / 0.6, 0, 1) * np.maximum(fg, ndimage.binary_dilation(fg, iterations=1))
    rgb_out = unmultiply_white(rgb, alpha)
    # Drop the white halo that LANCZOS pulls from the sheet background.
    edge = fg ^ ndimage.binary_erosion(fg, iterations=1)
    luma = rgb_out.mean(axis=2)
    halo = edge & (luma > 232)
    alpha = alpha.copy()
    alpha[halo] = 0
    rgb_out[halo] = 0
    return rgb_out, alpha


def measure_lot(alpha: np.ndarray) -> tuple[float, float, float, float]:
    """Equator of the ground diamond: widest near-opaque row in the lower third."""
    solid = alpha > 0.4
    h, w = solid.shape
    best_y, best_span, best_left, best_right = 0, 0, 0, w - 1
    for y in range(int(h * 0.55), h):
        cols = np.where(solid[y])[0]
        if len(cols) < 8:
            continue
        span = cols.max() - cols.min()
        if span > best_span:
            best_y, best_span, best_left, best_right = y, span, int(cols.min()), int(cols.max())
    cx = (best_left + best_right) / 2
    return cx, float(best_y), float(best_right - best_left + 1), float((best_right - best_left + 1) / 2)


def scale_sprite(rgb: np.ndarray, alpha: np.ndarray, scale: float) -> np.ndarray:
    h, w = alpha.shape
    target_w = max(1, round(w * scale))
    target_h = max(1, round(h * scale))
    premul = np.dstack([rgb * alpha[..., None], alpha * 255])
    scaled = np.array(
        Image.fromarray(premul.astype(np.uint8), "RGBA").resize((target_w, target_h), Image.Resampling.LANCZOS),
        dtype=np.float32,
    )
    a = np.clip(scaled[:, :, 3:4] / 255, 0, 1)
    color = np.where(a > 0, scaled[:, :, :3] / np.maximum(a, 1e-4), 0)
    return np.dstack([np.clip(color, 0, 255), np.clip(a * 255, 0, 255)]).astype(np.uint8)


def shaft_bounds(alpha: np.ndarray, lot_y: float) -> tuple[int, int, int, int]:
    solid = alpha > 0.35
    h, w = solid.shape
    widths = []
    for y in range(h):
        cols = np.where(solid[y])[0]
        widths.append((int(cols.min()), int(cols.max()), int(cols.max() - cols.min() + 1)) if len(cols) else (0, 0, 0))
    # Antenna is skinny; shaft is the tall run of medium width above the podium.
    shaft_rows = [y for y, (_, _, ww) in enumerate(widths) if 70 < ww < 380 and y < lot_y - 20]
    if not shaft_rows:
        shaft_rows = [y for y, (_, _, ww) in enumerate(widths) if ww > 40 and y < lot_y - 20]
    y0, y1 = min(shaft_rows), max(shaft_rows) + 1
    left = min(widths[y][0] for y in range(y0, y1) if widths[y][2])
    right = max(widths[y][1] for y in range(y0, y1) if widths[y][2])
    return left, y0, right, y1


def ridge_xs(luma: np.ndarray, alpha: np.ndarray, x0: int, y0: int, x1: int, y1: int) -> np.ndarray:
    """Per-row x of the vertical corner between the dark and lit faces."""
    ridges = np.full(y1 - y0, (x0 + x1) / 2, dtype=np.float32)
    for i, y in enumerate(range(y0, y1)):
        cols = np.where(alpha[y, x0:x1] > 0.35)[0]
        if len(cols) < 6:
            continue
        row = luma[y, x0 + cols[0] : x0 + cols[-1] + 1]
        if row.size < 6:
            continue
        ridges[i] = x0 + cols[0] + int(np.argmax(np.abs(np.diff(row.astype(np.float32)))))
    # Smooth so lights do not jitter between floors.
    if ridges.size >= 5:
        ridges = ndimage.uniform_filter(ridges, size=7)
    return ridges


def paint_windows(
    canvas: np.ndarray,
    alpha: np.ndarray,
    luma: np.ndarray,
    floors: list[bool],
    antenna: bool,
    lot_y: float,
) -> None:
    h, w = alpha.shape
    x0, y0, x1, y1 = shaft_bounds(alpha, lot_y)
    ridges = ridge_xs(luma, alpha, x0, y0, x1, y1)
    band = (y1 - y0) / max(len(floors), 1)
    inset = max(3, (x1 - x0) // 22)
    slit = max(2, round(band * 0.28))
    pitch = 6

    for index, on in enumerate(floors):
        if not on:
            continue
        mid = y0 + (index + 0.62) * band
        top = int(mid - slit / 2)
        bot = int(mid + slit / 2)
        for y in range(max(y0, top), min(y1, bot + 1)):
            ridge = ridges[y - y0]
            for side, color in (
                (np.arange(w) < ridge, (255, 148, 48, 190)),
                (np.arange(w) >= ridge, (255, 206, 96, 220)),
            ):
                span = (alpha[y] > 0.45) & side
                xs = np.where(span)[0]
                if len(xs) < 5:
                    continue
                lo, hi = int(xs.min() + inset), int(xs.max() - inset)
                if hi <= lo:
                    continue
                for x in range(lo, hi):
                    if (x - lo) % pitch < pitch - 2:
                        canvas[y, x] = color

    # Podium slits: dark pixels on the tan base become warm lights.
    podium = (np.arange(h)[:, None] > y1) & (alpha > 0.4)
    dark = podium & (luma < 78) & (luma > 18)
    if dark.any() and any(floors[:3]):
        canvas[dark] = (255, 188, 96, 230)

    if antenna:
        tip = alpha[: max(12, y0)]
        ys, xs = np.nonzero(tip > 0.35)
        if len(ys):
            tip_y = int(ys.min())
            tip_x = int(np.round(np.mean(xs[ys <= tip_y + 2])))
            yy, xx = np.ogrid[:h, :w]
            dist = np.sqrt((xx - tip_x) ** 2 + (yy - tip_y) ** 2)
            glow = dist <= 5
            strength = np.clip(230 - dist * 42, 0, 255).astype(np.uint8)
            stronger = glow & (strength > canvas[:, :, 3])
            canvas[stronger] = np.stack(
                [
                    np.full(stronger.sum(), 255),
                    np.full(stronger.sum(), 46),
                    np.full(stronger.sum(), 62),
                    strength[stronger],
                ],
                axis=1,
            )


def occupancy_for(segment: str, floors: int) -> list[bool]:
    on: list[bool] = []
    for i in range(floors):
        roll = hash2(i + 3, 11)
        if segment == "noon":
            on.append(roll < 0.05 or i == floors - 1 and roll < 0.2)
        elif segment == "dawn":
            on.append(i < 3 or roll < 0.14)
        elif segment == "dusk":
            on.append(i < 5 or roll < 0.55 or i % 4 == 0)
        else:
            on.append(roll < 0.78 and not (0.86 < roll < 0.93))
    return on


def main() -> None:
    rgb = np.array(Image.open(SHEET).convert("RGB"))
    color, alpha = matte(rgb)
    ys, xs = np.nonzero(alpha > 0.08)
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    color, alpha = color[y0:y1, x0:x1], alpha[y0:y1, x0:x1]

    cx, lot_y, lot_w, _lot_h = measure_lot(alpha)
    world_lot_w = (FOOTPRINT_W + FOOTPRINT_D) * (TILE_WIDTH / 2)
    target_lot_w = world_lot_w * PIXELS_PER_TILE
    scale = target_lot_w / lot_w

    sprite = scale_sprite(color, alpha, scale)
    sh, sw = sprite.shape[0], sprite.shape[1]
    lot_y_s = lot_y * scale
    cx_s = cx * scale
    origin_x = cx_s / sw
    origin_y = lot_y_s / sh

    luma = sprite[:, :, :3].astype(np.float32).mean(axis=2)
    alpha_s = sprite[:, :, 3].astype(np.float32) / 255

    frames: list[np.ndarray] = []
    for segment in SEGMENTS:
        lights = np.zeros((sh, sw, 4), dtype=np.uint8)
        paint_windows(
            lights,
            alpha_s,
            luma,
            occupancy_for(segment, FLOOR_COUNT),
            antenna=segment in {"dusk", "night"},
            lot_y=lot_y_s,
        )
        # Soft bloom so ADD blend reads as glow instead of hard rectangles.
        glow = ndimage.gaussian_filter(lights.astype(np.float32), sigma=(0.45, 0.45, 0))
        glow[:, :, 3] *= 0.55
        merged = np.clip(lights.astype(np.float32) + glow * 0.4, 0, 255).astype(np.uint8)
        frames.append(merged)

    sheet = np.concatenate(frames, axis=1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(sprite, "RGBA").save(OUT_BASE)
    Image.fromarray(sheet, "RGBA").save(OUT_LIGHTS)
    OUT_META.write_text(
        json.dumps(
            {
                "id": "needle-tower",
                "source": "isometric needle tower reference, extracted and re-lit",
                "spriteWidth": sw,
                "spriteHeight": sh,
                "worldScale": 1 / PIXELS_PER_TILE,
                "footprint": {"width": FOOTPRINT_W, "depth": FOOTPRINT_D},
                "origin": {"x": round(origin_x, 5), "y": round(origin_y, 5)},
                "tile": {"width": TILE_WIDTH, "height": TILE_HEIGHT},
                "lights": {
                    "url": "assets/buildings/needle-tower-lights.png",
                    "frames": list(SEGMENTS),
                },
                "floors": FLOOR_COUNT,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    preview = np.zeros((sh, sw * 4, 4), dtype=np.uint8)
    for i, lights in enumerate(frames):
        preview[:, i * sw : (i + 1) * sw, :] = sprite
        src = lights.astype(np.float32)
        a = src[:, :, 3:4] / 255
        dest = preview[:, i * sw : (i + 1) * sw, :3].astype(np.float32)
        preview[:, i * sw : (i + 1) * sw, :3] = np.clip(dest + src[:, :, :3] * a, 0, 255)
        preview[:, i * sw : (i + 1) * sw, 3] = 255
    OUT_PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(preview, "RGBA").convert("RGB").save(OUT_PREVIEW)
    print(f"base {sw}x{sh}  origin=({origin_x:.4f}, {origin_y:.4f})  scale={scale:.3f}  lot={lot_w:.1f}->{target_lot_w:.0f}")
    print(f"lights {sheet.shape[1]}x{sheet.shape[0]}  wrote {OUT_PREVIEW}")


if __name__ == "__main__":
    main()
