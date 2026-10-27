/** `help` says where this shell lets the user turn the camera back on. */
export function CameraDeniedNotice({ help }: { help: string }) {
  return (
    <div role="alert" className="flex flex-col gap-2 text-body leading-relaxed text-warning">
      <p>Gleam can&apos;t use the camera.</p>
      <p className="text-muted">{help}</p>
    </div>
  );
}

export const CAMERA_UNAVAILABLE_MESSAGE =
  "No camera was found, or another app is using it. Close other apps that use the camera and try again.";
