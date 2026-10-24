import { describe, expect, it } from "vitest";
import type { Announcement } from "@gleam/core";
import { pickNotice } from "./notice";

const A: Announcement = { id: "a", level: "info", text: "A" };
const B: Announcement = { id: "b", level: "critical", text: "B" };
const none = { seatsLeft: null, seatsSeen: undefined, announcements: [], dismissed: [], review: null };

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
    expect(pickNotice({ ...none, seatsLeft: 3, seatsSeen: 2, announcements: [A] })).toEqual({ kind: "invites" });
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
    expect(pickNotice({ ...none, review, seatsLeft: 3, seatsSeen: 2 })).toEqual({ kind: "invites" });
  });
});
