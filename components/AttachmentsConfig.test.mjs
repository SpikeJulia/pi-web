import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { advanceCleanupConfirmation } = await jiti.import("./AttachmentsConfig.tsx");

test("session cleanup requires one explicit confirmation before execution", () => {
  assert.equal(advanceCleanupConfirmation("single", "idle"), "ready-to-run");
  assert.equal(advanceCleanupConfirmation("single", "ready-to-run"), "execute");
});

test("project cleanup retains its two-level confirmation ladder", () => {
  assert.equal(advanceCleanupConfirmation("double", "idle"), "confirming-path");
  assert.equal(advanceCleanupConfirmation("double", "confirming-path"), "ready-to-run");
  assert.equal(advanceCleanupConfirmation("double", "ready-to-run"), "execute");
});
