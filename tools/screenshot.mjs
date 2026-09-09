// Grab a real screenshot of the running client. Chrome's --screenshot flag never
// settles against Phaser's animation loop, so this drives CDP and waits on wall time.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const url = process.argv[2] ?? "http://127.0.0.1:5173/";
const out = process.argv[3] ?? "/tmp/shot/town.png";
const settleMs = Number(process.argv[4] ?? 7000);
const port = 9333;

const chrome =
  process.env.CHROME_PATH ??
  join(
    homedir(),
    "Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  );

mkdirSync("/tmp/shot", { recursive: true });
const child = spawn(chrome, [
  "--headless=new",
  "--no-sandbox",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--hide-scrollbars",
  "--window-size=1400,1000",
  `--remote-debugging-port=${port}`,
  "--user-data-dir=/tmp/shot/profile",
  "about:blank",
]);
child.stderr.on("data", () => {});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function targetSocket() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("chrome devtools endpoint never came up");
}

const socket = new WebSocket(await targetSocket());
await new Promise((resolve) => socket.once("open", resolve));

let nextId = 1;
const pending = new Map();
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  const resolve = pending.get(message.id);
  if (resolve) {
    pending.delete(message.id);
    resolve(message.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1180, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url });
await sleep(settleMs);
if (process.argv.includes("--night")) {
  await send("Runtime.evaluate", {
    expression: `document.querySelector('[aria-label="光照时段"] button:last-child')?.click()`,
  });
  await sleep(800);
}
if (process.argv.includes("--noon")) {
  await send("Runtime.evaluate", {
    expression: `[...document.querySelectorAll('[aria-label="光照时段"] button')].find((b) => b.textContent.includes("正午"))?.click()`,
  });
  await sleep(800);
}
if (process.argv.includes("--zoom2")) {
  await send("Runtime.evaluate", {
    expression: `for (let i = 0; i < 8; i += 1) document.querySelector('[aria-label="放大地图"]')?.click()`,
  });
  await sleep(400);
}
if (process.argv.includes("--zoomout")) {
  await send("Runtime.evaluate", {
    expression: `for (let i = 0; i < 5; i += 1) document.querySelector('[aria-label="缩小地图"]')?.click()`,
  });
  await sleep(400);
}
if (process.argv.includes("--pan-up")) {
  const host = await send("Runtime.evaluate", {
    expression: `(() => { const r = document.querySelector('[aria-label="像素小镇地图"]')?.getBoundingClientRect(); return r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null; })()`,
    returnByValue: true,
  });
  const point = host.result.value;
  if (point) {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y + 220, button: "left" });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y + 220, button: "left", clickCount: 1 });
    await sleep(400);
  }
}
if (process.argv.includes("--click-map")) {
  const evaled = await send("Runtime.evaluate", {
    expression: `(() => {
      const label = [...document.querySelectorAll(".world-label")].find((el) => el.textContent.includes("玻璃"));
      if (label) {
        const r = label.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 2) };
      }
      const el = document.querySelector('[aria-label="像素小镇地图"]');
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.42) };
    })()`,
    returnByValue: true,
  });
  const point = evaled.result.value;
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(500);
  const inspect = await send("Runtime.evaluate", {
    expression: `document.querySelector(".entity-inspect")?.innerText ?? "NO_PANEL"`,
    returnByValue: true,
  });
  console.log("click", point, "panel", inspect.result.value);
}
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.data, "base64"));
socket.close();
child.kill();
console.log(`wrote ${out}`);
process.exit(0);
