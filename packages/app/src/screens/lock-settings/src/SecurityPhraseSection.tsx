import { useEffect, useMemo, useState } from "react";
import { readSecurityPhrase, suggestSecurityPhrase, type RuntimePort, type SecurityPhrase } from "@gleam/core";
import { SecurityPhraseMark, SecurityPhrasePicker } from "@gleam/ui/src/components/security-phrase/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { securityPhraseIconSvg } from "../../../security-phrase-icon";
import { useAddressIdentity } from "../../../address-identity";

type SectionState =
  | { kind: "loading" }
  | { kind: "showing"; phrase: SecurityPhrase | null }
  | { kind: "editing"; phrase: SecurityPhrase | null; draft: SecurityPhrase; saving: boolean; error?: string };

/** Lock & unlock's anti-phishing phrase: shown, set up, or changed in place. */
export function SecurityPhraseSection({ runtime }: { runtime: RuntimePort }) {
  const { refresh: refreshAddressIdentity } = useAddressIdentity();
  const [state, setState] = useState<SectionState>({ kind: "loading" });
  const shownWord =
    state.kind === "editing" ? readSecurityPhrase(state.draft)?.word : state.kind === "showing" ? state.phrase?.word : undefined;
  const icon = useMemo(() => (shownWord ? securityPhraseIconSvg(shownWord) : undefined), [shownWord]);

  useEffect(() => {
    let cancelled = false;
    runtime
      .send<void, SecurityPhrase | null>({ type: "getSecurityPhrase", payload: undefined })
      .then(
        (phrase) => readSecurityPhrase(phrase),
        () => null,
      )
      .then((phrase) => {
        if (!cancelled) setState({ kind: "showing", phrase });
      });
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  const save = async (phrase: SecurityPhrase | null, draft: SecurityPhrase) => {
    setState({ kind: "editing", phrase, draft, saving: true });
    try {
      await runtime.send<SecurityPhrase, void>({ type: "setSecurityPhrase", payload: draft });
      refreshAddressIdentity();
      setState({ kind: "showing", phrase: readSecurityPhrase(draft) });
    } catch (error) {
      setState({
        kind: "editing",
        phrase,
        draft,
        saving: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="pb-10 phone:pb-8">
      <div className="border-b border-line pb-3.5 text-label font-semibold uppercase phone:border-b-0 phone:pb-1 tracking-[0.04em] text-muted">
        Anti-phishing phrase
      </div>
      {state.kind === "loading" ? (
        <SkeletonRow />
      ) : state.kind === "editing" ? (
        <form
          className="flex flex-col gap-4 pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (readSecurityPhrase(state.draft) && !state.saving) void save(state.phrase, state.draft);
          }}
        >
          <SecurityPhrasePicker
            value={state.draft}
            iconSvg={icon}
            onChange={(draft) => setState({ ...state, draft, error: undefined })}
            disabled={state.saving}
            errorMessage={state.error ?? (readSecurityPhrase(state.draft) ? undefined : "Use up to 24 letters or numbers.")}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={state.saving}
              onClick={() => setState({ kind: "showing", phrase: state.phrase })}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={state.saving || !readSecurityPhrase(state.draft)} className="flex-1">
              {state.saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      ) : state.phrase && icon ? (
        <div className="flex items-center gap-3 py-3.5">
          <SecurityPhraseMark phrase={state.phrase} iconSvg={icon} />
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setState({ kind: "editing", phrase: state.phrase, draft: state.phrase!, saving: false })}
            className="rounded-md px-2 py-1 text-label font-medium text-muted hover:bg-mist hover:text-foreground phone:flex phone:min-h-11 phone:items-center phone:px-3"
          >
            Change
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setState({ kind: "editing", phrase: null, draft: suggestSecurityPhrase(), saving: false })}
          className="flex w-full flex-col gap-0.5 py-3.5 text-left hover:bg-mist"
        >
          <span className="text-label font-semibold text-foreground">Set up an anti-phishing phrase</span>
          <span className="text-caption text-muted">A word and icon which only Gleam can show you</span>
        </button>
      )}
      <p className="pt-2.5 text-caption leading-relaxed text-faint">
        GLEAM shows this phrase before important actions to verify authenticity.
      </p>
    </div>
  );
}
