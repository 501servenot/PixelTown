"""Import one TheoTown 4x4 tower at nearest-neighbor 4x. Local trial only."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

SRC = Path("/Users/dp/Downloads/JPpackcom04-06-2025/base/com_4x4_tokyo27_RF.png")
OUT = Path("public/assets/buildings")
BUILDING_ID = "tokyo-tower"
SCALE = 4
FOOT_W, FOOT_D = 4, 4
SEGMENTS = ("dawn", "noon", "dusk", "night")


def hash2(x: int, y: int) -> float:
    return (((x * 374761393 + y * 668265263) * 1597334677) & 0xFFFFFFFF) / 4294967296


def harden(px: np.ndarray) -> np.ndarray:
    out = px.copy()
    out[out[:, :, 3] > 0, 3] = 255
    out[out[:, :, 3] == 0] = 0
    return out


def glass_mask(px: np.ndarray) -> np.ndarray:
    r = px[:, :, 0].astype(np.int16)
    g = px[:, :, 1].astype(np.int16)
    b = px[:, :, 2].astype(np.int16)
    return (px[:, :, 3] == 255) & (g > r + 6) & (b > r) & (g > 40) & (g < 180)


def diamond_origin(alpha: np.ndarray) -> tuple[int, int]:
    ys, xs = np.nonzero(alpha)
    left_x = int(xs.min())
    right_x = int(xs.max())
    left_y = int(np.where(alpha[:, left_x])[0].mean())
    right_y = int(np.where(alpha[:, right_x])[0].mean())
    return (left_x + right_x + 1) // 2, (left_y + right_y + 1) // 2


def light_frame(base: np.ndarray, density: float, color: tuple[int, int, int], lift: int) -> np.ndarray:
    frame = np.zeros_like(base)
    mask = glass_mask(base)
    ys, xs = np.nonzero(mask)
    keep = np.array([hash2(int(x), int(y)) < density for x, y in zip(xs, ys)], dtype=bool)
    if not keep.any():
        return frame
    ys, xs = ys[keep], xs[keep]
    src = base[ys, xs, :3].astype(np.int16)
    lit = np.clip(src + lift, 0, 255)
    mix = 0.55
    frame[ys, xs, 0] = np.clip(lit[:, 0] * (1 - mix) + color[0] * mix, 0, 255)
    frame[ys, xs, 1] = np.clip(lit[:, 1] * (1 - mix) + color[1] * mix, 0, 255)
    frame[ys, xs, 2] = np.clip(lit[:, 2] * (1 - mix) + color[2] * mix, 0, 255)
    frame[ys, xs, 3] = 255
    return frame


def nearest_scale(px: np.ndarray, scale: int) -> np.ndarray:
    h, w = px.shape[:2]
    return np.repeat(np.repeat(px, scale, axis=0), scale, axis=1)


def main() -> None:
    base = harden(np.array(Image.open(SRC).convert("RGBA")))
    ox, oy = diamond_origin(base[:, :, 3] > 0)
    frames = [
        light_frame(base, 0.12, (255, 168, 92), 28),
        light_frame(base, 0.04, (255, 226, 160), 12),
        light_frame(base, 0.22, (255, 150, 88), 36),
        light_frame(base, 0.38, (120, 230, 255), 48),
    ]
    base4 = nearest_scale(base, SCALE)
    lights4 = [nearest_scale(frame, SCALE) for frame in frames]
    if base4.shape[0] % 2:
        base4 = np.pad(base4, ((0, 1), (0, 0), (0, 0)))
        lights4 = [np.pad(frame, ((0, 1), (0, 0), (0, 0))) for frame in lights4]
    if base4.shape[1] % 2:
        base4 = np.pad(base4, ((0, 0), (0, 1), (0, 0)))
        lights4 = [np.pad(frame, ((0, 0), (0, 1), (0, 0))) for frame in lights4]
    sheet = np.concatenate(lights4, axis=1)
    sw, sh = int(base4.shape[1]), int(base4.shape[0])
    origin_x = (ox * SCALE) / sw
    origin_y = (oy * SCALE) / sh
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(base4).save(OUT / f"{BUILDING_ID}.png")
    Image.fromarray(sheet).save(OUT / f"{BUILDING_ID}-lights.png")
    meta = {
        "id": BUILDING_ID,
        "source": "local trial import from TheoTown JPpack tokyo27, nearest-neighbor 4x",
        "spriteWidth": sw,
        "spriteHeight": sh,
        "worldScale": 1,
        "footprint": {"width": FOOT_W, "depth": FOOT_D},
        "origin": {"x": round(origin_x, 5), "y": round(origin_y, 5)},
        "tile": {"width": 128, "height": 64},
        "lights": {
            "url": f"assets/buildings/{BUILDING_ID}-lights.png",
            "frames": list(SEGMENTS),
        },
    }
    (OUT / f"{BUILDING_ID}.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    leaks = 0
    opaque = base4[:, :, 3] > 0
    for frame in lights4:
        leaks += int(((frame[:, :, 3] > 0) & ~opaque).sum())
    soft = int(((base4[:, :, 3] > 0) & (base4[:, :, 3] < 255)).sum())
    if soft or leaks or sw % 2 or sh % 2:
        raise SystemExit(f"import invalid soft={soft} leaks={leaks} size={sw}x{sh}")
    print(f"{BUILDING_ID} {sw}x{sh} origin=({origin_x:.5f},{origin_y:.5f}) lot=({ox * SCALE},{oy * SCALE})")


if __name__ == "__main__":
    main()
