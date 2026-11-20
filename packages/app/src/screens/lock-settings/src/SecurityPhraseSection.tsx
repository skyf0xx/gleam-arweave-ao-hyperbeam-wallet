import { useEffect, useMemo, useState } from "react";
import { readSecurityPhrase, suggestSecurityPhrase, type RuntimePort, type SecurityPhrase } from "@gleam/core";
import { SecurityPhraseMark, SecurityPhrasePicker } from "@gleam/ui/src/components/security-phrase/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { securityPhraseIconSvg } from "../../../security-phrase-icon";
import { useAddressIdentity } from "../../../address-identity";
import { useT } from "../../../i18n";
import { errorText } from "../../../i18n/errors";

type SectionState =
  | { kind: "loading" }
  | { kind: "showing"; phrase: SecurityPhrase | null }
  | { kind: "editing"; phrase: SecurityPhrase | null; draft: SecurityPhrase; saving: boolean; error?: string };

/** Lock & unlock's anti-phishing phrase: shown, set up, or changed in place. */
export function SecurityPhraseSection({ runtime }: { runtime: RuntimePort }) {
  const t = useT();
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
        error: errorText(error),
      });
    }
  };

  return (
    <div className="pb-10 phone:pb-8">
      <div className="pb-1 text-label font-semibold uppercase tracking-[0.04em] text-muted">
        {t("lockSettings.phraseTitle")}
      </div>
      {state.kind === "loading" ? (
        <SkeletonRow />
      ) : state.kind === "editing" ? (
        <form
          className="flex flex-col gap-4 pb-3 pt-4"
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
            errorMessage={state.error ?? (readSecurityPhrase(state.draft) ? undefined : t("lockSettings.phraseInvalid"))}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={state.saving}
              onClick={() => setState({ kind: "showing", phrase: state.phrase })}
              className="flex-1"
            >
              {t("lockSettings.cancel")}
            </Button>
            <Button type="submit" disabled={state.saving || !readSecurityPhrase(state.draft)} className="flex-1">
              {state.saving ? t("lockSettings.saving") : t("lockSettings.save")}
            </Button>
          </div>
        </form>
      ) : state.phrase && icon ? (
        <div className="flex items-center gap-3 pt-3.5">
          <SecurityPhraseMark phrase={state.phrase} iconSvg={icon} />
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setState({ kind: "editing", phrase: state.phrase, draft: state.phrase!, saving: false })}
            className="rounded-md px-2 py-1 text-label font-medium text-muted hover:bg-hover hover:text-foreground phone:-my-2.5 phone:flex phone:min-h-11 phone:items-center phone:px-3"
          >
            {t("lockSettings.change")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setState({ kind: "editing", phrase: null, draft: suggestSecurityPhrase(), saving: false })}
          className="-mx-3 flex w-[calc(100%+1.5rem)] flex-col gap-0.5 rounded-lg px-3 py-3.5 text-left hover:bg-hover"
        >
          <span className="text-label font-semibold text-foreground">{t("lockSettings.phraseSetUp")}</span>
          <span className="text-caption text-muted">{t("lockSettings.phraseSetUpHint")}</span>
        </button>
      )}
      <p className="pt-1 text-caption leading-relaxed text-faint">
        {t("lockSettings.phraseExplain")}
      </p>
    </div>
  );
}
