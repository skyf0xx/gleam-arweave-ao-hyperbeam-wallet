import { useState } from "react";

/**
 * A password input's value, emptied once each new server rejection arrives.
 * State is adjusted during render rather than in an effect
 * (react-hooks/set-state-in-effect).
 */
export function usePasswordEntry({ submitting, serverError }: { submitting: boolean; serverError?: string }) {
  const [password, setPassword] = useState("");
  const [clearedFor, setClearedFor] = useState<string | undefined>(undefined);
  // Reset while submitting so a repeat of the same rejection clears again.
  if (submitting && clearedFor !== undefined) setClearedFor(undefined);
  if (!submitting && serverError && serverError !== clearedFor) {
    setClearedFor(serverError);
    setPassword("");
  }
  return { password, setPassword };
}
