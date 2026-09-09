---
name: pixeltown-building
description: Draw PixelTown buildings as opaque 2:1 isometric pixels, register them in the catalog, and wire dawn/noon/dusk/night lights. Use when adding a building, tower, 建筑, 楼, sprite, footprint, or when asked to extract/crop a reference photo into the town.
---

# PixelTown 建筑

参考图只用来看体量和材质，**禁止抠图、LANCZOS 放大、半透明描边**。楼必须用整数 2:1 像素画实心体，才能坐在 128×64 地砖上。

## 完成标准

- `public/assets/buildings/<id>.png` 硬 alpha（只有 0/255），偶数宽高
- 同尺寸横条 `<id>-lights.png`，帧序 `dawn, noon, dusk, night`，发光不漏出轮廓
- `<id>.json` 与 `src/server/catalog.ts` 的 `width/height/originX/originY` 完全一致
- 按 2× 地砖画（`set_scale(2)`），`worldScale: 0.5`，宽高必须是偶数，锚点落在整像素上
- 锚点是占地菱形中心（地面 `i=0,j=0,k=0`），不是图底边
- 正午/夜间各截一张，楼坐在格子上，没有白边、没有草地从墙里透出来

## 坐标系

`+i` 东，`+j` 南，`+k` 向上（像素）。地砖 `TILE_W=128`、`TILE_H=64`。

```
sx = ox + (i - j) * 64
sy = oy + (i + j) * 32 - k
```

南墙是屏幕左侧，东墙是屏幕右侧。先画西北（后）体块，再画东南（前）。

占地 W×D 的菱形宽 `(W+D)*64`、高 `(W+D)*32`。2×2 就是 256×128。

## 流程

1. 读 `tools/iso_building.py`，新楼写成 `tools/render-<id>.py`。模板看 `tools/render-glass-tower.py`（幕墙）和 `tools/render-needle-tower.py`（体块）。
2. 只用 `draw_box` / `paint_curtain` / `fill_*`。墙面用反投影填实，不要描边挤出。
3. `python3 tools/render-<id>.py`（`export_building` 会校验软边、漏光、奇数尺寸）。
4. 把 json 里的尺寸写进 `src/server/catalog.ts`，补 `lights`。需要种子楼时在 `runtime.ts` `placeBuilding` / `ensureSeedBuilding`。
5. 等服务端 reload 后截图：`node tools/screenshot.mjs http://127.0.0.1:5173/ /tmp/shot/<id>-noon.png 10000 --noon`，再单独跑一次 `--night`。不要并行（抢 9333 端口）。

## 目录契约

```ts
sprite: {
  url: "assets/buildings/<id>.png",
  width, height, originX, originY,
  lights: { url: "assets/buildings/<id>-lights.png", frames: ["dawn","noon","dusk","night"] },
}
```

发光层按 `width×height` 切帧。目录数字和 PNG 对不齐，灯会错位。

## Gotchas

- 抠图一定有白边和糊底；用户已经否决过这条路。
- 只画棱柱轮廓（2px 墙）时草地会从楼中间透出来，看起来像没扣干净。
- 1× 画、再 0.6 缩放，斜边会特别糙。楼按 2× 画、`worldScale: 0.5`，相机默认 1.0。
- `worldScale: 0.5` + 奇数宽高会亚像素发糊。
- 挤出菱形的 `(dy,z)` 会互相覆盖，窗会糊成一片；用 `fill_south` / `fill_east` / `fill_top`。
- 屋顶设备画在塔身之后会戳进墙面；后景先画，前景后画。
- 旧存档只存实体 id，精灵以目录为准；改尺寸不必迁实体，但必须重启 `tsx watch`。

## 不要做

- 不要改 `extract-building.py` / `extract-needle-tower.py` 当主资源
- 不要 GIF/视频当运行时格式
- 不要把半透明抗锯齿写进 PNG
