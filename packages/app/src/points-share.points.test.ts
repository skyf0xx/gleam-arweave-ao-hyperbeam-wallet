import { describe, expect, it } from "vitest";
import { inviteLinkFor, invitesLine, invitesRemainingLine } from "./points-share";

describe("invite sharing", () => {
  it("links to the invite page with the code", () => {
    expect(inviteLinkFor("MYCODE22")).toBe("https://gleamwallet.app/invite.html?c=MYCODE22");
  });

  it("words the invite count", () => {
    expect(invitesLine(0)).toBe("All your invites are used");
    expect(invitesLine(1)).toBe("You have 1 invite");
    expect(invitesLine(3)).toBe("You have 3 invites");
    expect(invitesRemainingLine(0)).toBe("All your invites are used");
    expect(invitesRemainingLine(1)).toBe("1 invite remaining");
    expect(invitesRemainingLine(3)).toBe("3 invites remaining");
  });
});
