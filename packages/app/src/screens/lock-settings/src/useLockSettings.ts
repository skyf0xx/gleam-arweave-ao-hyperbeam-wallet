import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AutoLockTimeout, LockSettings, RuntimePort } from "@gleam/core";

export const LOCK_SETTINGS_QUERY_KEY = ["lockSettings"] as const;

export function useLockSettings(runtime: RuntimePort) {
  return useQuery({
    queryKey: LOCK_SETTINGS_QUERY_KEY,
    queryFn: () => runtime.send<void, LockSettings>({ type: "getLockSettings", payload: undefined }),
  });
}

export function useSetAutoLockTimeout(runtime: RuntimePort) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (autoLockTimeout: AutoLockTimeout) =>
      runtime.send<LockSettings, void>({ type: "setLockSettings", payload: { autoLockTimeout } }),
    onSuccess: (_result, autoLockTimeout) => {
      queryClient.setQueryData<LockSettings>(LOCK_SETTINGS_QUERY_KEY, { autoLockTimeout });
    },
  });
}

export function useLockNow(runtime: RuntimePort) {
  return useMutation({
    mutationFn: () => runtime.send<void, void>({ type: "lockWallet", payload: undefined }),
  });
}
