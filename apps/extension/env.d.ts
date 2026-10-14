interface ImportMetaEnv {
  /** Full sha of the commit the build came from, or "unknown" outside a git checkout. */
  readonly VITE_GLEAM_COMMIT: string;
}
