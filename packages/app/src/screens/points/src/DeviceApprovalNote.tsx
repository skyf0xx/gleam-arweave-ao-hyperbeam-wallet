import { useT } from "../../../i18n";

/** A hardware wallet proves ownership on the device, in the approval window the background opens. */
export function DeviceApprovalNote() {
  const t = useT();
  return (
    <p role="status" className="text-center text-caption text-muted">
      {t("points.deviceApproval")}
    </p>
  );
}
