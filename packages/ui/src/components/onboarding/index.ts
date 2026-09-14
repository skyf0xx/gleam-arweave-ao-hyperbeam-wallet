export { BeamMark, type BeamMarkProps } from "./BeamMark";
export { StepDots, type StepDotsProps } from "./StepDots";
export { PasswordField, type PasswordFieldProps } from "./PasswordField";
export {
  PasswordStrengthMeter,
  type PasswordStrengthMeterProps,
} from "./PasswordStrengthMeter";
export { AddressReveal, type AddressRevealProps } from "./AddressReveal";

/**
 * `ScreenHeader` itself was retired from this directory (migrated onto
 * the shared, token-consuming `packages/ui/src/primitives/screen-header`
 * per this task's inherited debt note) — re-exported here only because
 * several screens outside this task's ALLOWED SCOPE (send, receive,
 * activity, upload, connected-apps) still import it from this barrel.
 * Repointing those call sites directly at the primitive belongs to
 * whichever later layer's scope covers those files; see this task's
 * declared debt.
 */
export { ScreenHeader, type ScreenHeaderProps } from "../../primitives/screen-header";
