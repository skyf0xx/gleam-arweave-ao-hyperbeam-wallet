import { useState } from "react";
import { isValidArweaveAddress } from "@gleam/core";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { Sheet } from "@gleam/ui/src/primitives/sheet.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import { useT } from "../../../i18n";

export interface ChangeTargetSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  container: HTMLElement | null;
  /** The name's current target; entering it again changes nothing, so Review stays off. */
  current?: string;
  onReview: (target: string) => void;
}

/** One id field, then the review. */
export function ChangeTargetSheet({ open, onOpenChange, container, current, onReview }: ChangeTargetSheetProps) {
  const t = useT();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const target = value.trim();
  const valid = isValidArweaveAddress(target);

  const submit = () => {
    if (!valid) {
      setError(t("errors.nameTargetInvalid"));
      return;
    }
    onReview(target);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} label={t("collectibles.changeTarget")} container={container}>
      <form
        className="flex flex-col gap-5 px-6 pb-6 pt-4 phone:px-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 className="text-h3 font-semibold text-foreground">{t("collectibles.changeTarget")}</h2>
        <TextField
          label={t("collectibles.newTarget")}
          value={value}
          dir="ltr"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="font-mono"
          errorMessage={error}
          onChange={(event) => {
            setValue(event.target.value);
            setError(undefined);
          }}
          onBlur={() => {
            if (target.length > 0 && !valid) setError(t("errors.nameTargetInvalid"));
          }}
        />
        <Button type="submit" disabled={target.length === 0 || target === current}>
          {t("send.reviewAndSend")}
        </Button>
      </form>
    </Sheet>
  );
}
