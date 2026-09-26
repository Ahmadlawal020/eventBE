const EventBooking = require("../../models/client/eventBooking.schema");
const EventCenterBooking = require("../../models/client/eventCenterBooking.schema");
const countStatus = (status) => ({
  $sum: { $cond: [{ $eq: ["$paymentStatus", status] }, 1, 0] },
});
const sumStatus = (status) => ({
  $sum: { $cond: [{ $eq: ["$paymentStatus", status] }, "$ledgerAmount", 0] },
});
const paymentProjection = (type) => ({
  buyer: 1,
  organiser: 1,
  eventId: 1,
  eventCenter: 1,
  totalAmount: 1,
  totalPrice: 1,
  currency: 1,
  paymentStatus: 1,
  paymentMethod: 1,
  paymentReference: 1,
  createdAt: 1,
  paymentType: { $literal: type },
  ledgerAmount:
    type === "event"
      ? { $divide: [{ $ifNull: ["$totalAmount", 0] }, 100] }
      : { $ifNull: ["$totalPrice.amount", 0] },
  ledgerCurrency: {
    $ifNull: [
      type === "event" ? "$currency" : "$totalPrice.currency",
      "Unspecified",
    ],
  },
});

function summarizeMetrics(groups) {
  const metrics = {
    total: 0,
    completed: 0,
    pending: 0,
    failed: 0,
    refunded: 0,
    failedRefunds: 0,
    currencies: [],
  };
  for (const group of groups) {
    for (const key of [
      "total",
      "completed",
      "pending",
      "failed",
      "refunded",
      "failedRefunds",
    ])
      metrics[key] += group[key] || 0;
    metrics.currencies.push({
      currency: group._id,
      grossProcessed: group.grossProcessed || 0,
      refundedVolume: group.refundedVolume || 0,
    });
  }
  // Legacy scalar fields have a value only when addition is meaningful.
  metrics.grossProcessed =
    groups.length > 1 ? null : groups[0]?.grossProcessed || 0;
  metrics.refundedVolume =
    groups.length > 1 ? null : groups[0]?.refundedVolume || 0;
  return metrics;
}

async function paymentLedger({ query, type, page, limit }) {
  const pipeline = [
    { $match: type === "event-center" ? { _id: { $exists: false } } : query },
    { $project: paymentProjection("event") },
  ];
  if (type !== "event")
    pipeline.push({
      $unionWith: {
        coll: EventCenterBooking.collection.name,
        pipeline: [
          { $match: query },
          { $project: paymentProjection("event-center") },
        ],
      },
    });
  pipeline.push({
    $facet: {
      payments: [
        { $sort: { createdAt: -1, _id: -1, paymentType: 1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        { $unset: ["ledgerAmount", "ledgerCurrency"] },
      ],
      metrics: [
        {
          $group: {
            _id: "$ledgerCurrency",
            total: { $sum: 1 },
            completed: countStatus("COMPLETED"),
            pending: countStatus("PENDING"),
            failed: countStatus("FAILED"),
            refunded: countStatus("REFUNDED"),
            failedRefunds: countStatus("FAILED_REFUND"),
            grossProcessed: sumStatus("COMPLETED"),
            refundedVolume: sumStatus("REFUNDED"),
          },
        },
        { $sort: { _id: 1 } },
      ],
    },
  });
  const [result = { payments: [], metrics: [] }] =
    await EventBooking.aggregate(pipeline);
  await Promise.all([
    EventBooking.populate(
      result.payments.filter((item) => item.paymentType === "event"),
      [
        { path: "buyer", select: "firstName surname email" },
        { path: "eventId", select: "title" },
      ],
    ),
    EventCenterBooking.populate(
      result.payments.filter((item) => item.paymentType === "event-center"),
      [
        { path: "buyer", select: "firstName surname email" },
        { path: "organiser", select: "firstName surname email" },
        { path: "eventCenter", select: "venueName" },
      ],
    ),
  ]);
  const metrics = summarizeMetrics(result.metrics);
  return {
    payments: result.payments,
    metrics,
    pagination: {
      total: metrics.total,
      page,
      pages: Math.ceil(metrics.total / limit),
    },
  };
}
module.exports = { paymentLedger, summarizeMetrics };
