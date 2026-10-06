const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCompletionFilter, markCompletedEvents } = require("../jobs/eventCompletion.job");

test("buildCompletionFilter constructs correct query with type guards", () => {
  const cutoff = new Date("2030-05-01T12:00:00Z");
  const singleDayCutoff = new Date("2030-04-30T12:00:00Z");
  const filter = buildCompletionFilter(cutoff, singleDayCutoff);

  assert.deepEqual(filter.status, { $in: ["LISTED", "ACTION_REQUIRED", "UNLISTED"] });
  assert.equal(filter.$or.length, 2);

  // Branch 1: Explicit schedule.to must be a Date and less than cutoff
  assert.deepEqual(filter.$or[0]["schedule.to"], { $type: "date", $lt: cutoff });

  // Branch 2: Absent/null/empty schedule.to falls back to schedule.from < singleDayCutoff
  const branch2 = filter.$or[1].$and;
  assert.equal(branch2.length, 2);
  assert.deepEqual(branch2[1]["schedule.from"], { $type: "date", $lt: singleDayCutoff });
});

test("markCompletedEvents updates past multi-day events and expired single-day events", async () => {
  const now = new Date("2030-05-10T12:00:00Z");

  const events = [
    // 1. Past multi-day event with schedule.to in past -> should complete
    {
      _id: "e1",
      status: "LISTED",
      schedule: { from: new Date("2030-05-01T09:00:00Z"), to: new Date("2030-05-03T18:00:00Z") },
    },
    // 2. Future multi-day event -> should NOT complete
    {
      _id: "e2",
      status: "LISTED",
      schedule: { from: new Date("2030-05-09T09:00:00Z"), to: new Date("2030-05-15T18:00:00Z") },
    },
    // 3. Single-day event with schedule.from 3 days ago and no schedule.to -> should complete
    {
      _id: "e3",
      status: "LISTED",
      schedule: { from: new Date("2030-05-07T09:00:00Z"), to: null },
    },
    // 4. Single-day event with schedule.from 2 hours ago (within 24h event day) -> should NOT complete prematurely
    {
      _id: "e4",
      status: "LISTED",
      schedule: { from: new Date("2030-05-10T10:00:00Z"), to: null },
    },
    // 5. Future single-day event starting next week with schedule.to: null -> should NOT complete
    {
      _id: "e5",
      status: "LISTED",
      schedule: { from: new Date("2030-05-17T10:00:00Z"), to: null },
    },
  ];

  let executedQuery = null;
  let executedUpdate = null;

  const MockEventModel = {
    updateMany: async (query, update) => {
      executedQuery = query;
      executedUpdate = update;

      const completionCutoff = query.$or[0]["schedule.to"].$lt;
      const singleDayCutoff = query.$or[1].$and[1]["schedule.from"].$lt;

      const matched = events.filter((e) => {
        if (!query.status.$in.includes(e.status)) return false;

        const hasExplicitTo = e.schedule.to instanceof Date;
        if (hasExplicitTo) {
          return e.schedule.to < completionCutoff;
        }

        const isToEmpty = !e.schedule.to;
        const isFromPast = e.schedule.from instanceof Date && e.schedule.from < singleDayCutoff;
        return isToEmpty && isFromPast;
      });

      return { modifiedCount: matched.length };
    },
  };

  const result = await markCompletedEvents({
    EventModel: MockEventModel,
    settingsOverride: {
      lifecycle: {
        autoCompletePastEvents: true,
        completionGraceHours: 0,
      },
    },
    now,
  });

  // e1 and e3 should be marked COMPLETED. e2, e4, e5 must remain active!
  assert.equal(result.modifiedCount, 2);
  assert.deepEqual(executedUpdate, { $set: { status: "COMPLETED" } });
});

test("markCompletedEvents returns 0 when autoCompletePastEvents is disabled in settings", async () => {
  let updateCalled = false;
  const MockEventModel = {
    updateMany: async () => {
      updateCalled = true;
      return { modifiedCount: 0 };
    },
  };

  const result = await markCompletedEvents({
    EventModel: MockEventModel,
    settingsOverride: {
      lifecycle: {
        autoCompletePastEvents: false,
      },
    },
  });

  assert.equal(result.modifiedCount, 0);
  assert.equal(updateCalled, false);
});
