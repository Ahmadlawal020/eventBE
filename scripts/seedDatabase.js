require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const connectDB = require("../config/dbConn");

// ─── Models ──────────────────────────────────────────────────────────
const User = require("../models/user/user.schema");
const Event = require("../models/user/event.schema");
const EventCenter = require("../models/user/eventCenter.schema");
const Ticket = require("../models/user/eventTicket.schema");
const EventBooking = require("../models/user/eventBooking.schema");
const UserEventTicket = require("../models/user/userEventTicket.schema");
const EventCenterTicket = require("../models/user/eventCenterTicket.schema");
const Message = require("../models/user/message.schema");
const Conversation = require("../models/user/conversation.schema");
const Notification = require("../models/user/notification.schema");
const CoHostInvitation = require("../models/user/coOrganiserInvitation.schema");
const StaffInvitation = require("../models/user/staffInvitation.schema");
const StaffActivity = require("../models/user/staffActivity.schema");
const IdentityVerification = require("../models/user/identityVerification.schema");
const AdminAuditLog = require("../models/admin/adminAuditLog.schema");
const PlatformFees = require("../models/admin/platformFees.schema");
const PlatformSettings = require("../models/admin/platformSettings.schema");
const AdminStaff = require("../models/admin/admin.schema");

// ─── Helpers ─────────────────────────────────────────────────────────
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const pickN = (arr, n) => {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(n, arr.length));
};
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min, max, dec = 2) => +(Math.random() * (max - min) + min).toFixed(dec);
const dateBetween = (start, end) => new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
const NGN = (amount) => ({ amount, currency: "NGN", symbol: "₦" });

// ─── Data Pools ──────────────────────────────────────────────────────
const FIRST_NAMES = [
  "Chukwuemeka", "Adebayo", "Fatimah", "Ngozi", "Olumide", "Amina", "Tunde",
  "Chioma", "Ibrahim", "Blessing", "Emeka", "Folake", "Musa", "Adaeze",
  "Kayode", "Zainab", "Chinedu", "Halima", "Oluwaseun", "Nneka", "Babatunde",
  "Obioma", "Yusuf", "Ifeanyi", "Aisha", "Oluwafemi", "Chidinma", "Abdullahi",
  "Kelechi", "Funmilayo", "Suleiman", "Amara", "Olawale", "Chiamaka", "Garba",
  "Yetunde", "Obinna", "Rashidat", "Oluwatobi", "Nkiru", "Aliyu", "Busayo",
  "Chidera", "Murtala", "Aderonke", "Ikechukwu", "Hauwa", "Olaoluwa", "Chisom",
  "Bello", "Ifeoma", "Taiwo", "Kehinde", "Ngozeko", "Umar", "Titilayo",
  "Obinna", "Jummai", "Oluwole", "Chizoba", "Danladi", "Folashade", "Emmanuel",
  "Aminat", "Chidi", "Rukayat", "Babatunde", "Adaeze", "Ismail", "Nkemdilim",
  "Oluwadamilola", "Temitope", "Chidera", "Uchechukwu", "Ramlat", "Oluwasanmi",
  "Ifeanyichukwu", "Aishat", "Chinecherem", "Olumuyiwa", "Sadiya", "Ayomide",
  "Chukwudi", "Rukaiya", "Oluwatosin", "Ezinne", "Yakubu", "Motunrayo",
  "Oladele", "Chiamaka", "Abubakar", "Ngozika", "Temilola", "Chizitere",
  "UmarFaruk", "Oluwakemi", "Ifeoluwa", "Zainab", "Afolabi", "Adanna",
];
const SURNAMES = [
  "Okafor", "Adeyemi", "Abubakar", "Nnamdi", "Balogun", "Eze", "Mohammed",
  "Olawale", "Igwe", "Bello", "Akande", "Chukwu", "Danjuma", "Onwueme",
  "Afolabi", "Ogundimu", "Nwosu", "Aliyu", "Fashola", "Obi", "Osagie",
  "Ibrahim", "Oladipo", "Chinedu", "Abdullahi", "Adesanya", "Ike",
  "Okonkwo", "Lawal", "Uche", "Suleiman", "Ogundipe", "Emeka", "Garba",
  "Adewale", "Nduka", "Babangida", "Olaniyan", "Chukwuemeka", "Tinubu",
  "Oyewole", "Ekwueme", "Dantata", "Obaseki", "Akinwale", "Ihenacho",
  "Abiodun", "Oluwole", "Ogundele", "Chidiebere", "Bolarinwa", "Ogundiran",
  "Nwankwo", "Ademola", "Okorie", "Aliyu", "Olaniyi", "Ugwu", "Oyedele",
  "Chukwuemeka", "Akindele", "Oladimeji", "Ibrahim", "Obiora", "Olawumi",
];
const STATES = [
  { state: "Lagos", cities: ["Victoria Island", "Ikeja", "Lekki", "Surulere", "Yaba", "Ikoyi", "Maryland", "Ajah"] },
  { state: "Abuja", cities: ["Wuse", "Garki", "Maitama", "Asokoro", "Jabi", "Gwarinpa", "Utako"] },
  { state: "Rivers", cities: ["Port Harcourt", "Obio-Akpor", "Diobu", "GRA"] },
  { state: "Oyo", cities: ["Ibadan", "Oyo", "Ogbomoso"] },
  { state: "Kano", cities: ["Kano", "Fagge", "Nassarawa"] },
  { state: "Enugu", cities: ["Enugu", "Nsukka", "Trans-Ekulu"] },
  { state: "Cross River", cities: ["Calabar", "Ikom"] },
  { state: "Edo", cities: ["Benin City", "Ekpoma"] },
  { state: "Kaduna", cities: ["Kaduna", "Zaria"] },
  { state: "Delta", cities: ["Warri", "Asaba", "Sapele"] },
  { state: "Plateau", cities: ["Jos", "Bukuru"] },
  { state: "Imo", cities: ["Owerri", "Orlu"] },
  { state: "Abia", cities: ["Aba", "Umuahia"] },
  { state: "Ondo", cities: ["Akure", "Ondo"] },
  { state: "Kwara", cities: ["Ilorin"] },
];
const EVENT_TYPES = [
  "MUSIC_CONCERTS", "FESTIVALS_FAIRS", "PARTIES_NIGHTLIFE", "FOOD_DRINK",
  "ARTS_CULTURE", "THEATER_PERFORMING_ARTS", "COMEDY_ENTERTAINMENT",
  "SPORTS_FITNESS", "EDUCATION_LEARNING", "WORKSHOPS_TRAINING",
  "CONFERENCES_SEMINARS", "BUSINESS_NETWORKING", "TECHNOLOGY_INNOVATION",
  "COMMUNITY_LOCAL", "FAMILY_KIDS", "FASHION_BEAUTY",
];
const VENUE_TYPES = [
  "CONVENTION_CENTER", "CONFERENCE_HALL", "BANQUET_HALL", "HOTEL_VENUE",
  "THEATER_AUDITORIUM", "OUTDOOR_VENUE", "COMMUNITY_CENTER", "CLUB_LOUNGE",
  "MULTIPURPOSE_SPACE",
];
const AMENITIES = ["FOOD_STALLS", "BAR_DRINKS", "PARKING", "RESTROOMS", "FIRST_AID", "VIP_AREA", "SEATING", "WIFI", "ACCESSIBILITY", "CHARGING_STATIONS"];
const SAFETY_OPTIONS = ["FIRE_EXTINGUISHER", "EMERGENCY_EXIT", "CCTV", "FIRST_AID_KIT", "SMOKE_DETECTOR", "SECURITY_STATION"];
const SAFETY_CONSIDERATIONS = ["FIRE_SAFETY_COMPLIANCE", "EMERGENCY_PLAN", "CROWD_MANAGEMENT", "MEDICAL_SUPPORT"];
const VENUE_RULES = ["NO_SMOKING", "NO_LOUD_MUSIC", "CHILD_FRIENDLY", "SECURITY_REQUIRED", "TIME_RESTRICTION", "CATERING_IN_HOUSE"];
const COHOST_PERMISSIONS = ["ALL_ACCESS", "MANAGE_LISTING", "MANAGE_CALENDAR", "MANAGE_BOOKINGS", "MANAGE_TICKETS", "VIEW_FINANCES", "SCAN_TICKET", "CUSTOMER_CARE"];
const STAFF_PERMISSIONS = ["MANAGE_LISTING", "MANAGE_CALENDAR", "MANAGE_BOOKINGS", "MANAGE_TICKETS", "SCAN_TICKET", "CUSTOMER_CARE"];
const STAFF_ACTIONS = ["SCAN", "CHECK_IN", "SALE", "LOGIN", "TASK_COMPLETE"];

