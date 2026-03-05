export type { RefMap, RefEntry, EnhancedSnapshot, SnapshotOptions } from "./types.js";
export { getEnhancedSnapshot } from "./extractor.js";
export { getSnapshotStore, resetSnapshotStore } from "./store.js";
export { annotateScreenshot } from "./annotator.js";
export { generateBoundary, wrapContent } from "./boundary.js";
export { diffSnapshots, diffScreenshots } from "./differ.js";
export type { TextDiffResult, ImageDiffResult, ImageDiffOptions } from "./differ.js";
