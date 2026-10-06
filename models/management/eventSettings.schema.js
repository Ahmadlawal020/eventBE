const { Schema, model } = require("mongoose");


const eventSettingsSchema = new Schema(
    {
        key: { type: String, default: "event_settings", unique: true },
        general: {
            eventCreationEnabled: { type: Boolean, default: true },
            defaultTimezone: { type: String, default: "Africa/Lagos", maxlength: 80 },
            defaultCurrency: { type: String, default: "NGN", maxlength: 3 },
        },
        publishing: {
            autoPublishVerifiedOrganisers: { type: Boolean, default: true },
            requireIdentityVerification: { type: Boolean, default: true },
            requirePayoutAccount: { type: Boolean, default: true },
            requireCoverImage: { type: Boolean, default: false },
            minimumImages: { type: Number, default: 1, min: 0, max: 30 },
            minLeadTimeHours: { type: Number, default: 0, min: 0, max: 8760 },
            maxDurationDays: { type: Number, default: 30, min: 1, max: 365 },
        },
        contentLimits: {
            maxTitleLength: { type: Number, default: 50, min: 10, max: 50 },
            maxShortDescriptionLength: {
                type: Number,
                default: 500,
                min: 50,
                max: 500,
            },
            maxDescriptionLength: {
                type: Number,
                default: 250,
                min: 50,
                max: 250,
            },
            minImages: { type: Number, default: 1, min: 0, max: 30 },
            maxImages: { type: Number, default: 10, min: 1, max: 50 },
        },
        ticketing: {
            freeEventsEnabled: { type: Boolean, default: true },
            paidEventsEnabled: { type: Boolean, default: true },
            onSiteTicketsEnabled: { type: Boolean, default: true },
            requireRefundPolicyForPaidEvents: { type: Boolean, default: false },
            maxTicketTiers: { type: Number, default: 20, min: 1, max: 100 },
            maxTicketsPerOrder: { type: Number, default: 20, min: 1, max: 1000 },
            salesCutoffMinutes: { type: Number, default: 0, min: 0, max: 10080 },
        },
        pricing: {
            feeCollectionMode: {
                type: String,
                enum: ["ORGANISER_CHOICE", "PASS_TO_BUYER", "ABSORB_BY_ORGANISER"],
                default: "ORGANISER_CHOICE",
            },
            minimumBasePrice: { type: Number, default: 0, min: 0 },
            minimumBasePrices: {
                NGN: { type: Number, default: 0, min: 0 },
                USD: { type: Number, default: 0, min: 0 },
                EUR: { type: Number, default: 0, min: 0 },
                GBP: { type: Number, default: 0, min: 0 },
                AED: { type: Number, default: 0, min: 0 },
                SAR: { type: Number, default: 0, min: 0 },
                GHS: { type: Number, default: 0, min: 0 },
                KES: { type: Number, default: 0, min: 0 },
                ZAR: { type: Number, default: 0, min: 0 },
            },
        },
        lifecycle: {
            autoCompletePastEvents: { type: Boolean, default: true },
            completionGraceHours: { type: Number, default: 0, min: 0, max: 168 },
        },
        guidance: {
            defaultRefundPolicy: { type: String, default: "", maxlength: 500 },
            defaultArrivalNotes: { type: String, default: "", maxlength: 1000 },
            defaultParkingInformation: { type: String, default: "", maxlength: 500 },
            defaultCheckInInstructions: {
                type: String,
                default: "",
                maxlength: 1000,
            },
        },
    },
    { timestamps: true },
);

eventSettingsSchema.statics.getSingleton = function () {
    return this.findOneAndUpdate(
        { key: "event_settings" },
        { $setOnInsert: { key: "event_settings" } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    );
};

const EventSettings = model("EventSettings", eventSettingsSchema);


module.exports = EventSettings;
