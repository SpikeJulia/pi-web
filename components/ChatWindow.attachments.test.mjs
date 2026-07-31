import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { DropToAttachOverlay } = await jiti.import("./ChatWindow.tsx");

test("drag-over overlay includes the Drop to attach affordance", () => {
  const html = renderToStaticMarkup(React.createElement(DropToAttachOverlay));
  assert.match(html, /Drop to attach/);
  assert.match(html, /drop-ripple/);
});
