import { describe, expect, it, vi } from "vitest";
import { foundingPost, gainedSeatPost, invitePost, invitesLine, lastSeatPost, xIntentUrl } from "./points-share";

vi.mock("wxt/browser", () => ({ browser: {} }));

const LINK = "https://gleam-permaweb.vercel.app/invite.html?c=MYCODE22";

describe("share post builders", () => {
  it("builds the founding post", () => {
    expect(foundingPost({ foundingNumber: 184, seats: 3, link: LINK })).toBe(
      `Just got into @gleam_wallet, the new wallet for AO. I'm Founding #184 and I have 3 invites. ${LINK}`,
    );
    expect(foundingPost({ foundingNumber: 184, seats: 1, link: LINK })).toContain("I have 1 invite.");
  });

  it("leaves out what the server hasn't reported", () => {
    expect(foundingPost({ foundingNumber: null, seats: null, link: LINK })).toBe(
      `Just got into @gleam_wallet, the new wallet for AO. ${LINK}`,
    );
    expect(foundingPost({ foundingNumber: 184, seats: 0, link: LINK })).toContain("I'm Founding #184.");
  });

  it("builds the gained-seat post with the invite link", () => {
    expect(gainedSeatPost({ link: LINK })).toBe(
      `Someone I invited just joined @gleam_wallet, so I got another invite. Who wants it? ${LINK}`,
    );
  });

  it("builds the one-seat-left post without a link", () => {
    const post = lastSeatPost();
    expect(post).toBe("Last @gleam_wallet invite. Reply if you want it and I'll send it over.");
    expect(post).not.toMatch(/https?:/);
  });

  it("builds the any-time post", () => {
    expect(invitePost({ foundingNumber: 184, seats: 3, link: LINK })).toBe(
      `I'm Founding Gleam #184. Early to a new wallet for AO. I have 3 invites: ${LINK}`,
    );
  });

  it("encodes a post into an X intent URL", () => {
    const url = xIntentUrl(lastSeatPost());
    expect(url.startsWith("https://x.com/intent/post?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1]!)).toBe(lastSeatPost());
  });

  it("words the invite count", () => {
    expect(invitesLine(0)).toBe("You have no invites left");
    expect(invitesLine(1)).toBe("You have 1 invite");
    expect(invitesLine(3)).toBe("You have 3 invites");
  });
});
