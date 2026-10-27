const mongoose = require("mongoose");
const Event = require("../../models/client/event.schema");
const Tickets = require("../../models/client/userEventTicket.schema");
const Types = require("../../models/client/eventTicketType.schema");
const Refund = require("../../models/client/eventRefund.schema");
const User = require("../../models/client/user.schema");
const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const oid = (value) => {
  if (!mongoose.isValidObjectId(value)) throw invalid("Invalid identifier.");
  return new mongoose.Types.ObjectId(value);
};
async function owner(req) {
  const event = await Event.findById(oid(req.params.id))
    .select("createdBy")
    .lean();
  if (!event || String(event.createdBy) !== String(req.user.id))
    throw Object.assign(new Error("Event not found."), { status: 404 });
  return event;
}
function paging(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 25 : Number(query.limit);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw invalid("Invalid page or page size.");
  return { page, limit };
}
const count = (condition) => ({ $sum: { $cond: [condition, 1, 0] } });
const has = (field) => ({ $ne: [{ $ifNull: [field, ""] }, ""] });
function base(eventId, typeId) {
  return [
    { $match: { eventId, ...(typeId ? { ticketTypeId: typeId } : {}) } },
    {
      $lookup: {
        from: Refund.collection.name,
        localField: "_id",
        foreignField: "ticketId",
        as: "refund",
        pipeline: [
          {
            $project: {
              status: 1,
              amountMinor: 1,
              currency: 1,
              markedPaidAt: 1,
              bankDetailsSubmittedAt: 1,
              "bankDetails.accountName": 1,
              "bankDetails.accountNumber": 1,
              "bankDetails.bankCode": 1,
            },
          },
        ],
      },
    },
    {
      $set: {
        refund: { $arrayElemAt: ["$refund", 0] },
        holderId: { $ifNull: ["$owner", "$_id"] },
      },
    },
    {
      $set: {
        free: {
          $or: [
            { $eq: ["$ticketSnapshot.ticketType", "FREE"] },
            { $eq: ["$ticketSnapshot.price.amount", 0] },
          ],
        },
        details: {
          $and: [
            has("$refund.bankDetails.accountName"),
            has("$refund.bankDetails.accountNumber"),
            has("$refund.bankDetails.bankCode"),
          ],
        },
        paid: { $ne: [{ $ifNull: ["$refund.markedPaidAt", null] }, null] },
      },
    },
    {
      $set: {
        code: {
          $switch: {
            branches: [
              {
                case: { $eq: ["$refund.status", "DISPUTED"] },
                then: "disputed",
              },
              {
                case: { $eq: ["$refund.status", "OVERDUE"] },
                then: { $cond: ["$paid", "confirmationOverdue", "overdue"] },
              },
              {
                case: { $eq: ["$refund.status", "CONFIRMED_BY_BUYER"] },
                then: "complete",
              },
              {
                case: { $eq: ["$refund.status", "MARKED_PAID"] },
                then: "sent",
              },
              {
                case: { $eq: ["$refund.status", "DUE_FROM_ORGANISER"] },
                then: "ready",
              },
              {
                case: { $ne: [{ $ifNull: ["$refund._id", null] }, null] },
                then: "waiting",
              },
            ],
            default: { $cond: [
              { $or: ["$free", { $in: ["$status", ["REDEEMED", "EXPIRED"]] }] },
              "none", "review",
            ] },
          },
        },
      },
    },
    {
      $set: {
        priority: {
          $switch: {
            branches: [
              { case: { $in: ["$code", ["disputed", "review"]] }, then: 0 },
              {
                case: { $in: ["$code", ["overdue", "confirmationOverdue"]] },
                then: 1,
              },
              { case: { $eq: ["$code", "ready"] }, then: 2 },
              { case: { $eq: ["$code", "waiting"] }, then: 3 },
              { case: { $eq: ["$code", "sent"] }, then: 5 },
              { case: { $eq: ["$code", "complete"] }, then: 6 },
            ],
            default: 7,
          },
        },
      },
    },
  ];
}
const stats = () => ({
  total: { $sum: 1 },
  pending: count({
    $in: ["$code", ["disputed", "review", "overdue", "ready", "waiting"]],
  }),
  sent: count({ $in: ["$code", ["sent", "confirmationOverdue"]] }),
  complete: count({ $eq: ["$code", "complete"] }),
  attention: count({ $lte: ["$priority", 1] }),
});
const safe = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    res
      .status(error.status || 500)
      .json({
        message: error.status
          ? error.message
          : "Could not load refund workspace.",
      });
  }
};
const summary = safe(async (req, res) => {
  const event = await owner(req);
  const [types, totals, legacy] = await Promise.all([
    Types.find({ eventId: event._id }).select("name ticketType").lean(),
    Tickets.aggregate([
      ...base(event._id),
      {
        $group: {
          _id: { type: "$ticketTypeId", holder: "$holderId" },
          name: { $first: "$ticketName" },
          ...stats(),
        },
      },
      {
        $group: {
          _id: "$_id.type",
          name: { $first: "$name" },
          holders: { $sum: 1 },
          ...Object.fromEntries(
            ["total", "pending", "sent", "complete", "attention"].map((key) => [
              key,
              { $sum: `$${key}` },
            ]),
          ),
        },
      },
    ]),
    Refund.countDocuments({ eventId: event._id, ticketId: null }),
  ]);
  const tiers = new Map(
    types.map((type) => [
      String(type._id),
      {
        ...type,
        holders: 0,
        total: 0,
        pending: 0,
        sent: 0,
        complete: 0,
        attention: 0,
      },
    ]),
  );
  for (const total of totals)
    tiers.set(String(total._id), { ...tiers.get(String(total._id)), ...total });
  res.json({ data: { tiers: [...tiers.values()], reviewCount: legacy } });
});
const holders = safe(async (req, res) => {
  const event = await owner(req),
    typeId = oid(req.query.ticketTypeId);
  const { page, limit } = paging(req.query);
  const search = req.query.search || "",
    filter = req.query.filter || "all";
  if (
    typeof search !== "string" ||
    search.length > 100 ||
    ![
      "all",
      "attention",
      "ready",
      "details",
      "waiting",
      "sent",
      "complete",
      "none",
    ].includes(filter)
  )
    throw invalid("Invalid search or filter.");
  const expression = {
    attention: { $lte: ["$priority", 1] },
    ready: {
      $and: [
        "$details",
        { $eq: ["$paid", false] },
        { $in: ["$code", ["ready", "overdue"]] },
      ],
    },
    details: "$details",
    waiting: {
      $and: [
        { $eq: ["$details", false] },
        { $eq: ["$paid", false] },
        { $ne: [{ $ifNull: ["$refund._id", null] }, null] },
        { $in: ["$code", ["waiting", "overdue", "ready", "disputed"]] },
      ],
    },
    sent: { $in: ["$code", ["sent", "confirmationOverdue"]] },
    complete: { $eq: ["$code", "complete"] },
    none: { $eq: ["$code", "none"] },
    all: true,
  }[filter];
  const regex = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const [result] = await Tickets.aggregate([
    ...base(event._id, typeId),
    {
      $lookup: {
        from: User.collection.name,
        localField: "owner",
        foreignField: "_id",
        pipeline: [{ $project: { firstName: 1, surname: 1, email: 1 } }],
        as: "person",
      },
    },
    { $set: { person: { $arrayElemAt: ["$person", 0] } } },
    {
      $set: {
        matches: { $cond: [expression, 1, 0] },
        searchMatch: {
          $cond: [
            {
              $regexMatch: {
                input: {
                  $concat: [
                    { $ifNull: ["$person.firstName", ""] },
                    " ",
                    { $ifNull: ["$person.surname", ""] },
                    " ",
                    { $ifNull: ["$person.email", ""] },
                    " ",
                    { $ifNull: ["$ticketNumber", ""] },
                  ],
                },
                regex,
                options: "i",
              },
            },
            1,
            0,
          ],
        },
      },
    },
    { $sort: { priority: 1, _id: 1 } },
    {
      $group: {
        _id: {
          holder: "$holderId",
          currency: { $ifNull: ["$refund.currency", ""] },
        },
        person: { $first: "$person" },
        priority: { $first: "$priority" },
        code: { $first: "$code" },
        count: { $sum: 1 },
        amount: { $sum: "$refund.amountMinor" },
        matches: { $max: "$matches" },
        searchMatch: { $max: "$searchMatch" },
        transferred: {
          $max: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$transferHistory", []] } }, 0] },
              1,
              0,
            ],
          },
        },
      },
    },
    { $sort: { priority: 1 } },
    {
      $group: {
        _id: "$_id.holder",
        person: { $first: "$person" },
        code: { $first: "$code" },
        priority: { $first: "$priority" },
        count: { $sum: "$count" },
        amounts: {
          $push: { currency: "$_id.currency", amountMinor: "$amount" },
        },
        matches: { $max: "$matches" },
        searchMatch: { $max: "$searchMatch" },
        transferred: { $max: "$transferred" },
      },
    },
    { $match: { matches: 1, searchMatch: 1 } },
    {
      $facet: {
        total: [{ $count: "count" }],
        items: [
          { $sort: { priority: 1, _id: 1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ],
      },
    },
  ]);
  res.json({
    data: {
      items: result.items,
      total: result.total[0]?.count || 0,
      page,
      limit,
    },
  });
});
const holderTickets = safe(async (req, res) => {
  const event = await owner(req),
    typeId = oid(req.query.ticketTypeId),
    holderId = oid(req.query.holderId);
  const { page, limit } = paging(req.query);
  const query = {
    eventId: event._id,
    ticketTypeId: typeId,
    $or: [{ owner: holderId }, { owner: null, _id: holderId }],
  };
  const [tickets, total, type] = await Promise.all([
    Tickets.find(query)
      .select(
        "owner ticketName ticketNumber status ticketSnapshot transferHistory ticketTypeId",
      )
      .populate("owner", "firstName surname email")
      .sort({ _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Tickets.countDocuments(query),
    Types.findById(typeId).select("name ticketType").lean(),
  ]);
  const refunds = await Refund.find({
    eventId: event._id,
    ticketId: { $in: tickets.map((t) => t._id) },
  })
    .select("+bankDetails.accountNumber +bankDetails.bankCode")
    .populate("ticketId", "ticketName ticketNumber")
    .populate("buyer", "firstName surname email")
    .lean();
  res.json({
    data: {
      type,
      total,
      page,
      limit,
      refunds,
      tickets: tickets.map((t) => ({
        _id: t._id,
        buyer: t.owner,
        ticketNumber: t.ticketNumber,
        status: t.status,
        ticketKind: t.ticketSnapshot?.ticketType,
        priceAmount: t.ticketSnapshot?.price?.amount,
        transferred: Boolean(t.transferHistory?.length),
        items: [{ ticketId: t.ticketTypeId, name: t.ticketName, quantity: 1 }],
      })),
    },
  });
});
module.exports = { summary, holders, holderTickets };
