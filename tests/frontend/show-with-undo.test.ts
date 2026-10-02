import { test } from "node:test";
import assert from "node:assert/strict";
import type { Capabilities, HomeAssistant } from "../../frontend/src/types.ts";
import type { LuToastRequest } from "../../frontend/src/components/lu-toast.ts";
import { SLOT_CHECK_FAILED, setSlotChoice } from "../../frontend/src/lib/slots.ts";
import { resolveShowTarget, showWithUndo } from "../../frontend/src/lib/show-with-undo.ts";

type ShowRequest = { type: string; entry_id: string; slot?: string; item: { restore?: string; [key: string]: unknown } };

function harness() {
  const host = new EventTarget() as unknown as HTMLElement;
  const toasts: LuToastRequest[] = [];
  host.addEventListener("lu-toast", (event) => toasts.push((event as CustomEvent<LuToastRequest>).detail));
  const requests: ShowRequest[] = [];
  let failNext: unknown = null;
  const hass = {
    callWS: async (request: ShowRequest) => {
      requests.push(request);
      if (failNext) {
        const failure = failNext;
        failNext = null;
        throw failure;
      }
      return {};
    },
  } as unknown as HomeAssistant;
  return {
    host,
    toasts,
    requests,
    hass,
    failNext: (error: unknown = new Error("offline")) => {
      failNext = error;
    },
  };
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

test("the screen goes to iledclock/show only when one was chosen, and the toast names screen B", async () => {
  const h = harness();
  await showWithUndo(h.host, h.hass, "entry-slot-1", { design_id: "a" } as never, "Heart");
  assert.equal("slot" in h.requests[0]!, false, "no choice, no slot key: the server writes screen A");
  assert.equal(h.toasts.at(-1)?.message, "Now showing Heart");

  await showWithUndo(h.host, h.hass, "entry-slot-1", { design_id: "a" } as never, "Heart", { slot: "a" });
  assert.equal(h.requests.at(-1)?.slot, "a");
  assert.equal(h.toasts.at(-1)?.message, "Now showing Heart", "screen A is the default and is not spelled out");

  await showWithUndo(h.host, h.hass, "entry-slot-1", { design_id: "a" } as never, "Heart", { slot: "b" });
  assert.equal(h.requests.at(-1)?.slot, "b");
  assert.equal(h.toasts.at(-1)?.message, "Now showing Heart on screen B");
});

test("Undo of a screen B show sends no slot (the server goes back on the same screen) and says which screen", async () => {
  const h = harness();
  await showWithUndo(h.host, h.hass, "entry-slot-2", { design_id: "a" } as never, "Heart", { slot: "b" });
  await h.toasts.at(-1)?.action?.();
  const undo = h.requests.at(-1)!;
  assert.deepEqual(undo.item, { restore: "previous" });
  assert.equal("slot" in undo, false);
  assert.equal(h.toasts.at(-1)?.message, "Restored the previous item on screen B");
});

test("a screen the clock cannot use for this content is refused with the server's words and no Retry, nothing else", async () => {
  const h = harness();
  const reason = "Screen B only takes clock, date and temperature pages for now; pictures go on screen A.";
  h.failNext({ code: "slot_unsupported", message: reason });
  assert.equal(await showWithUndo(h.host, h.hass, "entry-slot-3", { design_id: "a" } as never, "Heart", { slot: "b" }), false);
  const failure = h.toasts.at(-1)!;
  assert.equal(failure.message, `Couldn't show Heart on screen B: ${reason}`);
  assert.equal(failure.action, undefined, "asking again cannot work");
  assert.equal(failure.actionLabel, undefined);
  assert.equal(h.requests.length, 1, "nothing was sent to screen A instead");
});

test("Retry after an ordinary failure writes to the same screen again", async () => {
  const h = harness();
  h.failNext();
  assert.equal(await showWithUndo(h.host, h.hass, "entry-slot-4", { design_id: "a" } as never, "Heart", { slot: "b" }), false);
  const failure = h.toasts.at(-1)!;
  assert.equal(failure.actionLabel, "Retry");
  await failure.action?.();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1]!.slot, "b");
});

