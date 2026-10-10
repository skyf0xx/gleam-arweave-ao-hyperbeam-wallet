import { describe, expect, it } from "vitest";
import type { Announcement } from "@gleam/core";
import { pickNotice } from "./notice";

const A: Announcement = { id: "a", level: "info", text: "A" };
const B: Announcement = { id: "b", level: "critical", text: "B" };
const none = { seatsLeft: null, seatsSeen: undefined, announcements: [], dismissed: [] };

describe("pickNotice", () => {
  it("shows nothing when there is nothing to show", () => {
    expect(pickNotice(none)).toBeNull();
  });

  it("shows the invite notice only when seats rose above the last count seen", () => {
    expect(pickNotice({ ...none, seatsLeft: 3, seatsSeen: 2 })).toEqual({ kind: "invites" });
    expect(pickNotice({ ...none, seatsLeft: 2, seatsSeen: 2 })).toBeNull();
    expect(pickNotice({ ...none, seatsLeft: 1, seatsSeen: 2 })).toBeNull();
    expect(pickNotice({ ...none, seatsLeft: 3, seatsSeen: undefined })).toBeNull();
    expect(pickNotice({ ...none, seatsLeft: null, seatsSeen: 2 })).toBeNull();
  });

  it("puts the invite notice before announcements", () => {
    expect(pickNotice({ seatsLeft: 3, seatsSeen: 2, announcements: [A], dismissed: [] })).toEqual({ kind: "invites" });
  });

  it("shows the first announcement that is not dismissed", () => {
    expect(pickNotice({ ...none, announcements: [A, B], dismissed: [] })).toEqual({ kind: "announcement", announcement: A });
    expect(pickNotice({ ...none, announcements: [A, B], dismissed: ["a"] })).toEqual({ kind: "announcement", announcement: B });
    expect(pickNotice({ ...none, announcements: [A, B], dismissed: ["a", "b"] })).toBeNull();
  });
});
