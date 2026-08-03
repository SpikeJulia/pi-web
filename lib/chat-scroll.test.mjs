import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  return import("./chat-scroll.ts");
}

test("isNearBottom treats small layout drift as pinned", async () => {
  const { isNearBottom, distanceFromBottom } = await loadSubject();
  const metrics = { scrollTop: 900, scrollHeight: 1950, clientHeight: 1000 };

  assert.equal(distanceFromBottom(metrics), 50);
  assert.equal(isNearBottom(metrics), true);
});

test("isNearBottom detects when the user is reading the middle of history", async () => {
  const { isNearBottom } = await loadSubject();

  assert.equal(isNearBottom({ scrollTop: 600, scrollHeight: 2400, clientHeight: 900 }), false);
});

test("content-bottom scroll target stops before the running spacer", async () => {
  const { getScrollTopForContentBottom } = await loadSubject();

  assert.equal(getScrollTopForContentBottom({
    containerScrollTop: 1200,
    containerTop: 100,
    containerClientHeight: 800,
    markerTop: 1500,
  }), 1800);
});

test("content-bottom scroll target never goes negative", async () => {
  const { getScrollTopForContentBottom } = await loadSubject();

  assert.equal(getScrollTopForContentBottom({
    containerScrollTop: 0,
    containerTop: 100,
    containerClientHeight: 800,
    markerTop: 300,
  }), 0);
});

test("page return jumps to the latest message when the agent is still running", async () => {
  const { shouldRestoreBottomOnPageReturn } = await loadSubject();

  assert.equal(shouldRestoreBottomOnPageReturn({
    hasMessages: true,
    pageWasHidden: true,
    agentRunningNow: true,
  }), true);
});

test("page return keeps the previous position when the agent already stopped", async () => {
  const { shouldRestoreBottomOnPageReturn } = await loadSubject();

  assert.equal(shouldRestoreBottomOnPageReturn({
    hasMessages: true,
    pageWasHidden: true,
    agentRunningNow: false,
  }), false);
});

test("page return ignores focus when the page was not hidden", async () => {
  const { shouldRestoreBottomOnPageReturn } = await loadSubject();

  assert.equal(shouldRestoreBottomOnPageReturn({
    hasMessages: true,
    pageWasHidden: false,
    agentRunningNow: true,
  }), false);
});

test("page return does nothing when there are no messages", async () => {
  const { shouldRestoreBottomOnPageReturn } = await loadSubject();

  assert.equal(shouldRestoreBottomOnPageReturn({
    hasMessages: false,
    pageWasHidden: true,
    agentRunningNow: true,
  }), false);
});
