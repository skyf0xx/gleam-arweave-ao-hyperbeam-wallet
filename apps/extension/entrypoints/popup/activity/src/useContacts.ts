import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Contact, RuntimePort } from "@gleam/core";
import { walletQueryKeys } from "./queryKeys";

/**
 * Shared, cached source of truth for the address book — one list for the
 * whole vault, not scoped to `wallet.address` (see `walletQueryKeys.contacts`).
 * `SendView`'s recipient list and (part 2) Settings' contacts screen both
 * read through this one query.
 */
export function useContacts(runtime: RuntimePort) {
  return useQuery({
    queryKey: walletQueryKeys.contacts(),
    queryFn: () => runtime.send<void, Contact[]>({ type: "listContacts", payload: undefined }),
  });
}

export interface SaveContactVariables {
  address: string;
  name: string;
}

export function useSaveContact(runtime: RuntimePort) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: SaveContactVariables) =>
      runtime.send<SaveContactVariables, Contact>({ type: "saveContact", payload: variables }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: walletQueryKeys.contacts() });
    },
  });
}
