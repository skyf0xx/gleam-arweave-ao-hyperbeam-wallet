import { readSecurityPhrase, type SecurityPhrase, type StoragePort } from "@gleam/core";

const SECURITY_PHRASE_KEY = "local:securityPhrase";

/**
 * The anti-phishing phrase. It lives in plain `local` storage because the
 * unlock screen shows it before any password is typed; web pages can't
 * read extension storage, which is the whole point. It survives a vault
 * reset, like the theme.
 */
export class SecurityPhraseHandler {
  constructor(private readonly storage: StoragePort) {}

  async get(): Promise<SecurityPhrase | null> {
    return readSecurityPhrase(await this.storage.get<unknown>(SECURITY_PHRASE_KEY));
  }

  async set(req: SecurityPhrase): Promise<void> {
    const phrase = readSecurityPhrase(req);
    if (!phrase) throw new Error("Pick one of the emoji and a word of up to 24 letters or numbers.");
    await this.storage.set(SECURITY_PHRASE_KEY, phrase);
  }
}