// ─── Event & Venue Name Templates ────────────────────────────────────
const EVENT_NAME_PARTS = {
  prefixes: ["Lagos", "Abuja", "Port Harcourt", "Nigerian", "West African", "Africa", "Royal", "Grand", "Annual", "Elite", "Premier", "Golden", "Sunset", "Sunrise", "Midnight", "Star", "Diamond", "Phoenix", "Ocean", "City"],
  mids: ["Jazz", "Afrobeat", "Gospel", "Comedy", "Film", "Fashion", "Food", "Tech", "Art", "Sports", "Music", "Dance", "Cultural", "Marathon", "Conference", "Summit", "Expo", "Festival", "Night", "Day"],
  suffixes: ["Festival", "Night", "Concert", "Show", "Gala", "Conference", "Summit", "Meetup", "Workshop", "Premiere", "Expo", "Fair", "Carnival", "Celebration", "Experience", "Live", "Party", "Rave"],
};
const VENUE_NAME_PARTS = {
  prefixes: ["Eko", "Transcorp", "Federal Palace", "Landmark", "Balmoral", "Oriental", "Carlton", "Radisson", "Marriott", "Hilton", "Grand", "Royal", "Imperial", "Crown", "Phoenix", "Zenith", "Apex", "Summit"],
  suffixes: ["Convention Centre", "Event Hall", "Conference Centre", "Banquet Hall", "Exhibition Centre", "Grand Pavilion", "Event Arena", "Conference Hall", "Banquet Centre"],
};
const ORGANISER_TITLES = [
  "{name} Productions", "{name} Events", "{name} Entertainment", "{name} Hub",
  "{name} Connect", "{name} Global", "{name} Enterprises", "{name} Live",
  "The {name} Group", "{name} Experience",
];
const TICKET_TYPES = [
  { name: "VIP", type: "PAID", priceRange: [15000, 50000], qtyRange: [50, 200] },
  { name: "Regular", type: "PAID", priceRange: [3000, 15000], qtyRange: [100, 2000] },
  { name: "Early Bird", type: "PAID", priceRange: [2000, 10000], qtyRange: [50, 500] },
  { name: "Student", type: "PAID", priceRange: [1500, 5000], qtyRange: [50, 300] },
  { name: "Free Entry", type: "FREE", priceRange: [0, 0], qtyRange: [100, 1000] },
];
const MESSAGE_TEMPLATES = [
  "Hello, I'm interested in your event. Is it still on?",
  "Yes, the event is confirmed! Looking forward to seeing you.",
  "What time does the event start?",
  "The event starts at 6:00 PM. Please arrive early.",
  "Can I get a refund for my ticket?",
  "Please check our refund policy. Refunds are available up to 48 hours before the event.",
  "Is parking available at the venue?",
  "Yes, there's free parking for all attendees.",
  "How many tickets can I buy at once?",
  "You can purchase up to 10 tickets per transaction.",
  "Will there be food at the event?",
  "Yes, food and drinks will be available for purchase.",
  "Is the venue accessible for wheelchair users?",
  "Yes, the venue is fully accessible.",
  "Thank you for your inquiry!",
  "You're welcome! See you there.",
  "I'd like to book the venue for a private event.",
  "Sure! What dates are you looking at?",
  "We have availability on the 15th and 22nd of next month.",
  "Perfect, I'll go with the 15th.",
  "Great choice! I'll send you the booking details.",
  "When is the concert happening?",
  "It's scheduled for December 20th at Eko Convention Centre.",
  "Are there still VIP tickets available?",
  "Yes, we have limited VIP tickets left. Get yours now!",
  "What's included in the VIP package?",
  "VIP includes priority seating, welcome drinks, and meet & greet.",
  "Can I transfer my ticket to someone else?",
  "Yes, ticket transfers are allowed up to 24 hours before the event.",
];

// ─── Email Generator ─────────────────────────────────────────────────
function generateEmails(count) {
  const emails = [];
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let idx = 0;
  for (let domainIdx = 0; domainIdx < 10 && emails.length < count; domainIdx++) {
    for (let i = 0; i < 26 && emails.length < count; i++) {
      emails.push(`${letters[i]}@${letters[domainIdx]}.com`);
      idx++;
    }
  }
  return emails.slice(0, count);
}

// ─── Date Helpers ────────────────────────────────────────────────────
const NOW = new Date();
const TWO_YEARS_AGO = new Date(NOW.getFullYear() - 2, NOW.getMonth(), NOW.getDate());
const SIX_MONTHS_LATER = new Date(NOW.getFullYear(), NOW.getMonth() + 6, NOW.getDate());

function randomEventDate() {
  const isPast = Math.random() < 0.6;
  if (isPast) {
    return dateBetween(TWO_YEARS_AGO, NOW);
  }
  return dateBetween(NOW, SIX_MONTHS_LATER);
}

function formatDate(d) {
  return d.toISOString().split("T")[0];
}

// ─── Seed Functions ──────────────────────────────────────────────────

