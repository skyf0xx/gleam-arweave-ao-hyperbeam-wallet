import { useEffect, useState } from "react";
import type { ActivityEntry, RuntimePort } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { Sheet } from "@gleam/ui/src/primitives/sheet.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import { AddressDisplay } from "@gleam/ui/src/components/wallet/index.ts";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { useT } from "../../../i18n";
import { errorText } from "../../../i18n/errors";
import { useSaveContact } from "../../activity/src/useContacts";

export interface ActivityDetail {
  entry: ActivityEntry;
  title: string;
  subtitle: string;
  amountLabel: string | undefined;
  /** The saved contact or own-wallet name for `entry.address`, if any. */
  name: string | undefined;
  /** Opens send prefilled with `entry.address`; absent when the entry's token can't be sent from here. */
  onSendTo: (() => void) | undefined;
}

export interface ActivityDetailSheetProps {
  runtime: RuntimePort;
  detail: ActivityDetail | null;
  onClose: () => void;
  onViewInExplorer: (txId: string) => void;
  container: HTMLElement | null;
}

export function ActivityDetailSheet({ runtime, detail, onClose, onViewInExplorer, container }: ActivityDetailSheetProps) {
  const t = useT();
  // Held so the content stays put while the sheet animates closed.
  const [shown, setShown] = useState<ActivityDetail | null>(detail);
  useEffect(() => {
    if (detail) setShown(detail);
  }, [detail]);

  return (
    <Sheet open={detail !== null} onOpenChange={(open) => !open && onClose()} label={t("mainScreen.detailLabel")} container={container}>
      {shown ? <DetailBody key={shown.entry.txId} runtime={runtime} detail={shown} onViewInExplorer={onViewInExplorer} /> : null}
    </Sheet>
  );
}

function DetailBody({ runtime, detail, onViewInExplorer }: { runtime: RuntimePort; detail: ActivityDetail; onViewInExplorer: (txId: string) => void }) {
  const t = useT();
  const { entry } = detail;
  const saveContact = useSaveContact(runtime);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState<string | undefined>(undefined);
  const knownName = detail.name ?? savedName;

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveContact
      .mutateAsync({ address: entry.address, name: trimmed })
      .then(() => {
        setSavedName(trimmed);
        setNaming(false);
      })
      .catch(() => undefined);
  };

  const cancel = () => {
    setNaming(false);
    setName("");
    saveContact.reset();
  };

  const isUpload = entry.type === "upload";
  const txLink = (
    <button
      type="button"
      onClick={() => onViewInExplorer(entry.txId)}
      title={t("mainScreen.viewInExplorer")}
      className="flex items-center gap-1.5 self-center text-label text-muted hover:text-foreground phone:min-h-11"
    >
      <span className="font-mono">{truncateAddress(entry.txId, 6)}</span> · {detail.subtitle}
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 17 17 7M8 7h9v9" />
      </svg>
    </button>
  );

  return (
    <div className="flex flex-col gap-6 px-6 pb-6 pt-4 phone:px-5">
      <div className="flex flex-col items-center gap-1 text-center">
        {detail.amountLabel ? <p className="text-h2 font-semibold tracking-tight text-foreground">{detail.amountLabel}</p> : null}
        {isUpload ? <p className="text-label text-muted">{detail.title}</p> : null}
      </div>

      <div className="flex flex-col gap-2">
        {isUpload ? null : (
          <p className="text-label font-semibold text-muted">
            {entry.type === "send" ? t("send.to") : t("send.from")}
            {knownName !== undefined ? <span className="font-normal text-foreground"> {knownName}</span> : null}
          </p>
        )}
        <AddressDisplay address={entry.address} onCopy={() => void navigator.clipboard?.writeText(entry.address)} />
        {knownName === undefined && !naming && !isUpload ? (
          <button type="button" onClick={() => setNaming(true)} className="self-start text-caption text-muted underline-offset-2 hover:underline phone:min-h-11">
            {t("mainScreen.saveAddress")}
          </button>
        ) : null}
      </div>

      {naming ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <TextField
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                cancel();
              }
            }}
            placeholder={t("mainScreen.contactName")}
            aria-label={t("mainScreen.contactName")}
            errorMessage={saveContact.error instanceof Error ? errorText(saveContact.error) : undefined}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={cancel}>
              {t("mainScreen.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={!name.trim() || saveContact.isPending}>
              {t("mainScreen.save")}
            </Button>
          </div>
        </form>
      ) : null}

      {detail.onSendTo ? (
        <Button onClick={detail.onSendTo}>{entry.type === "send" ? t("mainScreen.resendToAddress") : t("mainScreen.sendToAddress")}</Button>
      ) : null}

      {txLink}
    </div>
  );
}
