import { test } from "node:test";
import assert from "node:assert/strict";
import type { HomeAssistant } from "../../frontend/src/types.ts";
import {
  clearDescriptorPreviewCache,
  decodeRenderFrames,
  descriptorPreviewKey,
  descriptorPreviewPlan,
  loadDescriptorPreview,
} from "../../frontend/src/lib/descriptor-preview.ts";

const FRAME_B64 = Buffer.alloc(32 * 16 * 3, 7).toString("base64");

function plan(descriptor: { kind: string; [key: string]: unknown }) {
  return descriptorPreviewPlan(descriptor);
}

test("a design replays at the speed and smooth setting it was shown with, and only those keys that are present", () => {
  assert.deepEqual(plan({ kind: "design", design_id: "d1" }), { type: "render", spec: { type: "design", design_id: "d1" } });
  assert.deepEqual(plan({ kind: "design", design_id: "d1", speed: null, smooth: "off" }), { type: "render", spec: { type: "design", design_id: "d1", speed: null, smooth: "off" } });
  assert.equal(plan({ kind: "design" }).type, "none", "no design id, nothing to draw");
});

test("a clock descriptor keeps its face, colour and hour format, with the old field name hours24 still understood", () => {
  assert.deepEqual(plan({ kind: "clock", style: 12, color: [0, 220, 255], h24: false, background: false }), {
    type: "render",
    spec: { type: "clock", style: 12, color: [0, 220, 255], h24: false, background: false },
  });
  const server = plan({ kind: "clock", style: 3, hours24: false });
  assert.deepEqual(server.type === "render" ? server.spec : null, { type: "clock", style: 3, color: [255, 255, 255], h24: false, background: true });
  const bare = plan({ kind: "clock" });
  assert.deepEqual(bare.type === "render" ? bare.spec : null, { type: "clock", style: 1, color: [255, 255, 255], h24: true, background: true });
});

test("text carries font, effect, bold and playback; bold is read from is_bold or bold", () => {
  const withIsBold = plan({ kind: "text", text: "Hello", color: [255, 220, 0], font: "5x7", effect: 2, is_bold: true, speed: 40, smooth: "off", slot: "a" });
  assert.deepEqual(withIsBold, { type: "render", spec: { type: "text", text: "Hello", color: [255, 220, 0], font: "5x7", effect: "2", bold: true, speed: 40, smooth: "off" } });
  const withBold = plan({ kind: "text", text: "Hello", bold: false, slot: "b" });
  assert.deepEqual(withBold, { type: "render", spec: { type: "text", text: "Hello", color: [255, 255, 255], bold: false } });
});

test("text speed from before screens existed (0-255 scale, no slot) is left out, not read as a 0-100 speed", () => {
  const legacy = plan({ kind: "text", text: "Hello", speed: 128, smooth: "on" });
  assert.deepEqual(legacy, { type: "render", spec: { type: "text", text: "Hello", color: [255, 255, 255] } });
  const current = plan({ kind: "text", text: "Hello", speed: 0, slot: "a" });
  assert.deepEqual(current, { type: "render", spec: { type: "text", text: "Hello", color: [255, 255, 255], speed: 0 } }, "Still (0) is a real choice on a current descriptor");
});

test("text with nothing to draw says so instead of asking the server", () => {
  const blank = plan({ kind: "text", text: "   " });
  assert.equal(blank.type, "none");
  assert.equal(plan({ kind: "text" }).type, "none");
});

test("an image uses the frames it carries, and asks the server to retime them only when a playback choice is stored", () => {
  assert.deepEqual(plan({ kind: "image", frames: [FRAME_B64], delays: [100] }), { type: "inline", frames: [FRAME_B64], delays: [100] });
  assert.deepEqual(plan({ kind: "image", frames: [FRAME_B64, FRAME_B64], delays: [50, 50], speed: 30 }), {
    type: "render",
    spec: { type: "image", frames: [FRAME_B64, FRAME_B64], delays: [50, 50], speed: 30 },
  });
  assert.equal(plan({ kind: "image", frames: [] }).type, "none");
});

test("a generated effect is drawn by its preset name, for the seconds it was made for", () => {
  assert.deepEqual(plan({ kind: "generative", effect: "fire", seconds: 4.4, seed: 17.9, speed: 50 }), {
    type: "render",
    spec: { type: "generative", kind: "fire", seconds: 4, seed: 17, speed: 50 },
  });
  const bare = plan({ kind: "generative" });
  assert.deepEqual(bare.type === "render" ? bare.spec : null, { type: "generative", kind: "plasma", seconds: 10 });
});