async function seedUsers() {
  console.log("  Seeding Users...");
  const emails = generateEmails(100);
  const hashedPw = await bcrypt.hash("12345678", 10);

  const users = [];
  for (let i = 0; i < 100; i++) {
    const loc = pick(STATES);
    const city = pick(loc.cities);
    const firstName = pick(FIRST_NAMES);
    const surname = pick(SURNAMES);
    let roles = ["user"];
    if (i < 50) roles = ["user", "organiser"];
    else if (i < 75) roles = ["user"];

    const createdDate = dateBetween(TWO_YEARS_AGO, new Date(NOW.getFullYear() - 1, NOW.getMonth(), NOW.getDate()));

    users.push({
      firstName,
      surname,
      email: emails[i],
      password: hashedPw,
      dob: dateBetween(new Date(1975, 0, 1), new Date(2002, 0, 1)),
      authProvider: "local",
      roles,
      isEmailVerified: true,
      emailVerifiedAt: createdDate,
      isPhoneVerified: true,
      phoneVerifiedAt: createdDate,
      isIdentityVerified: true,
      isActive: Math.random() > 0.05,
      preferredLanguage: "en",
      phoneNumber: `080${String(randInt(10000000, 99999999))}`,
      residentialAddress: {
        country: "Nigeria",
        street: `${randInt(1, 200)} ${pick(["Street", "Road", "Avenue", "Close", "Crescent", "Way", "Lane"])}`,
        city,
        state: loc.state,
        postalCode: String(randInt(100000, 999999)),
      },
      emergencyContact: {
        name: `${pick(FIRST_NAMES)} ${pick(SURNAMES)}`,
        relationship: pick(["Spouse", "Parent", "Sibling", "Friend", "Colleague"]),
        email: `${pick(FIRST_NAMES).toLowerCase()}@${pick(["gmail", "yahoo", "outlook"])}.com`,
        phoneNumber: `080${String(randInt(10000000, 99999999))}`,
      },
      bankDetails: {
        accountName: `${firstName} ${surname}`,
        accountNumber: String(randInt(1000000000, 3000000000)),
        bankName: pick(["Access Bank", "GTBank", "First Bank", "UBA", "Zenith Bank", "Stanbic IBTC", "Fidelity Bank", "Wema Bank"]),
        bankCode: String(randInt(100, 999)),
      },
      lastLoginAt: dateBetween(TWO_YEARS_AGO, NOW),
      createdAt: createdDate,
      updatedAt: createdDate,
    });
  }

  await User.deleteMany({});
  const inserted = await User.insertMany(users, { ordered: false });
  console.log(`  ✓ Created ${inserted.length} users`);
  return inserted;
}

async function seedAdminStaff() {
  console.log("  Seeding Admin Staff...");
  const hashedPw = await bcrypt.hash("12345678", 10);
  const staffData = [
    { firstName: "Munasaba", surname: "SuperAdmin", email: "admin@munasaba.com", roles: ["super_admin", "admin"], department: "Administration", jobTitle: "Super Administrator", gender: "Male", employmentType: "Full-time", accessLevel: "Tier 4 Executive", branch: "Lagos HQ" },
    { firstName: "Aisha", surname: "Abdullahi", email: "staff1@munasaba.com", roles: ["admin"], department: "Operations", jobTitle: "Operations Manager", gender: "Female", employmentType: "Full-time", accessLevel: "Tier 3 Senior", branch: "Lagos HQ" },
    { firstName: "Chukwuemeka", surname: "Okafor", email: "staff2@munasaba.com", roles: ["support_admin"], department: "Support", jobTitle: "Support Lead", gender: "Male", employmentType: "Full-time", accessLevel: "Tier 2 Management", branch: "Abuja Office" },
    { firstName: "Fatimah", surname: "Bello", email: "staff3@munasaba.com", roles: ["finance_admin"], department: "Finance", jobTitle: "Finance Manager", gender: "Female", employmentType: "Full-time", accessLevel: "Tier 3 Senior", branch: "Lagos HQ" },
    { firstName: "Tunde", surname: "Adeyemi", email: "staff4@munasaba.com", roles: ["moderator"], department: "Content", jobTitle: "Content Moderator", gender: "Male", employmentType: "Full-time", accessLevel: "Tier 2 Management", branch: "Lagos HQ" },
  ];

  await AdminStaff.deleteMany({});
  const inserted = [];
  for (const s of staffData) {
    const doc = await AdminStaff.create({
      ...s,
      password: hashedPw,
      isActive: true,
      status: "active",
      accountStatus: "Active",
      startDate: dateBetween(TWO_YEARS_AGO, new Date(NOW.getFullYear() - 1, 0, 1)),
      phoneNumber: `080${String(randInt(10000000, 99999999))}`,
      isEmailVerified: true,
      lastLoginAt: dateBetween(TWO_YEARS_AGO, NOW),
      lastActiveAt: dateBetween(new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000), NOW),
      ipHistory: [{ ip: `197.${randInt(1, 255)}.${randInt(1, 255)}.${randInt(1, 255)}`, timestamp: dateBetween(TWO_YEARS_AGO, NOW) }],
      devices: [{ deviceName: pick(["Chrome on Windows", "Safari on iPhone", "Firefox on Ubuntu"]), deviceType: pick(["desktop", "mobile"]), lastUsed: dateBetween(new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000), NOW) }],
      activeSessions: randInt(0, 3),
    });
    inserted.push(doc);
  }
  console.log(`  ✓ Created ${inserted.length} admin staff`);
  return inserted;
}

async function seedPlatformConfig() {
  console.log("  Seeding Platform Config...");
  await PlatformFees.deleteMany({});
  await PlatformSettings.deleteMany({});
  await PlatformFees.create({ key: "platform_fees", eventCommission: 15, eventCenterCommission: 15 });
  await PlatformSettings.create({
    key: "platform_settings",
    platformName: "Munasaba",
    supportEmail: "support@munasaba.com",
    supportPhone: "+234 800 MUNASABA",
    maintenanceMode: false,
    registrationEnabled: true,
    defaultCurrency: "NGN",
    maxUploadSizeMB: 10,
    sessionTimeoutMinutes: 15,
    requireEmailVerification: true,
    allowGoogleAuth: true,
  });
  console.log("  ✓ Created platform fees & settings");
}

