import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStudioRoute, serializeStudioRoute } from "../../frontend/src/lib/route.ts";

test("studio route defaults to Now for the root and unknown destinations", () => {
  assert.deepEqual(parseStudioRoute("/iledclock"), { destination: "now" });
  assert.deepEqual(parseStudioRoute("/iledclock/unknown"), { destination: "now" });
});

test("all four destinations parse and serialize with sheet query values", () => {
  for (const destination of ["now", "create", "explore", "library"] as const) {
    const route = { destination, item: "a b&c", design: "design/42" };
    assert.deepEqual(parseStudioRoute(serializeStudioRoute(route)), route);
  }
});

test("route parser ignores unrelated query values and strips trailing slashes", () => {
  assert.deepEqual(parseStudioRoute("/iledclock/library/?other=keep&design=local-1"), { destination: "library", design: "local-1" });
});
