export function CameraDeniedNotice() {
  return (
    <div role="alert" className="flex flex-col gap-2 text-body leading-relaxed text-warning">
      <p>Gleam can&apos;t use the camera.</p>
      <p className="text-muted">
        Click the camera or tune icon at the left of the address bar, set Camera to Allow, then try
        again. You can also open chrome://settings/content/camera and remove this extension from the
        blocked list.
      </p>
    </div>
  );
}

export const CAMERA_UNAVAILABLE_MESSAGE =
  "No camera was found, or another app is using it. Close other apps that use the camera and try again.";
