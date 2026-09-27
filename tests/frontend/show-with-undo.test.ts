import { test } from "node:test";
import assert from "node:assert/strict";
import type { HomeAssistant } from "../../frontend/src/types.ts";
import type { LuToastRequest } from "../../frontend/src/components/lu-toast.ts";
import { showWithUndo } from "../../frontend/src/lib/show-with-undo.ts";

type ShowRequest = { type: string; entry_id: string; item: { restore?: string; [key: string]: unknown } };

function harness() {
  const host = new EventTarget() as unknown as HTMLElement;
  const toasts: LuToastRequest[] = [];
  host.addEventListener("lu-toast", (event) => toasts.push((event as CustomEvent<LuToastRequest>).detail));
  const requests: ShowRequest[] = [];
  let failNext = false;
  const hass = {
    callWS: async (request: ShowRequest) => {
      requests.push(request);
      if (failNext) {
        failNext = false;
        throw new Error("offline");
      }
      return {};
    },
  } as unknown as HomeAssistant;
  return { host, toasts, requests, hass, failNext: () => { failNext = true; } };
}

test("a newer successful show expires older Undo actions across hosts", async () => {
  const first = harness();
  const secondHost = harness();
  await showWithUndo(first.host, first.hass, "entry-undo-expiry", { design_id: "a" } as never, "A");
  const oldAction = first.toasts[0]?.action;
  assert.ok(oldAction);
  await showWithUndo(secondHost.host, secondHost.hass, "entry-undo-expiry", { design_id: "b" } as never, "B");

  await oldAction();
  assert.equal(first.toasts.at(-1)?.message, "That undo expired");
  assert.equal(first.requests.length, 1, "expired Undo must not restore the previous item");

  await secondHost.toasts[0]?.action?.();
  assert.deepEqual(secondHost.requests.at(-1)?.item, { restore: "previous" });
});

test("a failed newer show does not invalidate the prior Undo", async () => {
  const h = harness();
  await showWithUndo(h.host, h.hass, "entry-undo-failure", { design_id: "a" } as never, "A");
  const oldAction = h.toasts[0]?.action;
  assert.ok(oldAction);
  h.failNext();
  assert.equal(await showWithUndo(h.host, h.hass, "entry-undo-failure", { design_id: "b" } as never, "B"), false);
  await oldAction();
  assert.deepEqual(h.requests.at(-1)?.item, { restore: "previous" });
  assert.equal(h.toasts.at(-1)?.message, "Restored the previous item");
});
