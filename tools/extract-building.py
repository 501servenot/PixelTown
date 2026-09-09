"""Cut one building out of the reference sheet and re-project it onto the game's tile angle.

The reference art is rendered at a ~46 degree camera, so its lot diamond is about
1.38:1. The game draws 128x64 tiles, i.e. 2:1. Scaling the sprite uniformly would
leave the base diamond too tall and the building would read as tilted or floating,
so width and height are scaled independently to land the lot on the game diamond.

The coordinates below were measured off one specific building in one specific
sheet; a different source needs its own measurements. Needs `pillow` and `scipy`.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SHEET = Path.home() / ".cursor/projects/Users-dp-my-project-PixelTown/assets/image-8f86c4cc-28be-4471-ba13-20d59f068573.png"
OUT_PNG = ROOT / "public/assets/buildings/glass-tower-teal.png"
OUT_META = ROOT / "public/assets/buildings/glass-tower-teal.json"

TILE_WIDTH = 128
TILE_HEIGHT = 64
FOOTPRINT_W = 2
FOOTPRINT_D = 2

# Measured on the sheet: the lot slab spans x 248..331 with its top face on row 852,
# and the building's own walls span x 262..317.
LOT_LEFT, LOT_RIGHT = 248, 331
LOT_TOP_FACE_Y = 852
LOT_SOUTH_Y = 882
WALL_LEFT, WALL_RIGHT = 262, 317
ROOF_CUT_Y = 752
# The neighbour above casts dark edges into these columns; the roof itself stops at 261..321.
SILHOUETTE_LEFT, SILHOUETTE_RIGHT = 261, 321
# Those edges are far darker than the tower's pale roof deck, so brightness separates them.
ROOF_DECK_Y = 769
ROOF_DECK_MIN_LUMA = 95
# A lit sliver of the neighbour survives that test, so the deck's right chamfer is cut by hand.
ROOF_CHAMFER = ((305, 756), 1.25)
SEED = (285, 830)
# Neighbouring lots touch this one on the sheet, so labelling is scoped to the tower's window.
WINDOW = (236, 738, 344, 900)


def build_mask(rgb: np.ndarray) -> np.ndarray:
    channels = rgb.astype(int)
    saturation = channels.max(axis=2) - channels.min(axis=2)
    luminance = channels.mean(axis=2)
    foreground = ~((saturation <= 4) & (luminance >= 24) & (luminance <= 52))

    wx0, wy0, wx1, wy1 = WINDOW
    window = np.zeros_like(foreground)
    window[wy0:wy1, wx0:wx1] = foreground[wy0:wy1, wx0:wx1]

    labels, _ = ndimage.label(window, np.ones((3, 3)))
    component = labels == labels[SEED[1], SEED[0]]
    return ndimage.binary_fill_holes(component)


def clip_to_building(mask: np.ndarray, luminance: np.ndarray) -> np.ndarray:
    """Drop the neighbour above and the concrete lot slab under the tower."""
    out = mask.copy()
    out[:ROOF_CUT_Y, :] = False
    out[:, :SILHOUETTE_LEFT] = False
    out[:, SILHOUETTE_RIGHT + 1 :] = False
    deck = slice(ROOF_CUT_Y, ROOF_DECK_Y)
    out[deck] &= luminance[deck] >= ROOF_DECK_MIN_LUMA

    (chamfer_x, chamfer_y), slope = ROOF_CHAMFER
    deck_rows = np.arange(ROOF_CUT_Y, ROOF_DECK_Y)[:, None]
    deck_cols = np.arange(mask.shape[1])[None, :]
    out[deck] &= deck_cols <= chamfer_x + slope * (deck_rows - chamfer_y)

    centre_x = (WALL_LEFT + WALL_RIGHT) / 2
    half_width = (WALL_RIGHT - WALL_LEFT) / 2
    # The base diamond keeps the sheet's own 1.38:1 ratio until we re-project below.
    half_height = half_width / ((LOT_RIGHT - LOT_LEFT) / (2 * (LOT_SOUTH_Y - LOT_TOP_FACE_Y)))

    height, width = mask.shape
    ys = np.arange(height)[:, None]
    xs = np.arange(width)[None, :]
    shrink = np.clip(1 - (ys - LOT_TOP_FACE_Y) / half_height, 0, 1)
    allowed = np.abs(xs - centre_x) <= half_width * shrink
    below = ys > LOT_TOP_FACE_Y - half_height
    out &= allowed | ~below

    labels, _ = ndimage.label(out, np.ones((3, 3)))
    out = labels == labels[SEED[1], SEED[0]]
    return ndimage.binary_fill_holes(out)


def main() -> None:
    sheet = Image.open(SHEET).convert("RGB")
    rgb = np.array(sheet)
    luminance = rgb.astype(int).mean(axis=2)
    mask = clip_to_building(build_mask(rgb), luminance)

    alpha = ndimage.gaussian_filter(mask.astype(np.float32), 0.6)
    alpha = np.clip((alpha - 0.35) / 0.4, 0, 1) * mask

    ys, xs = np.nonzero(mask)
    x0, x1 = xs.min(), xs.max() + 1
    y0, y1 = ys.min(), ys.max() + 1

    cut = np.dstack([rgb[y0:y1, x0:x1].astype(np.float32), alpha[y0:y1, x0:x1, None] * 255])

    lot_width = (LOT_RIGHT - LOT_LEFT) + 1
    lot_height = (LOT_SOUTH_Y - LOT_TOP_FACE_Y) * 2
    scale_x = (FOOTPRINT_W + FOOTPRINT_D) * (TILE_WIDTH / 2) / lot_width
    scale_y = (FOOTPRINT_W + FOOTPRINT_D) * (TILE_HEIGHT / 2) / lot_height

    target_w = max(1, round(cut.shape[1] * scale_x))
    target_h = max(1, round(cut.shape[0] * scale_y))

    # Premultiply so LANCZOS cannot pull the dark background into the silhouette.
    premul = cut.copy()
    premul[:, :, :3] *= premul[:, :, 3:4] / 255
    scaled = np.array(
        Image.fromarray(premul.astype(np.uint8), "RGBA").resize((target_w, target_h), Image.LANCZOS),
        dtype=np.float32,
    )
    a = np.clip(scaled[:, :, 3:4], 0, 255)
    rgb_out = np.where(a > 0, scaled[:, :, :3] / np.maximum(a / 255, 1e-6), 0)
    sprite = np.dstack([np.clip(rgb_out, 0, 255), a]).astype(np.uint8)

    # Ground centre of the lot, expressed in the sprite's own pixels.
    anchor_x = (LOT_LEFT + LOT_RIGHT) / 2 - x0
    anchor_y = LOT_TOP_FACE_Y - y0
    origin_x = anchor_x * scale_x / target_w
    origin_y = anchor_y * scale_y / target_h

    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(sprite, "RGBA").save(OUT_PNG)
    OUT_META.write_text(
        json.dumps(
            {
                "source": "reference city sheet, AI-generated original",
                "spriteWidth": target_w,
                "spriteHeight": target_h,
                "footprint": {"width": FOOTPRINT_W, "depth": FOOTPRINT_D},
                "origin": {"x": round(origin_x, 5), "y": round(origin_y, 5)},
                "tile": {"width": TILE_WIDTH, "height": TILE_HEIGHT},
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"sprite {target_w}x{target_h}  origin=({origin_x:.4f}, {origin_y:.4f})")
    print(f"scale x={scale_x:.4f} y={scale_y:.4f}  lot={lot_width}x{lot_height}")


if __name__ == "__main__":
    main()