async function seedEvents(users) {
  console.log("  Seeding Events...");
  const organisers = users.filter((u) => u.roles.includes("organiser"));
  const staffUsers = users.filter((u) => u.roles.includes("staff") || (!u.roles.includes("organiser") && !u.roles.includes("user")));
  const allStaff = [...organisers, ...staffUsers];

  const eventTitles = [
    "Lagos Jazz Festival", "Afrobeat Night Live", "Nollywood Film Premiere", "Tech Lagos Conference",
    "Abuja Food & Wine Festival", "Port Harcourt Carnival", "Nigerian Fashion Week", "Lagos Marathon",
    "Comedy Night with Basketmouth", "Startup Pitch Nigeria", "African Music Awards", "Lagos Art Exhibition",
    "Digital Marketing Summit", "Gospel Night of Worship", "Kids Fun Fair", "Business Leaders Forum",
    "Photography Workshop", "Fitness Bootcamp Lagos", "Cultural Heritage Day", "Spoken Word Poetry Night",
    "DJ Skills Academy", "Cooking Masterclass", "Wine Tasting Evening", "Car Show Lagos",
    "University Career Fair", "Women in Tech Conference", "Lagos Food Truck Festival", "Stand-Up Comedy Special",
    "Nigeria Music Conference", "Film Making Workshop", "Yoga in the Park", "Charity Gala Dinner",
    "Wine & Paint Night", "Corporate Team Building", "Singles Mixer Lagos", "Rooftop Party Night",
    "Acoustic Sessions", "Blockchain Summit Nigeria", "Real Estate Conference", "Beauty & Wellness Expo",
    "Agricultural Innovation Forum", "Health & Fitness Expo", "Book Reading Club", "Networking Brunch",
    "Afro-Caribbean Night", "Sunset Beach Party", "Indoor Sports Tournament", "Artisan Market Lagos",
    "Photography Walk", "Poetry Slam Abuja", "Edo Cultural Festival", "Kano Trade Fair",
    "Jos Plateau Festival", "Calabar Carnival After-Party", "Warri Comedy Show", "Owerri Music Festival",
    "Aba Fashion Show", "Akure Tech Meetup", "Ilorin Cultural Day", "Benin Art Exhibition",
  ];

  const events = [];
  for (let i = 0; i < 60; i++) {
    const organiser = pick(organisers);
    const loc = pick(STATES);
    const city = pick(loc.cities);
    const eventDate = randomEventDate();
    const endDate = new Date(eventDate.getTime() + randInt(2, 8) * 60 * 60 * 1000);
    const isPast = eventDate < NOW;
    const status = isPast ? pick(["COMPLETED", "COMPLETED", "COMPLETED", "LISTED"]) : pick(["LISTED", "LISTED", "ACTION_REQUIRED"]);

    const assignedStaff = pickN(allStaff, randInt(0, 3));
    const coHosts = pickN(organisers.filter((o) => o._id.toString() !== organiser._id.toString()), randInt(0, 2));

    events.push({
      title: eventTitles[i % eventTitles.length],
      shortDescription: `Join us for an exciting ${eventTitles[i % eventTitles.length].toLowerCase()} event in ${city}. Don't miss out on the fun!`,
      description: `The ${eventTitles[i % eventTitles.length]} is one of the most anticipated events in ${loc.state}. Featuring top performers, amazing food, and an unforgettable experience. Come join thousands of attendees for a day/night of pure entertainment.`,
      eventType: pick(EVENT_TYPES),
      ageRestriction: { minAge: randInt(0, 18), maxAge: randInt(60, 100) },
      schedule: { from: eventDate, to: endDate },
      location: {
        addressString: `${randInt(1, 100)} ${pick(["Allen", "Adeniran Ogunsanya", "Ogunlana Drive", "Broad Street", "Lekki Phase 1", "Wuse Zone 5", "Trans Amadi", "D_LINE"])}, ${city}`,
        city,
        area: pick(loc.cities),
        country: "Nigeria",
        coordinates: {
          latitude: randFloat(4.0, 13.5),
          longitude: randFloat(2.5, 14.5),
        },
        isSpecificLocation: true,
      },
      capacity: randInt(50, 5000),
      safety: pickN(SAFETY_OPTIONS, randInt(2, 5)),
      safetyConsiderations: pickN(SAFETY_CONSIDERATIONS, randInt(1, 3)),
      entry: { ticketRequired: Math.random() > 0.2, onSiteTickets: Math.random() > 0.5, idRequired: Math.random() > 0.7 },
      ticketGuide: {
        description: "Tickets are available online and at the gate. Please present your QR code at the entrance.",
        refundPolicy: "Refunds are available up to 48 hours before the event. No refunds after that.",
      },
      arrivalGuide: {
        notes: `The venue is located in ${city}, ${loc.state}. Please arrive at least 30 minutes before the event starts.`,
        parking: "Free parking is available at the venue. VIP parking is also available for premium ticket holders.",
        checkInInstructions: "Present your QR code at the entrance. Staff will scan and verify your ticket.",
      },
      status,
      createdBy: organiser._id,
      coHosts: coHosts.map((c) => c._id),
      staff: assignedStaff.map((s) => s._id),
      performance: {
        views: randInt(100, 10000),
        clicks: randInt(50, 5000),
        wishlists: randInt(10, 1000),
        reach: randInt(500, 50000),
        engagement: randInt(100, 5000),
        shares: randInt(10, 500),
        ticketSales: randInt(0, 500),
        revenue: randInt(100000, 50000000),
      },
      createdAt: dateBetween(TWO_YEARS_AGO, new Date(Math.min(eventDate.getTime(), NOW.getTime()))),
      updatedAt: dateBetween(TWO_YEARS_AGO, NOW),
    });
  }

  await Event.deleteMany({});
  const inserted = await Event.insertMany(events, { ordered: false });
  console.log(`  ✓ Created ${inserted.length} events`);
  return inserted;
}

