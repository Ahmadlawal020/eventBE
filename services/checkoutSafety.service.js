const mongoose = require("mongoose");
const EventBooking = require("../models/client/eventBooking.schema");
const VenueBooking = require("../models/client/eventCenterBooking.schema");
const Venue = require("../models/client/eventCenter.schema");
const Ticket = require("../models/client/eventTicketType.schema");
const UserTicket = require("../models/client/userEventTicket.schema");
const { generateTicketNumber, generateQRPayload } = require("../utils/qr");

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const currencyForCheckout = (value) => {
  const currency = String(value || "NGN").toUpperCase();
  const enabled = (process.env.PAYSTACK_SUPPORTED_CURRENCIES || "NGN").split(",").map(s => s.trim().toUpperCase());
  if (!["NGN","USD","GHS","ZAR","KES"].includes(currency) || !enabled.includes(currency)) throw fail(`Online payment in ${currency} is not enabled. Please contact the organiser.`);
  return currency;
};
const dayKey = value => {
  if (!value || !Number.isFinite(new Date(value).getTime())) throw fail("Invalid booking date");
  const text = typeof value === "string" ? value : new Date(value).toISOString();
  const key = text.slice(0, 10);
  const parsed = new Date(`${key}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== key) throw fail("Invalid booking date");
  return key;
};
const minutes = (value, end = false) => {
  if (end && (value === "24:00" || value === "00:00")) return 1440;
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw fail("Invalid booking time");
  const [h,m] = value.split(":").map(Number);
  return h * 60 + m;
};
const venueQuote = (venue, input) => {
  const base = venue.pricing?.basePrice || venue.basePrice;
  const unit = base?.unit || "day";
  if (!["day", "hour"].includes(input.bookingUnit) || input.bookingUnit !== unit) throw fail("Booking unit does not match the venue price");
  if (!Array.isArray(input.selectedDates) || !input.selectedDates.length || input.selectedDates.length > 1096) throw fail("Select valid booking dates");
  const currency = currencyForCheckout(base?.currency);
  if (input.totalPrice?.currency && input.totalPrice.currency !== currency) throw fail("Booking currency does not match the venue");
  const seen = new Set();
  let subtotalCents = 0, duration = 0;
  const dates = input.selectedDates.map(slot => {
    const date = dayKey(slot?.date);
    if (date < new Date().toISOString().slice(0,10)) throw fail("Cannot book a past date");
    if (seen.has(date)) throw fail("Duplicate booking dates are not allowed");
    seen.add(date);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = venue.pricing?.weekendPrice || venue.weekendPrice;
    const override = (venue.availability?.customPrices || venue.pricing?.customPrices || []).find(p => dayKey(p.date) === date);
    const amount = Number(override?.amount ?? override?.price ?? ([0,5,6].includes(weekday) && Number(weekend?.amount) > 0 ? weekend.amount : base?.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw fail("Venue price must be a positive amount");
    let units = 1;
    if (unit === "hour") {
      const start = minutes(slot.startTime), end = minutes(slot.endTime, true);
      if (end <= start || start % 60 || end % 60) throw fail("Select whole-hour slots with an end after the start");
      const open = minutes(venue.availability?.operationalHours?.open || "00:00");
      const close = minutes(venue.availability?.operationalHours?.close || "24:00", true);
      if (start < open || end > close) throw fail("Selected time is outside venue operating hours");
      units = (end - start) / 60;
    }
    duration += units;
    subtotalCents += Math.round(amount * 100) * units;
    return {date, ...(unit === "hour" ? {startTime:slot.startTime, endTime:minutes(slot.endTime,true) === 1440 ? "24:00" : slot.endTime} : {})};
  }).sort((a,b)=>a.date.localeCompare(b.date));
  const min = venue.availability?.minDuration || 1, max = venue.availability?.maxDuration || 365;
  if (duration < min || duration > max) throw fail(`Booking duration must be between ${min} and ${max} ${unit}s`);
  return {subtotalAmount:subtotalCents/100, currency, duration, selectedDates:dates};
};

async function reserveEventBooking(data) {
  return mongoose.connection.transaction(async session => {
    for (const item of data.items) {
      const updated = await Ticket.findOneAndUpdate({_id:item.ticketId,
        $expr:{$gte:[{$subtract:["$totalQuantity",{$ifNull:["$soldQuantity",0]}]}, item.quantity]}},
        {$inc:{soldQuantity:item.quantity}}, {new:true, session});
      if (!updated) throw fail(`Not enough tickets available for ${item.name}`,409);
    }
    const booking = new EventBooking({...data, reservationExpiresAt:data.paymentStatus === "PENDING" && data.paymentMethod === "CARD" ? new Date(Date.now()+30*60*1000) : undefined, inventoryReserved:true});
    await booking.save({session});
    if (booking.paymentStatus === "COMPLETED") {
      const {createTicketsForBooking}=require("../controllers/client/userEventTicket.controller");
      await createTicketsForBooking(booking,session);
    }
    return booking;
  });
}

function validatePayment(booking, transaction, kind, buyerId) {
  if (!booking) throw fail("No server-created booking exists for this payment",404);
  if (buyerId && String(booking.buyer) !== String(buyerId)) throw fail("This payment belongs to another user",403);
  if (transaction.status !== "success") throw fail("Payment has not been completed",409);
  const amount = kind === "EVENT_TICKET" ? booking.totalAmount : Math.round(booking.totalPrice.amount*100);
  const currency = kind === "EVENT_TICKET" ? booking.currency : booking.totalPrice.currency;
  if (!Number.isSafeInteger(Number(transaction.amount)) || Number(transaction.amount) !== amount || transaction.currency !== currency) throw fail("Payment amount or currency does not match the saved booking");
  if (transaction.reference !== booking.paymentReference) throw fail("Payment reference mismatch");
}

// Booking, inventory and generated tickets commit together. Concurrent webhook/client
// retries are serialized by MongoDB's transaction conflict retry.
async function completePayment(reference, transaction, {buyerId, kind} = {}) {
  return mongoose.connection.transaction(async session => {
    let booking = kind !== "EVENT_CENTER" ? await EventBooking.findOne({paymentReference:reference}).session(session) : null;
    let type = booking ? "EVENT_TICKET" : "EVENT_CENTER";
    if (!booking && kind !== "EVENT_TICKET") booking = await VenueBooking.findOne({paymentReference:reference}).session(session);
    validatePayment(booking, transaction, type, buyerId);
    if (["REFUNDED","FAILED_REFUND"].includes(booking.paymentStatus)) throw fail("Booking has already been reversed",409);
    if (booking.status === "CANCELLED" || booking.paymentResolutionRequired) {
      if (booking.paymentStatus !== "COMPLETED") {
        booking.paymentStatus = "COMPLETED";
        booking.paymentResolutionRequired = true;
        await booking.save({session});
      }
      return {booking,type,conflict:true,changed:false};
    }
    const changed = booking.paymentStatus !== "COMPLETED";
    if (type === "EVENT_CENTER" && changed) {
      const venue = await Venue.findById(booking.eventCenter).session(session);
      const availability = venue?.availability;
      const dates = booking.selectedDates;
      const conflict = !venue || venue.status !== "LISTED" || dates.some(slot => {
        const date = dayKey(slot.date);
        const dayBlocked = (availability?.unavailableDates || []).some(d=>dayKey(d.date)===date && String(d.bookingId)!==String(booking._id));
        const hoursBlocked = (availability?.unavailableSlots || []).some(d=>dayKey(d.date)===date && String(d.bookingId)!==String(booking._id) &&
          (booking.bookingUnit === "day" || (minutes(slot.startTime)<minutes(d.endTime,true) && minutes(slot.endTime,true)>minutes(d.startTime))));
        return dayBlocked || hoursBlocked;
      });
      if (conflict) {
        booking.paymentStatus="COMPLETED";booking.status="CANCELLED";booking.paymentResolutionRequired=true;
        await booking.save({session});
        return {booking,type,conflict:true,changed:true};
      }
      const common = {type:"BOOKED",bookingId:String(booking._id),clientName:booking.guestDetails?.fullName,clientEmail:booking.guestDetails?.email,clientPhone:booking.guestDetails?.phoneNumber};
      const field = booking.bookingUnit === "day" ? "unavailableDates" : "unavailableSlots";
      const entries = dates.map(d=>({...common,date:d.date,...(booking.bookingUnit === "hour"?{startTime:d.startTime,endTime:d.endTime}:{})}));
      await Venue.updateOne({_id:venue._id},{$push:{[`availability.${field}`]:{$each:entries}}},{session});
      if (booking.bookingMode === "REVIEW") {
        booking.status="PENDING_REVIEW";booking.reviewDeadline=new Date(Date.now()+86400000);
      } else {
        booking.ticketNumber=generateTicketNumber("MNS");booking.qrPayload=generateQRPayload(booking.ticketNumber,booking.eventCenter,"EVENT_CENTER");
      }
    }
    if (changed) {
      booking.paymentStatus="COMPLETED";booking.referralPaymentAt=transaction.paid_at || new Date();
      booking.reservationExpiresAt=undefined;
      await booking.save({session});
    }
    if (type === "EVENT_TICKET") {
      const tickets = await UserTicket.find({bookingId:booking._id}).session(session);
      if (!tickets.length) {
        const { createTicketsForBooking } = require("../controllers/client/userEventTicket.controller");
        await createTicketsForBooking(booking, session);
      }
    }
    return {booking,type,conflict:false,changed};
  });
}

async function expireEventReservation(id) {
  return mongoose.connection.transaction(async session => {
    const booking=await EventBooking.findOne({_id:id,paymentStatus:"PENDING",status:"ACTIVE",reservationExpiresAt:{$lte:new Date()}}).session(session);
    if (!booking) return false;
    if (booking.inventoryReserved) {
      for (const item of booking.items) await Ticket.updateOne({_id:item.ticketId},{$inc:{soldQuantity:-item.quantity}},{session});
      booking.inventoryReserved=false;
    }
    booking.status="CANCELLED";booking.paymentStatus="FAILED";
    await booking.save({session});return true;
  });
}
module.exports={fail,currencyForCheckout,venueQuote,reserveEventBooking,completePayment,validatePayment,expireEventReservation};
