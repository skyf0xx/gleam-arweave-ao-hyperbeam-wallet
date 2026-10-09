/**
 * Build-time switch for the Founding gate (Phase 1). Set
 * `WXT_FOUNDING_GATE=false` for the Phase 2 build; it's on otherwise.
 */
export const FOUNDING_GATE = import.meta.env.WXT_FOUNDING_GATE !== "false";