async function seedEventCentres(users) {
  console.log("  Seeding Event Centres...");
  const organisers = users.filter((u) => u.roles.includes("organiser"));

  const centreNames = [
    "Eko Convention Centre", "Transcorp Hilton Hall", "Federal Palace Banquet",
    "Landmark Event Centre", "Balmoral Convention Centre", "Oriental Hotel Ballroom",
    "Lagos Continental Hotel", "Federal Palace Hotel", "Radisson Blu Lagos",
    "Four Points by Sheraton", "Nike Art Gallery Event Space", "Muri Okunola Park",
    "Terra Arena Lagos", "Jara Beach Resort", "La Campaign Tropicana",
    "Eko Hotels & Suites", "The Civic Centre", "Oasis Lounge & Event Hall",
    "Rhapsody's Event Centre", "Bogobiri House", "Hardrock Cafe Event Space",
    "Tropicana Guelph", "Civic Centre Victoria Island", "Protea Hotel Ikeja",
    "Boat Club Lagos", "Palms Shopping Event Space", "Maison Fahrenheit",
    "The Regent Lagos", "Radisson Hotel Abuja", "Transcorp Hilton Abuja",
    "NAF Conference Centre", "Shehu Musa Yar'Adua Centre", "International Conference Centre",
    "Jabi Boat Club", "Billionaires Club", "Club Quilox Event Space",
    "Eko Atlantic Event Hall", "Lekki Conservation Centre", "Freedom Park Lagos",
    "Badagry Cultural Centre", "Osun Osogbo Festival Ground", "Kaduna International Trade Fair",
    "Jos Wildlife Park Venue", "Calabar Cultural Centre", "Warri Recreation Club",
    "Owerri City Event Centre", "Aba Trade Fair Ground", "Benin Cultural Centre",
    "Enugu Polo Club Event Space", "Ilorin Stadium Complex",
  ];

  const centres = [];
  for (let i = 0; i < 50; i++) {
    const organiser = pick(organisers);
    const loc = pick(STATES);
    const city = pick(loc.cities);
    const basePrice = randInt(50000, 2000000);
    const capacity = randInt(50, 5000);

    const assignedStaff = pickN([...organisers], randInt(0, 2));
    const coHosts = pickN(organisers.filter((o) => o._id.toString() !== organiser._id.toString()), randInt(0, 2));

    // Generate unavailable dates (booked dates)
    const unavailableDates = [];
    const numBookings = randInt(3, 15);
    for (let j = 0; j < numBookings; j++) {
      const bookDate = randomEventDate();
      unavailableDates.push({
        date: bookDate,
        type: pick(["BLOCKED", "MANUAL"]),
        clientName: `${pick(FIRST_NAMES)} ${pick(SURNAMES)}`,
        clientPhone: `080${String(randInt(10000000, 99999999))}`,
        clientEmail: `${pick(FIRST_NAMES).toLowerCase()}@${pick(["gmail", "yahoo"])}.com`,
        totalPrice: randInt(50000, 3000000),
        depositAmount: randInt(20000, 500000),
        paymentStatus: pick(["paid", "partially_paid", "pending"]),
      });
    }

    centres.push({
      venueType: pick(VENUE_TYPES),
      yearEstablished: randInt(1990, 2023),
      totalArea: { value: randInt(200, 10000), unit: pick(["SQ_METERS", "SQ_FEET"]) },
      venueName: centreNames[i % centreNames.length],
      shortDescription: `A premium ${pick(VENUE_TYPES).toLowerCase().replace(/_/g, " ")} located in ${city}, perfect for events of all sizes.`,
      description: `${centreNames[i % centreNames.length]} is a world-class event venue in ${city}, ${loc.state}. With state-of-the-art facilities, ample parking, and a professional events team, we provide the perfect setting for conferences, weddings, concerts, and corporate events. Our venue features modern sound and lighting systems, flexible seating arrangements, and dedicated event coordinators.`,
      guestAccessDescription: "Guests have full access to the venue facilities including parking, restrooms, and common areas.",
      neighborhoodDescription: `Located in the heart of ${city}, with easy access to hotels, restaurants, and major landmarks.`,
      transitDescription: "Easily accessible by road. Public transportation routes pass nearby.",
      oneLiner: `Premium event venue in ${city} for all occasions`,
      theSpace: `A spacious ${pick(VENUE_TYPES).toLowerCase().replace(/_/g, " ")} with modern amenities and flexible layout options.`,
      location: {
        addressString: `${randInt(1, 100)} ${pick(["Broad Street", "Ozumba Mbadiwe Ave", "Adeola Odeku", "Aguiyi-Ironsi Street", "Michael Okpara Way"])}, ${city}`,
        city,
        area: pick(loc.cities),
        state: loc.state,
        country: "Nigeria",
        coordinates: { latitude: randFloat(4.0, 13.5), longitude: randFloat(2.5, 14.5) },
        isSpecificLocation: true,
      },
      supportedEvents: pickN(EVENT_TYPES, randInt(3, 8)),
      amenities: pickN(AMENITIES, randInt(4, 8)),
      availability: {
        minDuration: 1,
        maxDuration: 365,
        bookingWindow: pick([3, 6, 9, 12]),
        unavailableDates,
        unavailableSlots: [],
        customPrices: [],
        advanceNotice: { days: pick([0, 1, 2, 3]) },
        preparationTime: pick([0, 1]),
        operationalHours: { open: "06:00", close: "23:00" },
      },
      capacity: { max: capacity },
      bookingSettings: pick(["REVIEW", "INSTANT"]),
      basePrice: { amount: basePrice, currency: "NGN", symbol: "₦", unit: "day", feeMode: "addon", minDuration: 1 },
      weekendPrice: { amount: Math.round(basePrice * 1.3), currency: "NGN", symbol: "₦", unit: "day", feeMode: "addon", minDuration: 1 },
      discounts: pickN(["MULTI_DAY", "EARLY_BIRD", "OFF_PEAK", "LOYALTY"], randInt(0, 3)),
      venueRules: pickN(VENUE_RULES, randInt(2, 5)),
      safety: pickN(SAFETY_OPTIONS, randInt(2, 5)),
      safetyConsiderations: pickN(SAFETY_CONSIDERATIONS, randInt(1, 3)),
      checkIn: { isFlexible: Math.random() > 0.5, start: "14:00", end: "18:00" },
      checkOut: { time: "12:00" },
      status: pick(["LISTED", "LISTED", "LISTED", "ACTION_REQUIRED"]),
      createdBy: organiser._id,
      coHosts: coHosts.map((c) => c._id),
      staff: assignedStaff.map((s) => s._id),
      performance: {
        views: randInt(200, 15000),
        clicks: randInt(100, 8000),
        wishlists: randInt(20, 2000),
        bookings: randInt(5, 200),
        revenue: randInt(500000, 100000000),
        reach: randInt(1000, 100000),
        engagement: randInt(200, 10000),
        shares: randInt(20, 1000),
      },
      createdAt: dateBetween(TWO_YEARS_AGO, new Date(NOW.getFullYear() - 1, 0, 1)),
      updatedAt: dateBetween(TWO_YEARS_AGO, NOW),
    });
  }

  await EventCenter.deleteMany({});
  const inserted = await EventCenter.insertMany(centres, { ordered: false });
  console.log(`  ✓ Created ${inserted.length} event centres`);
  return inserted;
}

async function seedTickets(events) {
  console.log("  Seeding Tickets...");
  const tickets = [];
  const ticketMap = {};

  for (const event of events) {
    const numTypes = randInt(2, 4);
    const selectedTypes = pickN(TICKET_TYPES, numTypes);
    ticketMap[event._id.toString()] = [];

    for (const tt of selectedTypes) {
      const qty = randInt(tt.qtyRange[0], tt.qtyRange[1]);
      const price = tt.type === "FREE" ? 0 : randInt(tt.priceRange[0], tt.priceRange[1]);
      const sold = randInt(0, Math.min(qty, Math.floor(qty * 0.8)));

      const ticket = {
        eventId: event._id,
        name: tt.name,
        description: `${tt.name} ticket for ${event.title}`,
        ticketType: tt.type,
        totalQuantity: qty,
        soldQuantity: sold,
        perTransactionLimit: { min: 1, max: Math.min(10, qty) },
        salesStartAt: new Date(event.createdAt.getTime() - 30 * 24 * 60 * 60 * 1000),
        salesEndAt: new Date(event.schedule?.from?.getTime() - 2 * 60 * 60 * 1000 || event.createdAt.getTime()),
        currency: { code: "NGN", symbol: "₦" },
        commission: { percentage: 15, type: "ADD_ON" },
        price: tt.type !== "FREE" ? { amountCents: price * 100 } : undefined,
        groupName: tt.name === "Free Entry" ? undefined : tt.name,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
      };
      tickets.push(ticket);
    }
  }

  await Ticket.deleteMany({});
  const inserted = await Ticket.insertMany(tickets, { ordered: false });
  console.log(`  ✓ Created ${inserted.length} ticket types`);
  return inserted;
}

