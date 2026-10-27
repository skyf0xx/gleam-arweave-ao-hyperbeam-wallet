import { registerPlugin } from "@capacitor/core";
import type { InAppReviewPlugin } from "@capacitor-community/in-app-review";
import type { StoreReviewPort } from "@gleam/app/src/app-platform/types.ts";

// The package's own entry point registers a web fallback that has no place
// in a wallet bundle. This registers the same native plugin ("InAppReview"
// is its `jsName` on iOS and its `@CapacitorPlugin` name on Android). Types
// only come from the package.
/**
 * StoreKit and Play In-App Review decide whether anything shows (quota,
 * TestFlight and debug builds show nothing) and resolve either way, so the
 * promise says nothing about whether a review was left. App Store guideline
 * 5.6.1 allows only this system prompt, never a link to a review page.
 */
export function createStoreReview(): StoreReviewPort {
  const InAppReview = registerPlugin<InAppReviewPlugin>("InAppReview");
  return {
    opensPage: false,
    request: () => InAppReview.requestReview(),
  };
}
