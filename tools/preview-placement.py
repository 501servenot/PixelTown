"""Render the live snapshot with the same maths the Phaser scene uses.

Useful as a fast check that a sprite's footprint and anchor line up with the
grid without having to eyeball the running game.
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_URL = "http://127.0.0.1:3001/api/world/snapshot"
TILE_W, TILE_H = 128, 64
WINDOW = 11  # cells drawn around the focus point
OUT = Path("/tmp/bldg/placement.png")

TERRAIN_FILL = {"g": (63, 92, 44), "s": (142, 138, 101), "w": (29, 66, 80)}


def main() -> None:
    with urllib.request.urlopen(SNAPSHOT_URL) as response:
        snapshot = json.load(response)

    archetypes = {item["id"]: item for item in snapshot["archetypes"]}
    building = next(entity for entity in snapshot["entities"] if entity["kind"] == "building")
    focus_x = building["position"]["x"] + (building["footprint"]["width"] - 1) / 2
    focus_y = building["position"]["y"] + (building["footprint"]["depth"] - 1) / 2

    width, height = 1280, 940
    origin_x, origin_y = width / 2, 620

    def to_screen(x: float, y: float) -> tuple[float, float]:
        return origin_x + (x - focus_x - (y - focus_y)) * (TILE_W / 2), origin_y + (
            (x - focus_x) + (y - focus_y)
        ) * (TILE_H / 2)

    canvas = Image.new("RGBA", (width, height), (16, 24, 32, 255))
    draw = ImageDraw.Draw(canvas)

    x0, x1 = int(focus_x) - WINDOW, int(focus_x) + WINDOW + 1
    y0, y1 = int(focus_y) - WINDOW, int(focus_y) + WINDOW + 1
    for gy in range(y0, y1):
        row = snapshot["terrain"][gy] if 0 <= gy < snapshot["height"] else ""
        for gx in range(x0, x1):
            code = row[gx] if 0 <= gx < len(row) else "w"
            cx, cy = to_screen(gx, gy)
            draw.polygon(
                [(cx, cy - TILE_H / 2), (cx + TILE_W / 2, cy), (cx, cy + TILE_H / 2), (cx - TILE_W / 2, cy)],
                fill=TERRAIN_FILL[code],
                outline=(34, 48, 44),
            )

    for entity in sorted(
        snapshot["entities"],
        key=lambda e: e["position"]["x"] + e["footprint"]["width"] + e["position"]["y"] + e["footprint"]["depth"],
    ):
        footprint = entity["footprint"]
        centre_x = entity["position"]["x"] + (footprint["width"] - 1) / 2
        centre_y = entity["position"]["y"] + (footprint["depth"] - 1) / 2
        cx, cy = to_screen(centre_x, centre_y)
        lot_w = (footprint["width"] + footprint["depth"]) * (TILE_W / 2)
        lot_h = (footprint["width"] + footprint["depth"]) * (TILE_H / 2)
        lot = [(cx, cy - lot_h / 2), (cx + lot_w / 2, cy), (cx, cy + lot_h / 2), (cx - lot_w / 2, cy)]

        archetype = archetypes.get(entity.get("archetypeId") or "")
        if not archetype:
            draw.rectangle([cx - 7, cy - 25, cx + 7, cy - 11], fill=(241, 198, 109))
            continue

        draw.polygon(lot, fill=(24, 40, 46))
        sprite = Image.open(ROOT / "public" / archetype["sprite"]["url"]).convert("RGBA")
        canvas.alpha_composite(
            sprite,
            (round(cx - archetype["sprite"]["originX"] * sprite.width), round(cy - archetype["sprite"]["originY"] * sprite.height)),
        )
        draw.polygon(lot, outline=(255, 210, 60))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
