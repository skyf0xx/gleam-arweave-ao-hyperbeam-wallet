export interface ShareCardContent {
  foundingNumber: number;
  /** Null or 0 leaves the invites line off the card. */
  seatsLeft: number | null;
}

/** Twice the 600x315 card the popup shows, in X's 1.91:1 link-card ratio. */
const WIDTH = 1200;
const HEIGHT = 630;
const BEAM = ["#ff1717", "#8b12ff", "#73c9e8", "#ffe45c", "#28f02d"];
const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';

export function inviteCountLabel(seats: number | null): string | null {
  if (seats === null || seats <= 0) return null;
  return `${seats} ${seats === 1 ? "invite" : "invites"}`;
}

/**
 * Draws the share card (POINTS.md § Messaging) the way the popup shows it,
 * in the light palette whatever the user's theme: the image is posted, so it
 * must not depend on where it was saved.
 */
export function renderShareCardPng(content: ShareCardContent): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Couldn't draw the card."));

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const segment = WIDTH / BEAM.length;
  BEAM.forEach((color, index) => {
    ctx.fillStyle = color;
    ctx.fillRect(index * segment, 0, segment, 14);
  });

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = "#737373";
  ctx.font = `600 38px ${FONT}`;
  ctx.fillText("OG", 84, 168);
  ctx.fillStyle = "#111111";
  ctx.font = `700 220px ${FONT}`;
  ctx.fillText(`#${content.foundingNumber}`, 76, 372);
  const invites = inviteCountLabel(content.seatsLeft);
  if (invites) {
    ctx.font = `600 46px ${FONT}`;
    ctx.fillText(invites, 84, 462);
  }
  ctx.fillStyle = "#a3a3a3";
  ctx.font = `400 30px ${FONT}`;
  ctx.fillText("You are early", 84, 556);
  ctx.textAlign = "right";
  ctx.fillStyle = "#111111";
  ctx.font = `700 38px ${FONT}`;
  ctx.fillText("Gleam", WIDTH - 84, 556);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Couldn't save the image.")),
      "image/png",
    );
  });
}

export async function saveShareCardImage(
  content: ShareCardContent,
): Promise<void> {
  const blob = await renderShareCardPng(content);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `gleam-founding-${content.foundingNumber}.png`;
  document.body.append(link);
  link.click();
  link.remove();
  // The download has started by the next task; revoking sooner can cancel it.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
