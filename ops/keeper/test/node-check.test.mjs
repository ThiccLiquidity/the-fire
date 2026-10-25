import { test } from "node:test";
import assert from "node:assert/strict";
import { nodePatched } from "../src/node-check.mjs";

test("HTTP2Shell (CVE-2026-111497): only Node builds with the Brotli fix pass", () => {
  for (const v of ["22.23.4", "22.24.0", "24.22.1", "24.30.0", "26.12.1", "27.0.0"]) assert.equal(nodePatched(v), true, v);
  for (const v of ["20.19.0", "22.22.2", "22.23.3", "23.9.0", "24.22.0", "25.1.0", "26.12.0"]) assert.equal(nodePatched(v), false, v);
});
