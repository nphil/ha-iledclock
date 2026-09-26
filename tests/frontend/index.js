/** Barrel so `node --test tests/frontend` (a bare directory argument) resolves to something
 * runnable: Node's CJS/ESM directory resolution finds this `index.js` (this directory's own
 * `package.json` marks it ESM), which then dynamically imports every `*.test.ts` file sitting
 * next to it. Auto-discovered, not hand-maintained -- adding a new `*.test.ts` file here needs
 * no edit to this barrel. `bun test tests/frontend` does not need this file at all (bun's own
 * recursive `*.test.ts` discovery finds the sibling files directly); it exists purely for the
 * plain `node --test` invocation, which (as of the Node version this project targets) only
 * recurses automatically with zero path arguments or an explicit glob, never a bare directory.
 */

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const testFiles = readdirSync(here)
  .filter((name) => name.endsWith(".test.ts"))
  .sort();

for (const name of testFiles) {
  await import(`./${name}`);
}