async function seedEventBookings(events, tickets, users) {
  console.log("  Seeding Event Bookings...");
  const normalUsers = users.filter((u) => u.roles.includes("user") && !u.roles.includes("organiser"));

  const bookings = [];
  const bookingTickets = [];
  const issuedTickets = [];
  let ticketNumber = 100000;

  // Group tickets by event
  const ticketsByEvent = {};
  for (const t of tickets) {
    const eid = t.eventId.toString();
    if (!ticketsByEvent[eid]) ticketsByEvent[eid] = [];
    ticketsByEvent[eid].push(t);
  }

  const listedEvents = events.filter((e) => e.status === "LISTED" || e.status === "COMPLETED");
  let bookingCount = 0;

  for (const event of listedEvents) {
    const eventTickets = ticketsByEvent[event._id.toString()] || [];
    if (eventTickets.length === 0) continue;

    const numBookings = randInt(1, 6);
    for (let i = 0; i < numBookings && bookingCount < 200; i++) {
      const buyer = pick(normalUsers);
      const selectedTicket = pick(eventTickets);
      if (!selectedTicket.price) continue;
      const qty = randInt(1, Math.min(5, selectedTicket.totalQuantity - selectedTicket.soldQuantity));
      if (qty <= 0) continue;

      const pricePerUnit = selectedTicket.price.amountCents / 100;
      const totalAmount = pricePerUnit * qty;
      const isCompleted = Math.random() > 0.15;
      const paystackRef = `PSK${Date.now()}${randInt(100000, 999999)}`;
      const bookingDate = dateBetween(event.createdAt, new Date(Math.min(event.schedule?.from?.getTime() || NOW.getTime(), NOW.getTime())));

      const booking = {
        eventId: event._id,
        buyer: buyer._id,
        guestDetails: {
          fullName: `${buyer.firstName} ${buyer.surname}`,
          phoneNumber: buyer.phoneNumber,
          email: buyer.email,
        },
        items: [{
          ticketId: selectedTicket._id,
          name: selectedTicket.name,
          quantity: qty,
          pricePerUnit: pricePerUnit * 100,
          totalPrice: totalAmount * 100,
        }],
        totalAmount: totalAmount * 100,
        currency: "NGN",
        paymentStatus: isCompleted ? "COMPLETED" : pick(["PENDING", "FAILED", "REFUNDED"]),
        paymentMethod: pick(["PAYSTACK", "TRANSFER", "FREE"]),
        paystackReference: paystackRef,
        status: isCompleted ? "ACTIVE" : pick(["ACTIVE", "CANCELLED"]),
        createdAt: bookingDate,
        updatedAt: bookingDate,
      };
      bookings.push(booking);

      // Create individual tickets
      for (let j = 0; j < qty; j++) {
        ticketNumber++;
        const ticketStatus = isCompleted ? pick(["UNREDEEMED", "UNREDEEMED", "REDEEMED", "CHECKED_IN"]) : "CANCELLED";
        const isCheckedIn = ticketStatus === "CHECKED_IN";

        issuedTickets.push({
          bookingId: null, // will be set after insert
          eventId: event._id,
          ticketTypeId: selectedTicket._id,
          owner: buyer._id,
          ticketName: selectedTicket.name,
          ticketNumber: `TKT${ticketNumber}`,
          qrPayload: JSON.stringify({ ticketNumber: `TKT${ticketNumber}`, eventId: event._id, type: selectedTicket.name }),
          status: ticketStatus === "CHECKED_IN" ? "REDEEMED" : ticketStatus,
          redeemedAt: ticketStatus === "REDEEMED" || ticketStatus === "CHECKED_IN" ? bookingDate : undefined,
          checkIn: {
            isCheckedIn,
            checkedInAt: isCheckedIn ? new Date(bookingDate.getTime() + randInt(1, 4) * 60 * 60 * 1000) : undefined,
            method: isCheckedIn ? pick(["QR", "MANUAL"]) : undefined,
          },
          eventSnapshot: {
            title: event.title,
            shortDescription: event.shortDescription,
            eventType: event.eventType,
            organiser: {
              name: `${event.createdBy?.firstName || "Organiser"} ${event.createdBy?.surname || ""}`,
              email: "organiser@munasaba.com",
            },
            location: {
              addressString: event.location?.addressString,
              city: event.location?.city,
              country: "Nigeria",
              coordinates: event.location?.coordinates,
            },
            schedule: {
              startDate: event.schedule?.from,
              endDate: event.schedule?.to,
            },
          },
          ticketSnapshot: {
            name: selectedTicket.name,
            description: selectedTicket.description,
            ticketType: selectedTicket.ticketType,
            price: {
              amount: pricePerUnit,
              currency: "NGN",
              symbol: "₦",
            },
          },
          createdAt: bookingDate,
          updatedAt: bookingDate,
        });
      }

      bookingCount++;
    }
  }

  await EventBooking.deleteMany({});
  const insertedBookings = await EventBooking.insertMany(bookings, { ordered: false });
  console.log(`  ✓ Created ${insertedBookings.length} event bookings`);

  // Set bookingId references
  for (let i = 0; i < issuedTickets.length; i++) {
    if (i < insertedBookings.length) {
      issuedTickets[i].bookingId = insertedBookings[i % insertedBookings.length]._id;
    }
  }

  await UserEventTicket.deleteMany({});
  const insertedTickets = await UserEventTicket.insertMany(issuedTickets, { ordered: false });
  console.log(`  ✓ Created ${insertedTickets.length} issued event tickets`);

  return { insertedBookings, insertedTickets };
}

async function seedEventCentreBookings(centres, users) {
  console.log("  Seeding Event Centre Bookings...");
  const normalUsers = users.filter((u) => u.roles.includes("user") && !u.roles.includes("organiser"));
  const organisers = users.filter((u) => u.roles.includes("organiser"));

  const bookings = [];
  let ticketNumber = 200000;

  for (const centre of centres) {
    const numBookings = randInt(1, 4);
    for (let i = 0; i < numBookings; i++) {
      const buyer = pick(normalUsers);
      const organiser = organisers.find((o) => o._id.toString() === centre.createdBy.toString()) || pick(organisers);
      const bookingDate = randomEventDate();
      const isHourly = Math.random() > 0.5;
      const duration = isHourly ? randInt(2, 8) : randInt(1, 3);
      const unitPrice = isHourly ? (centre.basePrice?.amount || 100000) / 24 : (centre.basePrice?.amount || 100000);
      const totalAmount = Math.round(unitPrice * duration);

      const selectedDates = [];
      for (let d = 0; d < duration; d++) {
        const date = new Date(bookingDate.getTime() + d * 24 * 60 * 60 * 1000);
        selectedDates.push({
          date,
          startTime: isHourly ? "09:00" : undefined,
          endTime: isHourly ? "17:00" : undefined,
        });
      }

      ticketNumber++;
      const isCompleted = Math.random() > 0.2;

      bookings.push({
        buyer: buyer._id,
        organiser: organiser._id,
        eventCenter: centre._id,
        selectedDates,
        bookingUnit: isHourly ? "hour" : "day",
        duration,
        totalPrice: { amount: totalAmount, currency: "NGN" },
        paymentStatus: isCompleted ? "COMPLETED" : pick(["PENDING", "FAILED"]),
        paystackReference: `PSK${Date.now()}${randInt(100000, 999999)}`,
        status: isCompleted ? "ACTIVE" : pick(["ACTIVE", "CANCELLED"]),
        ticketNumber: `VNU${ticketNumber}`,
        qrPayload: JSON.stringify({ ticketNumber: `VNU${ticketNumber}`, eventCenter: centre._id }),
        checkIn: {
          isCheckedIn: isCompleted && Math.random() > 0.3,
          checkedInAt: isCompleted ? new Date(bookingDate.getTime() + randInt(1, 3) * 60 * 60 * 1000) : undefined,
          method: isCompleted ? pick(["QR", "MANUAL"]) : undefined,
        },
        createdAt: dateBetween(TWO_YEARS_AGO, bookingDate),
        updatedAt: dateBetween(TWO_YEARS_AGO, NOW),
      });
    }
  }

  await EventCenterTicket.deleteMany({});
  const inserted = await EventCenterTicket.insertMany(bookings, { ordered: false });
  console.log(`  ✓ Created ${inserted.length} event centre bookings`);
  return inserted;
}

