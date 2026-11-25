/** The `code` a Capacitor plugin rejection carries, whatever was thrown. */
export function pluginErrorCode(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}
