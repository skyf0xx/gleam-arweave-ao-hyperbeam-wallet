import { describe, expect, it, vi } from "vitest";
import { foundingPost, gainedSeatPost, invitePost, invitesLine, lastSeatPost, xIntentUrl } from "./points-share";

vi.mock("wxt/browser", () => ({ browser: {} }));

const LINK = "https://gleam-permaweb.vercel.app/invite.html?c=MYCODE22";
const TAGS = "@ArweaveEco @aoTheComputer";

describe("share post builders", () => {
  it("builds the founding post", () => {
    expect(foundingPost({ seats: 3, link: LINK })).toBe(
      `Just got into @gleam_wallet and I'm now earning GLEAM. I have 3 invites if you want to get in early.\n${LINK}\n${TAGS}`,
    );
    expect(foundingPost({ seats: 1, link: LINK })).toContain("I have 1 invite if you want to get in early.");
  });

  it("leaves out what the server hasn't reported", () => {
    expect(foundingPost({ seats: null, link: LINK })).toBe(`Just got into @gleam_wallet and I'm now earning GLEAM.\n${LINK}\n${TAGS}`);
    expect(foundingPost({ seats: 0, link: LINK })).toBe(`Just got into @gleam_wallet and I'm now earning GLEAM.\n${LINK}\n${TAGS}`);
  });

  it("builds the gained-seat post with the invite link", () => {
    expect(gainedSeatPost({ link: LINK })).toBe(
      `Someone I invited just joined @gleam_wallet, so I got another invite. Who wants it?\n${LINK}\n${TAGS}`,
    );
  });

  it("builds the one-seat-left post without a link", () => {
    const post = lastSeatPost();
    expect(post).toBe(`I've got one @gleam_wallet invite left. Reply if you want it and I'll send it over.\n${TAGS}`);
    expect(post).not.toMatch(/https?:/);
  });

  it("builds the any-time post", () => {
    expect(invitePost({ seats: 3, link: LINK })).toBe(
      `Just joined @gleam_wallet and I'm now earning GLEAM. I have 3 invites if you want to get in early.\n${LINK}\n${TAGS}`,
    );
  });

  it("encodes a post into an X intent URL", () => {
    const url = xIntentUrl(lastSeatPost());
    expect(url.startsWith("https://x.com/intent/post?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1]!)).toBe(lastSeatPost());
  });

  it("words the invite count", () => {
    expect(invitesLine(0)).toBe("All your invites are used");
    expect(invitesLine(1)).toBe("You have 1 invite");
    expect(invitesLine(3)).toBe("You have 3 invites");
  });
});