test("pages the clock draws itself have no preview, with a sentence that says so", () => {
  for (const kind of ["date", "temperature", "humidity", "timer", "scoreboard"]) {
    const result = plan({ kind });
    assert.equal(result.type, "none", kind);
    assert.match(result.type === "none" ? result.reason : "", new RegExp(`clock draws the ${kind} itself`));
  }
  const unknown = plan({ kind: "something-new" });
  assert.equal(unknown.type === "none" ? unknown.reason : "", "A live preview is not available for this item.");
});

test("the preview key changes with whatever changes the picture and not with unrelated fields", () => {
  const base = { kind: "text", text: "Hi", color: [255, 255, 255], effect: 1, shown_at: "t1", title: "Text · Hi", slot: "a" };
  assert.equal(descriptorPreviewKey(base), descriptorPreviewKey({ ...base, title: "Another title", slot: "b" }), "title and screen do not change the picture");
  for (const change of [{ text: "Ho" }, { color: [0, 0, 0] }, { effect: 2 }, { is_bold: true }, { speed: 10 }, { smooth: "off" }, { shown_at: "t2" }, { font: "5x7" }]) {
    assert.notEqual(descriptorPreviewKey(base), descriptorPreviewKey({ ...base, ...change }), JSON.stringify(change));
  }
  assert.equal(descriptorPreviewKey(null), "empty");
  assert.notEqual(descriptorPreviewKey({ kind: "image", frames: [FRAME_B64] }), descriptorPreviewKey({ kind: "image", frames: [FRAME_B64, FRAME_B64] }));
});

test("decodeRenderFrames gives 32x16 frames with the server's hold times, fractions kept, 100 ms when missing", () => {
  const frames = decodeRenderFrames({ frames: [FRAME_B64, FRAME_B64], delays: [10.5] });
  assert.equal(frames.length, 2);
  assert.equal(frames[0]!.width, 32);
  assert.equal(frames[0]!.height, 16);
  assert.equal(frames[0]!.pixels.length, 32 * 16 * 3);
  assert.equal(frames[0]!.pixels[0], 7);
  assert.equal(frames[0]!.durationMs, 10.5);
  assert.equal(frames[1]!.durationMs, 100);
});

function fakeHass(handler: (message: Record<string, unknown>) => Promise<unknown>) {
  const messages: Array<Record<string, unknown>> = [];
  const hass = {
    callWS: async (message: Record<string, unknown>) => {
      messages.push(message);
      return handler(message);
    },
  } as unknown as Pick<HomeAssistant, "callWS">;
  return { hass, messages };
}

test("two surfaces previewing the same descriptor share one render request, and the picture is the server's frames", async () => {
  clearDescriptorPreviewCache();
  const { hass, messages } = fakeHass(async () => ({ frames: [FRAME_B64], delays: [250], approximate: true }));
  const descriptor = { kind: "design", design_id: "shared-d", shown_at: "t1" };
  const [hero, tile] = await Promise.all([loadDescriptorPreview(hass, "entry-1", descriptor), loadDescriptorPreview(hass, "entry-1", { ...descriptor, title: "same picture" })]);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], { type: "iledclock/render", entry_id: "entry-1", spec: { type: "design", design_id: "shared-d" } });
  assert.equal(hero, tile);
  assert.equal(hero.frames[0]!.durationMs, 250);
  assert.equal(hero.approximate, true);
  await loadDescriptorPreview(hass, "entry-2", descriptor);
  assert.equal(messages.length, 2, "another clock renders its own");
});

test("a failed render is not remembered and a descriptor that cannot be drawn never reaches the server", async () => {
  clearDescriptorPreviewCache();
  let calls = 0;
  const { hass } = fakeHass(async () => {
    calls += 1;
    if (calls === 1) throw new Error("render_failed");
    return { frames: [FRAME_B64], delays: [100] };
  });
  const descriptor = { kind: "design", design_id: "retry-d" };
  await assert.rejects(loadDescriptorPreview(hass, "entry-1", descriptor), /render_failed/);
  const second = await loadDescriptorPreview(hass, "entry-1", descriptor);
  assert.equal(second.frames.length, 1);
  assert.equal(calls, 2);

  await assert.rejects(loadDescriptorPreview(hass, "entry-1", { kind: "date" }), /clock draws the date itself/);
  assert.equal(calls, 2);
});

test("an image with its frames in hand is shown without any request", async () => {
  clearDescriptorPreviewCache();
  const { hass, messages } = fakeHass(async () => {
    throw new Error("must not be called");
  });
  const preview = await loadDescriptorPreview(hass, "entry-1", { kind: "image", frames: [FRAME_B64], delays: [80] });
  assert.equal(preview.frames[0]!.durationMs, 80);
  assert.equal(messages.length, 0);
});
