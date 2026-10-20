import assert from "node:assert/strict";
import test from "node:test";
import { strategyEntries } from "../dist/index.js";

test("green release uses entry admission without the separately trained AI gate", () => {
  const manifest = strategyEntries.find(
    (entry) => entry.manifest.name === "RangeReclaim",
  ).manifest;
  assert.equal(manifest.aiAdapter, undefined);
  assert.equal(typeof manifest.hooks.beforeEntryGate, "function");
});
