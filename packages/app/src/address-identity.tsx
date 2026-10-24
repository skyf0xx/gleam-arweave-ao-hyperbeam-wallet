import { createContext, useContext } from "react";
import { addressEmphasisPick, readSecurityPhrase, type RuntimePort } from "@gleam/core";
import { generateAccountAvatarSvg } from "./account-avatar";

/** What the user's security phrase decides about how addresses look. */
export interface AddressIdentityKey {
  securityPhraseWord: string | null;
  emphasisPick: number | null;
}

export interface AddressIdentity {
  emphasisPick: number | null;
  avatarSvg: (address: string) => string;
  /** Rereads the security phrase after it changes. */
  refresh: () => void;
}

export const NO_ADDRESS_IDENTITY_KEY: AddressIdentityKey = { securityPhraseWord: null, emphasisPick: null };

/** Never rejects: without a readable phrase, addresses use the unsalted defaults. */
export async function loadAddressIdentityKey(runtime: RuntimePort): Promise<AddressIdentityKey> {
  try {
    const phrase = readSecurityPhrase(await runtime.send<void, unknown>({ type: "getSecurityPhrase", payload: undefined }));
    const securityPhraseWord = phrase?.word ?? null;
    return { securityPhraseWord, emphasisPick: await addressEmphasisPick(securityPhraseWord) };
  } catch {
    return NO_ADDRESS_IDENTITY_KEY;
  }
}

export function makeAddressIdentity(key: AddressIdentityKey, refresh: () => void): AddressIdentity {
  const avatars = new Map<string, string>();
  return {
    emphasisPick: key.emphasisPick,
    avatarSvg: (address) => {
      let svg = avatars.get(address);
      if (svg === undefined) {
        svg = generateAccountAvatarSvg(address, key.securityPhraseWord);
        avatars.set(address, svg);
      }
      return svg;
    },
    refresh,
  };
}

const AddressIdentityContext = createContext<AddressIdentity>(makeAddressIdentity(NO_ADDRESS_IDENTITY_KEY, () => {}));

export const AddressIdentityProvider = AddressIdentityContext.Provider;

export function useAddressIdentity(): AddressIdentity {
  return useContext(AddressIdentityContext);
}
