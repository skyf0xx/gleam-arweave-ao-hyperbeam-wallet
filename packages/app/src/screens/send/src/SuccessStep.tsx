import { useState } from "react";
import { explorerUrlFor } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { InlineInput } from "@gleam/ui/src/primitives/inline-input.tsx";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { useT } from "../../../i18n";

/** "Signed and sent." with what was sent, the explorer link and "Save as contact". */
export function SuccessStep({
  summary,
  txId,
  onDone,
  isSaved,
  onSaveAddress,
  saving,
}: {
  /** What went where, e.g. "1 AR to <address>". */
  summary: string;
  txId: string;
  onDone: () => void;
  /** Whether `step.recipient` is already a saved contact — hides "Save as contact" when true. */
  isSaved: boolean;
  onSaveAddress: (name: string) => void;
  saving: boolean;
}) {
  const t = useT();
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);

  return (
    <div className="flex min-h-full flex-col items-center gap-4 px-6 phone:px-5 pb-6 pt-12 text-center">
      <div className="mb-1 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-mist text-foreground">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 className="text-body text-foreground">{t("send.signedAndSent")}</h2>
      <p className="-mt-2 break-words text-label text-muted">{summary}</p>
      <div className="mt-2 flex w-full items-center gap-2 border-b border-line py-3 text-label text-muted phone:border-b-0">
        <span aria-hidden="true" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-beam-yellow" />
        <span>{t("send.pendingConfirmation")}</span>
      </div>
      <a
        href={explorerUrlFor(txId)}
        target="_blank"
        rel="noopener noreferrer"
        className="-mt-1 text-label font-semibold text-muted underline-offset-2 hover:text-foreground hover:underline"
      >
        {t("send.viewInExplorer")}
      </a>

      {!isSaved && !saved ? (
        <div className="w-full text-left">
          {showSave ? (
            <div className="flex items-center gap-2">
              <InlineInput
                type="text"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value.slice(0, 32))}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || name.trim().length === 0) return;
                  onSaveAddress(name.trim());
                  setSaved(true);
                }}
                placeholder={t("send.enterAddressName")}
                className="min-w-0 flex-1"
              />
              <button
                type="button"
                disabled={name.trim().length === 0 || saving}
                onClick={() => {
                  onSaveAddress(name.trim());
                  setSaved(true);
                }}
                className="flex-shrink-0 text-label font-semibold text-foreground underline-offset-2 hover:underline disabled:opacity-40"
              >
                {saving ? t("send.saving") : t("send.save")}
              </button>
            </div>
          ) : (
            <Button
              variant="link"
              size="bare"
              type="button"
              onClick={() => setShowSave(true)}
            >
              {t("send.saveAsContact")}
            </Button>
          )}
        </div>
      ) : null}

      <ScreenFooter>
        <Button type="button" onClick={onDone}>
          {t("send.done")}
        </Button>
      </ScreenFooter>
    </div>
  );
}