const CAPABILITIES = { slots: { ids: ["a", "b"], b_accepts: ["clock", "date", "temperature", "humidity", "art_clock"] } } as unknown as Capabilities;

test("by content class: a remembered B goes to B for a clock; a picture goes to A and the toast says so instead of staying silent", async () => {
  const h = harness();
  setSlotChoice("entry-class-1", "b");
  await showWithUndo(h.host, h.hass, "entry-class-1", { spec: { type: "clock" } } as never, "Clock", { contentClass: "clock", capabilities: CAPABILITIES });
  assert.equal(h.requests.at(-1)?.slot, "b");
  assert.equal(h.toasts.at(-1)?.message, "Now showing Clock on screen B");

  await showWithUndo(h.host, h.hass, "entry-class-1", { design_id: "d" } as never, "Heart", { contentClass: "art", capabilities: CAPABILITIES });
  assert.equal(h.requests.at(-1)?.slot, "a", "B does not take plain art");
  assert.equal(h.toasts.at(-1)?.message, "Now showing Heart on screen A");
});

test("by content class: a remembered A is sent to A without asking the clock anything", async () => {
  const h = harness();
  setSlotChoice("entry-class-2", "a");
  await showWithUndo(h.host, h.hass, "entry-class-2", { design_id: "d" } as never, "Heart", { contentClass: "art" });
  assert.equal(h.requests.length, 1, "no iledclock/state lookup, just the show");
  assert.equal(h.requests[0]!.type, "iledclock/show");
  assert.equal(h.requests[0]!.slot, "a");
  assert.equal(h.toasts.at(-1)?.message, "Now showing Heart", "A was the choice, so nothing needs spelling out");
});

test("by content class: with B remembered and no way to check what B takes, nothing is sent and the user is told", async () => {
  const h = harness();
  setSlotChoice("entry-class-3", "b");
  assert.equal(await showWithUndo(h.host, h.hass, "entry-class-3", { design_id: "d" } as never, "Heart", { contentClass: "art" }), false);
  assert.deepEqual(h.requests.map((request) => request.type), ["iledclock/state"], "only the capability lookup went out");
  const toast = h.toasts.at(-1)!;
  assert.equal(toast.message, `Couldn't show Heart: ${SLOT_CHECK_FAILED}`);
  assert.equal(toast.actionLabel, "Retry");
});

test("the toast names the screen the server says the show landed on (a date page asked for A is filed on B)", async () => {
  const landed: { slot: string } = { slot: "b" };
  const h = harness();
  const original = h.hass.callWS!;
  (h.hass as { callWS: unknown }).callWS = async (request: ShowRequest) => {
    await original(request as never);
    return request.type === "iledclock/show" ? { now_showing: { slot: landed.slot } } : {};
  };
  await showWithUndo(h.host, h.hass, "entry-landed-1", { spec: { type: "date" } } as never, "Date", { slot: "a" });
  assert.equal(h.requests[0]!.slot, "a", "A was asked for");
  assert.equal(h.toasts.at(-1)?.message, "Now showing Date on screen B", "the toast says where it really went");
  await h.toasts.at(-1)?.action?.();
  assert.equal(h.toasts.at(-1)?.message, "Restored the previous item on screen B");

  landed.slot = "a";
  await showWithUndo(h.host, h.hass, "entry-landed-2", { design_id: "d" } as never, "Heart", { slot: "a" });
  assert.equal(h.toasts.at(-1)?.message, "Now showing Heart", "landing where it was asked is not spelled out");
});

test("by content class: a date page is sent to B and the toast says so, though A is remembered", async () => {
  const h = harness();
  setSlotChoice("entry-date-1", "a");
  await showWithUndo(h.host, h.hass, "entry-date-1", { spec: { type: "date" } } as never, "Date", { contentClass: "date" });
  assert.equal(h.requests[0]!.slot, "b");
  assert.equal(h.toasts.at(-1)?.message, "Now showing Date on screen B");
});

