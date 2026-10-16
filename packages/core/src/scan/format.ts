/**
 * A release is plain `x.y.z`: it sits between colons in the signed
 * message, and the release gate tags nothing else.
 */
export const RELEASE_PATTERN = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

/** The id is quoted in PRs and advisories, so it is plain lowercase hex. */
export const ATTESTATION_ID_PATTERN = /^[0-9a-f]{64}$/;
