process.env.NODE_ENV = "test";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ticketEntryPreview } = require("../services/eventEntry.service");
const now = new Date("2030-01-01T12:00:00Z").getTime();
const event = { status: "LISTED", occurrence: 2, schedule: { from: new Date(now - 3600000), to: new Date(now + 86400000) } };
const ticket = { status: "UNREDEEMED", occurrence: 2, validSchedule: event.schedule };
test("scan preview returns the ticket's current date and permits an unused valid ticket", () => {
  const result = ticketEntryPreview(ticket, event, now);
  assert.equal(result.canCheckIn, true);
  assert.equal(result.entryClosed, false);
  assert.equal(result.eventDate, ticket.validSchedule.from);
});
for (const patch of [
  { occurrence: 1 }, { validSchedule: { to: new Date(now) } },
  { validSchedule: { to: "invalid" } }, { validSchedule: undefined },
]) test("scan preview rejects expired or unknown validity: " + JSON.stringify(patch), () => {
  const result = ticketEntryPreview({ ...ticket, ...patch }, event, now);
  assert.equal(result.canCheckIn, false);
  assert.equal(result.entryClosed, true);
  assert.equal(result.status, "EXPIRED");
  assert.equal(ticket.status, "UNREDEEMED");
});
test("scan preview uses the legacy snapshot only when no current validity exists", () => {
  assert.equal(ticketEntryPreview({ ...ticket, validSchedule: undefined, eventSnapshot: { schedule: { endDate: new Date(now + 1) } } }, event, now).canCheckIn, true);
});
for (const patch of [{ refundHold: true }, { status: "CANCELLED" }, { status: "REDEEMED" }, { checkIn: { isCheckedIn: true } }])
  test("scan preview never permits a held, cancelled or used ticket: " + JSON.stringify(patch), () => {
    assert.equal(ticketEntryPreview({ ...ticket, ...patch }, event, now).canCheckIn, false);
  });
test("scan preview closes entry even when the ticket itself still has future validity", () => {
  assert.equal(ticketEntryPreview(ticket, { ...event, status: "COMPLETED" }, now).entryClosed, true);
  assert.equal(ticketEntryPreview(ticket, { ...event, schedule: { to: new Date(now) } }, now).canCheckIn, false);
});

for (const end of [undefined, "invalid", new Date(0)]) {
  test("transfer rejects unknown, invalid or expired ticket validity: " + String(end), () => {
    const { assertTicketOccurrence } = require("../services/eventOccurrence.service");
    assert.throws(() => assertTicketOccurrence({ occurrence: 2, validSchedule: { to: end } }, event), /expired/);
  });
}
test("transfer accepts the same valid legacy snapshot as admission", () => {
  const { assertTicketOccurrence } = require("../services/eventOccurrence.service");
  assert.doesNotThrow(() => assertTicketOccurrence({ occurrence: 2, eventSnapshot: { schedule: { endDate: new Date(Date.now() + 86400000) } } }, event));
});