async function seedCoHostInvitations(events, centres, users) {
  console.log("  Seeding Co-Host Invitations...");
  const organisers = users.filter((u) => u.roles.includes("organiser"));
  const invitations = [];

  const allListings = [
    ...events.slice(0, 30).map((e) => ({ listing: e, type: "Event" })),
    ...centres.slice(0, 20).map((c) => ({ listing: c, type: "EventCenter" })),
  ];

  for (const { listing, type } of allListings) {
    const numCoHosts = randInt(0, 2);
    for (let i = 0; i < numCoHosts; i++) {
      const coHost = pick(organisers.filter((o) => o._id.toString() !== listing.createdBy.toString()));
      invitations.push({
        host: listing.createdBy,
        coHostEmail: coHost.email,
        coHost: coHost._id,
        listings: [{ listingId: listing._id, listingType: type }],
        permissions: pickN(COHOST_PERMISSIONS, randInt(2, 5)),
        status: pick(["ACCEPTED", "ACCEPTED", "PENDING", "DECLINED"]),
        createdAt: listing.createdAt,
        updatedAt: listing.updatedAt,
      });
    }
  }

  await CoHostInvitation.deleteMany({});
  const inserted = await CoHostInvitation.insertMany(invitations, { ordered: false });
  console.log(`  ✓ Created ${inserted.length} co-host invitations`);
  return inserted;
}

async function seedStaffInvitations(events, centres, users) {
  console.log("  Seeding Staff Invitations...");
  const organisers = users.filter((u) => u.roles.includes("organiser"));
  const staffPool = users.filter((u) => !u.roles.includes("organiser"));

  const invitations = [];
  const allListings = [
    ...events.slice(0, 25).map((e) => ({ listing: e, type: "Event" })),
    ...centres.slice(0, 15).map((c) => ({ listing: c, type: "EventCenter" })),
  ];

  for (const { listing, type } of allListings) {
    const numStaff = randInt(1, 3);
    for (let i = 0; i < numStaff; i++) {
      const staff = pick(staffPool);
      invitations.push({
        organiser: listing.createdBy,
        staffEmail: staff.email,
        staff: staff._id,
        listings: [{ listingId: listing._id, listingType: type }],
        permissions: pickN(STAFF_PERMISSIONS, randInt(2, 4)),
        status: pick(["ACCEPTED", "ACCEPTED", "ACCEPTED", "PENDING"]),
        createdAt: listing.createdAt,
        updatedAt: listing.updatedAt,
      });
    }
  }

  await StaffInvitation.deleteMany({});
  const inserted = await StaffInvitation.insertMany(invitations, { ordered: false });
  console.log(`  ✓ Created ${inserted.length} staff invitations`);
  return inserted;
}

async function seedConversationsAndMessages(events, centres, users) {
  console.log("  Seeding Conversations & Messages...");
  const organisers = users.filter((u) => u.roles.includes("organiser"));
  const conversations = [];
  const messages = [];

  for (let i = 0; i < 40; i++) {
    const user1 = pick(users);
    const user2 = pick(users.filter((u) => u._id.toString() !== user1._id.toString()));
    const isEvent = Math.random() > 0.4;
    const context = isEvent ? pick(events) : pick(centres);

    const conv = {
      participants: [user1._id, user2._id],
      contextType: isEvent ? "Event" : "EventCenter",
      contextId: context._id,
      unreadCount: new Map([[user1._id.toString(), randInt(0, 3)], [user2._id.toString(), randInt(0, 3)]]),
      isReplied: Math.random() > 0.3,
      createdAt: dateBetween(TWO_YEARS_AGO, NOW),
      updatedAt: dateBetween(TWO_YEARS_AGO, NOW),
    };
    conversations.push(conv);
  }

  await Conversation.deleteMany({});
  const insertedConvs = await Conversation.insertMany(conversations, { ordered: false });

  // Create messages for each conversation
  for (const conv of insertedConvs) {
    const numMsgs = randInt(2, 8);
    const participants = conv.participants;
    let lastMsgId = null;

    for (let j = 0; j < numMsgs; j++) {
      const sender = participants[j % 2];
      const receiver = participants[(j + 1) % 2];
      const msg = {
        conversationId: conv._id,
        sender,
        receiver,
        content: pick(MESSAGE_TEMPLATES),
        read: j < numMsgs - 1 ? true : Math.random() > 0.3,
        contextType: conv.contextType,
        contextId: conv.contextId,
        createdAt: new Date(conv.createdAt.getTime() + j * randInt(60000, 3600000)),
        updatedAt: new Date(conv.createdAt.getTime() + j * randInt(60000, 3600000)),
      };
      messages.push(msg);
    }
  }

  await Message.deleteMany({});
  const insertedMsgs = await Message.insertMany(messages, { ordered: false });

  // Update conversations with lastMessage
  for (let i = 0; i < insertedConvs.length; i++) {
    const convMsgs = insertedMsgs.filter((m) => m.conversationId.toString() === insertedConvs[i]._id.toString());
    if (convMsgs.length > 0) {
      await Conversation.findByIdAndUpdate(insertedConvs[i]._id, { lastMessage: convMsgs[convMsgs.length - 1]._id });
    }
  }

  console.log(`  ✓ Created ${insertedConvs.length} conversations & ${insertedMsgs.length} messages`);
  return { insertedConvs, insertedMsgs };
}

async function seedNotifications(events, users) {
  console.log("  Seeding Notifications...");
  const notifications = [];
  const types = ["COHOST_INVITATION", "STAFF_INVITATION", "SYSTEM", "BOOKING_UPDATE"];
  const titles = {
    COHOST_INVITATION: "You've been invited as a co-organiser",
    STAFF_INVITATION: "You've been invited as staff",
    SYSTEM: "System Notification",
    BOOKING_UPDATE: "Booking Update",
  };
  const messages = {
    COHOST_INVITATION: "You have been invited to co-organise an event. Check your invitations tab.",
    STAFF_INVITATION: "You have been invited to join an event team. Check your invitations tab.",
    SYSTEM: "Welcome to Munasaba! Your account has been verified successfully.",
    BOOKING_UPDATE: "Your booking has been confirmed. Check your tickets for details.",
  };

  for (let i = 0; i < 100; i++) {
    const type = pick(types);
    const recipient = pick(users);
    const sender = pick(users.filter((u) => u._id.toString() !== recipient._id.toString()));

    notifications.push({
      recipient: recipient._id,
      sender: sender._id,
      type,
      title: titles[type],
      message: messages[type],
      referenceId: pick(events)._id,
      isRead: Math.random() > 0.4,
      createdAt: dateBetween(TWO_YEARS_AGO, NOW),
      updatedAt: dateBetween(TWO_YEARS_AGO, NOW),
    });
  }

  await Notification.deleteMany({});
  const inserted = await Notification.insertMany(notifications, { ordered: false });
  console.log(`  ✓ Created ${inserted.length} notifications`);
  return inserted;
}

