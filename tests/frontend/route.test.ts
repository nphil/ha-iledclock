import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStudioRoute, serializeStudioRoute } from "../../frontend/src/lib/route.ts";

test("studio route defaults to Now for the root and unknown destinations", () => {
  assert.deepEqual(parseStudioRoute("/iledclock"), { destination: "now" });
  assert.deepEqual(parseStudioRoute("/iledclock/unknown"), { destination: "now" });
});

test("all five destinations parse and serialize with sheet query values", () => {
  for (const destination of ["now", "create", "explore", "library", "alarms"] as const) {
    const route = { destination, item: "a b&c", design: "design/42", alarm: "new" };
    assert.deepEqual(parseStudioRoute(serializeStudioRoute(route)), route);
  }
});

test("the alarms destination opens its edit sheet from the alarm query", () => {
  assert.deepEqual(parseStudioRoute("/iledclock/alarms"), { destination: "alarms" });
  assert.deepEqual(parseStudioRoute("/iledclock/alarms?alarm=3f9a0c1d2e4b"), { destination: "alarms", alarm: "3f9a0c1d2e4b" });
  assert.equal(serializeStudioRoute({ destination: "alarms", alarm: "new" }), "/iledclock/alarms?alarm=new");
  assert.equal(serializeStudioRoute({ destination: "alarms" }), "/iledclock/alarms");
});

test("route parser ignores unrelated query values and strips trailing slashes", () => {
  assert.deepEqual(parseStudioRoute("/iledclock/library/?other=keep&design=local-1"), { destination: "library", design: "local-1" });
});