test("resolveShowTarget: the screen at this moment, and whether B was remembered but the content has to go to A", async () => {
  const h = harness();
  setSlotChoice("entry-resolve-1", "b");
  assert.deepEqual(await resolveShowTarget(h.hass, "entry-resolve-1", "clock", CAPABILITIES), { slot: "b", fellBack: false });
  assert.deepEqual(await resolveShowTarget(h.hass, "entry-resolve-1", "art_clock", CAPABILITIES), { slot: "b", fellBack: false });
  assert.deepEqual(await resolveShowTarget(h.hass, "entry-resolve-1", "art", CAPABILITIES), { slot: "a", fellBack: true });
  assert.deepEqual(await resolveShowTarget(h.hass, "entry-resolve-1", "date", CAPABILITIES), { slot: "b", fellBack: false });
  setSlotChoice("entry-resolve-1", "a");
  assert.deepEqual(await resolveShowTarget(h.hass, "entry-resolve-1", "art", CAPABILITIES), { slot: "a", fellBack: false }, "A was the choice: nothing fell back");
  assert.equal(h.requests.length, 0, "known capabilities need no lookup");
});

test("resolveShowTarget: screen B remembered but impossible to check is null, so the caller sends nothing", async () => {
  const h = harness();
  setSlotChoice("entry-resolve-2", "b");
  assert.equal(await resolveShowTarget(h.hass, "entry-resolve-2", "art"), null);
});

test("a target decided at the click is used as it is: the show goes where the click said whatever is remembered afterwards", async () => {
  const h = harness();
  setSlotChoice("entry-target-1", "b");
  const target = await resolveShowTarget(h.hass, "entry-target-1", "art_clock", CAPABILITIES);
  assert.deepEqual(target, { slot: "b", fellBack: false });
  // The import takes a while; meanwhile the remembered screen changes and the content class passed along would no longer qualify.
  setSlotChoice("entry-target-1", "a");
  await showWithUndo(h.host, h.hass, "entry-target-1", { design_id: "d" } as never, "Heart", { target: target!, contentClass: "art" });
  assert.equal(h.requests.length, 1, "nothing was looked up or decided again");
  assert.equal(h.requests[0]!.slot, "b");
  assert.equal(h.toasts.at(-1)?.message, "Now showing Heart on screen B");
});

test("a target that fell back to A says so in the toast", async () => {
  const h = harness();
  setSlotChoice("entry-target-2", "b");
  const target = await resolveShowTarget(h.hass, "entry-target-2", "art", CAPABILITIES);
  assert.deepEqual(target, { slot: "a", fellBack: true });
  await showWithUndo(h.host, h.hass, "entry-target-2", { design_id: "d" } as never, "Heart", { target: target! });
  assert.equal(h.requests[0]!.slot, "a");
  assert.equal(h.toasts.at(-1)?.message, "Now showing Heart on screen A");
});

test("a target of B that the server then refuses is a message with its reason, never a silent move to A", async () => {
  const h = harness();
  const reason = "Screen B only takes clock, date and temperature pages for now; pictures go on screen A.";
  h.failNext({ code: "slot_unsupported", message: reason });
  assert.equal(await showWithUndo(h.host, h.hass, "entry-target-3", { design_id: "d" } as never, "Heart", { target: { slot: "b", fellBack: false }, contentClass: "art" }), false);
  assert.equal(h.requests.length, 1, "no second request, and none to screen A");
  assert.equal(h.requests[0]!.slot, "b");
  const failure = h.toasts.at(-1)!;
  assert.equal(failure.message, `Couldn't show Heart on screen B: ${reason}`);
  assert.equal(failure.action, undefined);
});

test("Retry after an ordinary failure repeats the show with the same target, not a fresh decision", async () => {
  const h = harness();
  setSlotChoice("entry-target-4", "b");
  h.failNext();
  assert.equal(await showWithUndo(h.host, h.hass, "entry-target-4", { design_id: "d" } as never, "Heart", { target: { slot: "b", fellBack: false } }), false);
  const failure = h.toasts.at(-1)!;
  assert.equal(failure.actionLabel, "Retry");
  setSlotChoice("entry-target-4", "a");
  await failure.action?.();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1]!.slot, "b");
  assert.equal(h.toasts.at(-1)?.message, "Now showing Heart on screen B");
});