async function seedStaffActivity(events, users) {
  console.log("  Seeding Staff Activity...");
  const staffUsers = users.filter((u) => u.roles.includes("staff") || (!u.roles.includes("organiser") && u.roles.includes("user")));
  const organisers = users.filter((u) => u.roles.includes("organiser"));
  const activities = [];

  const actionTitles = {
    SCAN: "Scanned ticket at gate",
    CHECK_IN: "Checked in attendee",
    SALE: "Processed ticket sale",
    LOGIN: "Logged into the system",
    TASK_COMPLETE: "Completed assigned task",
  };

  for (let i = 0; i < 150; i++) {
    const staff = pick(staffUsers);
    const organiser = pick(organisers);
    const action = pick(STAFF_ACTIONS);
    const event = pick(events);
    const activityDate = dateBetween(TWO_YEARS_AGO, NOW);

    activities.push({
      staff: staff._id,
      organiser: organiser._id,
      action,
      title: actionTitles[action],
      description: `${action.replace(/_/g, " ").toLowerCase()} operation performed at ${event.title || "event venue"}`,
      metadata: {
        eventId: event._id,
        eventTitle: event.title,
      },
      ipAddress: `197.${randInt(1, 255)}.${randInt(1, 255)}.${randInt(1, 255)}`,
      userAgent: pick(["Mozilla/5.0 (Windows NT 10.0)", "Mozilla/5.0 (iPhone)", "Mozilla/5.0 (Android)"]),
      createdAt: activityDate,
      updatedAt: activityDate,
    });
  }

  await StaffActivity.deleteMany({});
  const inserted = await StaffActivity.insertMany(activities, { ordered: false });
  console.log(`  ✓ Created ${inserted.length} staff activities`);
  return inserted;
}

async function seedKYC(users) {
  console.log("  Seeding Identity Verifications...");
  const kycRecords = [];
  const idTypes = ["DL", "PP", "ID"];
  const statuses = ["pending", "approved", "approved", "approved", "rejected"];

  for (let i = 0; i < 50; i++) {
    const user = pick(users);
    const status = pick(statuses);
    const createdAt = dateBetween(TWO_YEARS_AGO, NOW);

    kycRecords.push({
      userId: user._id,
      idType: pick(idTypes),
      idFrontImage: { url: null, publicId: null },
      idBackImage: { url: null, publicId: null },
      selfieImage: { url: null, publicId: null },
      status,
      rejectionReason: status === "rejected" ? pick(["Blurry image", "ID expired", "Name mismatch", "Photo does not match"]) : null,
      reviewedAt: status !== "pending" ? new Date(createdAt.getTime() + randInt(1, 48) * 60 * 60 * 1000) : null,
      reviewedBy: status !== "pending" ? user._id : null,
      createdAt,
      updatedAt: createdAt,
    });
  }

  await IdentityVerification.deleteMany({});
  const inserted = await IdentityVerification.insertMany(kycRecords, { ordered: false });
  console.log(`  ✓ Created ${inserted.length} KYC records`);
  return inserted;
}

async function seedAuditLogs(adminStaff, users, events, centres) {
  console.log("  Seeding Audit Logs...");
  const logs = [];
  const actions = [
    "ADMIN_LOGIN", "STAFF_INVITED", "STAFF_SUSPENDED", "STAFF_REACTIVATED",
    "USER_SUSPENDED", "USER_REACTIVATED", "USER_KYC_APPROVED", "USER_KYC_REJECTED",
    "LISTING_STATUS_UPDATED", "BOOKING_STATUS_UPDATED", "STAFF_ROLES_UPDATED",
  ];

  for (let i = 0; i < 30; i++) {
    const admin = pick(adminStaff);
    const action = pick(actions);
    const targetType = pick(["User", "Event", "EventCenter", "Admin", "EventBooking"]);
    const target = targetType === "User" ? pick(users) : targetType === "Event" ? pick(events) : targetType === "EventCenter" ? pick(centres) : pick(adminStaff);

    logs.push({
      admin: admin._id,
      action,
      targetType,
      targetId: target._id,
      previousValue: { status: "active" },
      newValue: { status: "suspended" },
      metadata: { reason: pick(["Policy violation", "Inactivity", "Request", "Automated"]) },
      ipAddress: `197.${randInt(1, 255)}.${randInt(1, 255)}.${randInt(1, 255)}`,
      createdAt: dateBetween(TWO_YEARS_AGO, NOW),
      updatedAt: dateBetween(TWO_YEARS_AGO, NOW),
    });
  }

  await AdminAuditLog.deleteMany({});
  const inserted = await AdminAuditLog.insertMany(logs, { ordered: false });
  console.log(`  ✓ Created ${inserted.length} audit logs`);
  return inserted;
}

// ─── Main ────────────────────────────────────────────────────────────
async function seed() {
  console.log("Starting database seed...");
  console.log(`  Date range: ${formatDate(TWO_YEARS_AGO)} to ${formatDate(NOW)}`);
  console.log("");

  await connectDB();

  console.log("Step 1/18: Users");
  const users = await seedUsers();

  console.log("Step 2/18: Admin Staff");
  const adminStaff = await seedAdminStaff();

  console.log("Step 3/18: Platform Config");
  await seedPlatformConfig();

  console.log("Step 4/18: Events");
  const events = await seedEvents(users);

  console.log("Step 5/18: Event Centres");
  const centres = await seedEventCentres(users);

  console.log("Step 6/18: Tickets");
  const tickets = await seedTickets(events);

  console.log("Step 7/18: Co-Host Invitations");
  await seedCoHostInvitations(events, centres, users);

  console.log("Step 8/18: Staff Invitations");
  await seedStaffInvitations(events, centres, users);

  console.log("Step 9/18: Event Bookings");
  await seedEventBookings(events, tickets, users);

  console.log("Step 10/18: Event Centre Bookings");
  await seedEventCentreBookings(centres, users);

  console.log("Step 11/18: Conversations & Messages");
  await seedConversationsAndMessages(events, centres, users);

  console.log("Step 12/18: Notifications");
  await seedNotifications(events, users);

  console.log("Step 13/18: Staff Activity");
  await seedStaffActivity(events, users);

  console.log("Step 14/18: KYC Records");
  await seedKYC(users);

  console.log("Step 15/18: Audit Logs");
  await seedAuditLogs(adminStaff, users, events, centres);

  console.log("");
  console.log("Seed complete!");
  console.log("");
  console.log("Summary:");
  console.log(`  Users:           ${users.length}`);
  console.log(`  Admin Staff:     ${adminStaff.length}`);
  console.log(`  Events:          ${events.length}`);
  console.log(`  Event Centres:   ${centres.length}`);
  console.log(`  Ticket Types:    ${tickets.length}`);
  console.log(`  Admin Login:     admin@munasaba.com / 12345678`);
  console.log(`  User Login:      a@a.com through v@d.com / 12345678`);
  console.log("");
  console.log("Test accounts:");
  console.log("  Organisers:  a@a.com through b@c.com (50 accounts)");
  console.log("  Normal:      c@c.com through o@c.com (25 accounts)");
  console.log("  Staff:       p@c.com through v@d.com (25 accounts)");
}

seed()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
    console.log("Database connection closed.");
  });
