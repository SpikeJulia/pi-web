export const DEFAULT_BOTTOM_RESTORE_THRESHOLD_PX = 96;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface PageReturnScrollState {
  hasMessages: boolean;
  pageWasHidden: boolean;
  agentRunningNow: boolean;
}

export interface ContentBottomScrollMetrics {
  containerScrollTop: number;
  containerTop: number;
  containerClientHeight: number;
  markerTop: number;
}

export function distanceFromBottom(metrics: ScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop);
}

export function isNearBottom(
  metrics: ScrollMetrics,
  thresholdPx = DEFAULT_BOTTOM_RESTORE_THRESHOLD_PX,
): boolean {
  return distanceFromBottom(metrics) <= thresholdPx;
}

export function shouldRestoreBottomOnPageReturn(state: PageReturnScrollState): boolean {
  return state.hasMessages && state.pageWasHidden && state.agentRunningNow;
}

export function getScrollTopForContentBottom(metrics: ContentBottomScrollMetrics): number {
  return Math.max(0, metrics.containerScrollTop + metrics.markerTop - metrics.containerTop - metrics.containerClientHeight);
}
