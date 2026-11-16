import { test } from "node:test";
import assert from "node:assert/strict";
import { measureFigure } from "../src/portrait.js";
import { encodePng, figurePixel } from "./png.js";

test("measureFigure frames the head and upper body, centred on the torso", async () => {
  const png = await encodePng(100, 200, figurePixel);
  // Figure spans y 20–120 (h 100). The focus starts 3% of h above it and
  // covers 54% of h; x is the centre of the torso band (rows 35–55), not
  // the horns that reach left.
  assert.deepEqual((await measureFigure(png)).focus, { x: 0.5, top: 0.085, height: 0.27 });
});

test("measureFigure frames the whole figure with a 3% margin above and below", async () => {
  const png = await encodePng(100, 200, figurePixel);
  // Figure spans y 20–120 (h 100): the frame runs from y 17 to y 123.
  assert.deepEqual((await measureFigure(png)).figure, { x: 0.5, top: 0.085, height: 0.53 });
});

test("measureFigure returns null for a fully transparent image", async () => {
  const png = await encodePng(20, 20, () => [0, 0, 0, 0]);
  assert.equal(await measureFigure(png), null);
});

test("measureFigure returns null for a PNG without an alpha channel", async () => {
  const png = await encodePng(20, 20, () => [10, 10, 10], { colorType: 2 });
  assert.equal(await measureFigure(png), null);
});

test("measureFigure returns null for bytes that are not a PNG", async () => {
  assert.equal(await measureFigure(new TextEncoder().encode("<html>nope</html>")), null);
});
