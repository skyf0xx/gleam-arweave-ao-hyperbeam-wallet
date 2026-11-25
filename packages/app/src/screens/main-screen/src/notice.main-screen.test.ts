import { describe, expect, it } from "vitest";
import type { Announcement } from "@gleam/core";
import { findNewInvites, pickNotice, type NewInvites } from "./notice";

const A: Announcement = { id: "a", level: "info", text: "A" };
const B: Announcement = { id: "b", level: "critical", text: "B" };
const none = { invites: null, announcements: [], dismissed: [], review: null };
const INVITES: NewInvites = { walletId: "w1", address: "addr-1", seatsLeft: 3 };

describe("pickNotice", () => {
  it("shows nothing when there is nothing to show", () => {
    expect(pickNotice(none)).toBeNull();
  });

  it("shows the invite notice for the wallet that has new invites", () => {
    expect(pickNotice({ ...none, invites: INVITES })).toEqual({ kind: "invites", invites: INVITES });
  });

  it("puts the invite notice before announcements", () => {
    expect(pickNotice({ ...none, invites: INVITES, announcements: [A] })).toEqual({ kind: "invites", invites: INVITES });
  });

  it("shows the first announcement that is not dismissed", () => {
    const C: Announcement = { id: "c", level: "info", text: "C" };
    expect(pickNotice({ ...none, announcements: [A, C] })).toEqual({ kind: "announcement", announcement: A });
    expect(pickNotice({ ...none, announcements: [A, C], dismissed: ["a"] })).toEqual({ kind: "announcement", announcement: C });
    expect(pickNotice({ ...none, announcements: [A, C], dismissed: ["a", "c"] })).toBeNull();
  });

  it("puts a critical announcement first among announcements", () => {
    expect(pickNotice({ ...none, announcements: [A, B] })).toEqual({ kind: "announcement", announcement: B });
  });

  it("puts the review prompt after invites and critical announcements but before info ones", () => {
    const review = { kind: "send" } as const;
    expect(pickNotice({ ...none, review, announcements: [A] })).toEqual({ kind: "review", moment: review });
    expect(pickNotice({ ...none, review, announcements: [A, B] })).toEqual({ kind: "announcement", announcement: B });
    expect(pickNotice({ ...none, review, invites: INVITES })).toEqual({ kind: "invites", invites: INVITES });
  });
  it("ranks an update below a critical announcement and above the review prompt, until its version is dismissed", () => {
    const moment = { kind: "send" } as unknown as NonNullable<Parameters<typeof pickNotice>[0]["review"]>;
    expect(pickNotice({ ...none, update: "1.54.0", announcements: [B] })).toEqual({ kind: "announcement", announcement: B });
    expect(pickNotice({ ...none, update: "1.54.0", announcements: [A], review: moment })).toEqual({ kind: "update", version: "1.54.0" });
    expect(pickNotice({ ...none, update: "1.54.0", dismissed: ["update-1.54.0"], announcements: [A] })).toEqual({ kind: "announcement", announcement: A });
  });
});

describe("findNewInvites", () => {
  const member = (address: string) => ({ address, inviteCode: "C", referred: false, joinedAt: 0 });
  const memberships = { w1: member("addr-1"), w2: member("addr-2") };
  const scores = (one: number | null, two: number | null) => ({
    wallets: [
      { address: "addr-1", seatsLeft: one },
      { address: "addr-2", seatsLeft: two },
    ],
  }) as unknown as Parameters<typeof findNewInvites>[2];

  it("finds a wallet only when its seats rose above the last count seen", () => {
    expect(findNewInvites("w1", memberships, scores(3, 2), { w1: 2, w2: 2 })).toEqual(INVITES);
    expect(findNewInvites("w1", memberships, scores(2, 2), { w1: 2, w2: 2 })).toBeNull();
    expect(findNewInvites("w1", memberships, scores(1, 2), { w1: 2, w2: 2 })).toBeNull();
    expect(findNewInvites("w1", memberships, scores(3, 2), {})).toBeNull();
    expect(findNewInvites("w1", memberships, scores(null, 2), { w1: 2, w2: 2 })).toBeNull();
    expect(findNewInvites("w1", memberships, undefined, { w1: 2, w2: 2 })).toBeNull();
  });

  it("finds another wallet's new invites, so the notice matches the toolbar dot", () => {
    expect(findNewInvites("w1", memberships, scores(2, 4), { w1: 2, w2: 2 })).toEqual({
      walletId: "w2",
      address: "addr-2",
      seatsLeft: 4,
    });
  });

  it("prefers the active wallet's new invites", () => {
    expect(findNewInvites("w2", memberships, scores(3, 4), { w1: 2, w2: 2 })?.walletId).toBe("w2");
  });
});
