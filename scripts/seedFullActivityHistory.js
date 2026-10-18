/**
 * Seed 1 Year of Realistic Platform Activity & Lifecycle:
 * - Organisers chosen from the top 100 verified users + admin
 * - 12+ Luxury Event Centers with active/completed bookings, review bookings, manual check-ins, payouts, and history
 * - 32+ Rich Events (Completed over 12 months, In-Progress, Upcoming, and Cancelled)
 * - Ticket Types (VIP, Regular, Early Bird, VVIP) with prices, limits, and inventory
 * - 120+ Ticket Bookings & 250+ User Event Tickets with valid signed QR payloads
 * - Ticket Scans (QR & Manual check-ins with timestamps and staff actors)
 * - Ticket Transfers (Accepted with history, and Pending)
 * - Cancelled Events & Refunds (Confirmed by buyer, marked paid, due from organiser)
 * - Staff & Co-Organisers with accepted invitations and staff audit activity logs
 * - Venue Payouts & Booking Attendance records
 * - Notifications with SMS, Push, Email, and In-App deliveries
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const crypto = require("crypto");
const { generateTicketNumber, generateQRPayload } = require("../utils/qr");
const { NOTIFICATION_CATEGORIES, NOTIFICATION_TYPES } = require("../constants/notificationTypes");

// Models
const User = require("../models/client/user.schema");
const Event = require("../models/client/event.schema");
const Ticket = require("../models/client/eventTicketType.schema");
const EventBooking = require("../models/client/eventBooking.schema");
const UserEventTicket = require("../models/client/userEventTicket.schema");
const EventCenter = require("../models/client/eventCenter.schema");
const EventCenterBooking = require("../models/client/eventCenterBooking.schema");
const VenuePayout = require("../models/client/venuePayout.schema");
const BookingHistory = require("../models/client/bookingHistory.schema");
const BookingAttendance = require("../models/client/bookingAttendance.schema");
const ManualBookingCheckIn = require("../models/client/manualBookingCheckIn.schema");
const TicketTransferRequest = require("../models/client/ticketTransferRequest.schema");
const EventRefund = require("../models/client/eventRefund.schema");
const CoOrganiserInvitation = require("../models/client/coOrganiserInvitation.schema");
const StaffInvitation = require("../models/client/staffInvitation.schema");
const StaffActivity = require("../models/client/staffActivity.schema");
const Notification = require("../models/client/notification.schema");

// Image Assets
const IMAGES = [
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782721567/xzztq4dqsrkf76dzkfur.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782721569/a05n5cglx6evjrqsc2oz.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782721571/njoqraobewtkf32rttoz.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782721482/im3y0k1sw62dgfnl3ckf.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782721483/wz9sspasxh3rrn53zpbr.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782721486/ji6wqk4zecjuiexg1khh.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782721833/zkbct2xf4toplvqxhduc.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782721834/vnftnzh8hfxpwsscg4ry.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782721836/bjyycbolhvhp2rdkxiro.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782721762/hhxpmt15gryvbhw34cdn.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782721764/hfe9azf7ttcyk2o6efag.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782721766/npg11ib8beyiozpcnvvm.jpg",
];

// Performers pool
const PERFORMERS = [
  { name: "Burna Boy & The Outsiders", role: "Headliner", bio: "Grammy-winning Afrobeats icon performing global anthems." },
  { name: "Wizkid & Starboy Live", role: "Co-Headliner", bio: "Global music sensation delivering melodic hits." },
  { name: "Davido & The Compozers", role: "Special Guest", bio: "Timeless festival headliner with electric stage presence." },
  { name: "Asake & Symphony", role: "Performer", bio: "Fuji-infused fusion and high-octane modern street anthems." },
  { name: "Tiwa Savage", role: "Guest Artiste", bio: "The Queen of Afrobeats delivering soulful, vibrant sounds." },
  { name: "DJ Spinall", role: "Official Festival DJ", bio: "Top boy delivering curated Afro-house and party tracks." },
  { name: "Dr. Bosun Tijani", role: "Keynote Speaker", bio: "Leading discussions on digital infrastructure and future tech." },
  { name: "Iyinoluwa Aboyeji", role: "Tech Panelist", bio: "Venture capitalist and founder sharing startup scaling insights." },
  { name: "Basketmouth", role: "Host & MC", bio: "Africa's comedy titan keeping audiences in stitches." },
  { name: "Chef Fregz", role: "Masterclass Host", bio: "Renowned culinary artist exploring modern African gastronomy." }
];

// 12 Curated Venue Templates
const VENUE_DEFINITIONS = [
  {
    venueName: "Eko Convention & Grand Arena",
    venueType: "CONVENTION_CENTER",
    city: "Lagos",
    addressString: "Plot 1415 Adetokunbo Ademola St, Victoria Island, Lagos",
    street: "Plot 1415 Adetokunbo Ademola St",
    capacity: 2500,
    baseHourly: 250000,
    baseDaily: 2500000,
    bookingSettings: "INSTANT",
  },
  {
    venueName: "Landmark Oceanfront Pavilion",
    venueType: "OUTDOOR_VENUE",
    city: "Lagos",
    addressString: "Water Corporation Drive, Victoria Island, Lagos",
    street: "Water Corporation Drive",
    capacity: 1800,
    baseHourly: 180000,
    baseDaily: 1800000,
    bookingSettings: "REVIEW",
  },
  {
    venueName: "Balmoral Luxury Ballroom",
    venueType: "BANQUET_HALL",
    city: "Lagos",
    addressString: "Federal Palace Hotel, Ahmadu Bello Way, Victoria Island, Lagos",
    street: "Ahmadu Bello Way",
    capacity: 1200,
    baseHourly: 200000,
    baseDaily: 2000000,
    bookingSettings: "INSTANT",
  },
  {
    venueName: "Transcorp Hilton Congress Hall",
    venueType: "HOTEL_VENUE",
    city: "Abuja",
    addressString: "1 Aguiyi Ironsi St, Maitama, Abuja",
    street: "1 Aguiyi Ironsi St",
    capacity: 1500,
    baseHourly: 220000,
    baseDaily: 2200000,
    bookingSettings: "REVIEW",
  },
  {
    venueName: "Abuja International Dome",
    venueType: "CONVENTION_CENTER",
    city: "Abuja",
    addressString: "Plot 423 Adekunle Fajuyi Way, Central Area, Abuja",
    street: "Adekunle Fajuyi Way",
    capacity: 2000,
    baseHourly: 210000,
    baseDaily: 2100000,
    bookingSettings: "INSTANT",
  },
  {
    venueName: "Tahir Royal Convention Palace",
    venueType: "BANQUET_HALL",
    city: "Kano",
    addressString: "4 Bank Rd, Nasarawa GRA, Kano",
    street: "4 Bank Rd",
    capacity: 1100,
    baseHourly: 120000,
    baseDaily: 1200000,
    bookingSettings: "INSTANT",
  },
  {
    venueName: "Ado Bayero Cultural Arena",
    venueType: "THEATER_AUDITORIUM",
    city: "Kano",
    addressString: "Zoo Road, Kano",
    street: "Zoo Road",
    capacity: 1400,
    baseHourly: 140000,
    baseDaily: 1400000,
    bookingSettings: "REVIEW",
  },
  {
    venueName: "Harbour Point Grand Hall",
    venueType: "HOTEL_VENUE",
    city: "Lagos",
    addressString: "4 Wilmot Point Rd, Victoria Island, Lagos",
    street: "4 Wilmot Point Rd",
    capacity: 950,
    baseHourly: 160000,
    baseDaily: 1600000,
    bookingSettings: "INSTANT",
  },
  {
    venueName: "Aztech Arcum Event Centre",
    venueType: "CONVENTION_CENTER",
    city: "Port Harcourt",
    addressString: "Stadium Road, Port Harcourt",
    street: "Stadium Road",
    capacity: 1300,
    baseHourly: 150000,
    baseDaily: 1500000,
    bookingSettings: "REVIEW",
  },
  {
    venueName: "Jogor International Centre",
    venueType: "BANQUET_HALL",
    city: "Ibadan",
    addressString: "1 Harvester Drive, Liberty Stadium Rd, Ibadan",
    street: "Liberty Stadium Rd",
    capacity: 1000,
    baseHourly: 110000,
    baseDaily: 1100000,
    bookingSettings: "INSTANT",
  },
  {
    venueName: "The Grand Westminster Hall",
    venueType: "CONFERENCE_HALL",
    city: "London",
    addressString: "Victoria Embankment, Westminster, London SW1A 2JH",
    street: "Victoria Embankment",
    capacity: 800,
    baseHourly: 350000,
    baseDaily: 3500000,
    bookingSettings: "REVIEW",
  },
  {
    venueName: "Manhattan Sky Lounge & Terrace",
    venueType: "CLUB_LOUNGE",
    city: "New York",
    addressString: "450 W 33rd St, Manhattan, New York, NY 10001",
    street: "450 W 33rd St",
    capacity: 650,
    baseHourly: 400000,
    baseDaily: 4000000,
    bookingSettings: "INSTANT",
  }
];

// 32 Curated Events Spanning 1 Year (Oct 2025 to Dec 2026)
const EVENT_DEFINITIONS = [
  // 12 to 10 months ago (Oct - Dec 2025): Completed
  { title: "Lagos AfroTech Summit 2025", type: "TECHNOLOGY_INNOVATION", monthsAgo: 12, daysAgo: 360, desc: "Connecting Africa's brightest tech innovators, AI builders, and venture capital funds." },
  { title: "Eko Music & Arts Carnival 2025", type: "MUSIC_CONCERTS", monthsAgo: 11, daysAgo: 335, desc: "Coastal celebration of contemporary Afrobeats, Highlife, and visual arts." },
  { title: "Northern Flavors Food Expo 2025", type: "FOOD_DRINK", monthsAgo: 11, daysAgo: 320, desc: "Traditional culinary delicacies, spices, and contemporary African street food." },
  { title: "Abuja Executive Leadership Banquet", type: "BUSINESS_NETWORKING", monthsAgo: 10, daysAgo: 300, desc: "High-level networking banquet for private sector executives and enterprise leaders." },
  { title: "Countdown to 2026 Mega Concert", type: "PARTIES_NIGHTLIFE", monthsAgo: 10, daysAgo: 284, desc: "Electrifying New Year countdown concert with superstar performances and fireworks." },

  // 9 to 7 months ago (Jan - Mar 2026): Completed
  { title: "Naija Gaming & Esports Championship", type: "GAMING_ESPORTS", monthsAgo: 9, daysAgo: 260, desc: "Competitive arena gaming, live streaming shoutcasting, and major prize tournaments." },
  { title: "Durbar Cultural Royal Festival 2026", type: "COMMUNITY_LOCAL", monthsAgo: 8, daysAgo: 240, desc: "Spectacular royal equestrian cavalry parade, music, and centuries-old culture." },
  { title: "African Fashion Week & Runway Gala", type: "FASHION_BEAUTY", monthsAgo: 8, daysAgo: 225, desc: "Haute couture runway showcases featuring top international and African designers." },
  { title: "Abuja International Comedy Fest", type: "COMEDY_ENTERTAINMENT", monthsAgo: 7, daysAgo: 210, desc: "Laugh out loud comedy night featuring the nation's premier stand-up talents." },
  { title: "West African Art & Sculpture Biennale", type: "ARTS_CULTURE", monthsAgo: 7, daysAgo: 195, desc: "Contemporary paintings, installations, and bronze sculptures by leading masters." },

  // 6 to 4 months ago (Apr - Jun 2026): Completed
  { title: "Lagos Marathon & Wellness Expo", type: "SPORTS_FITNESS", monthsAgo: 6, daysAgo: 180, desc: "Endurance running, physical fitness sessions, and community sports gala." },
  { title: "Suya, Grills & Craft Drinks Fiesta", type: "FOOD_DRINK", monthsAgo: 6, daysAgo: 165, desc: "Smoky spiced briskets, seafood grills, and curated cocktail mixology." },
  { title: "African Cloud & AI Frontier 2026", type: "TECHNOLOGY_INNOVATION", monthsAgo: 5, daysAgo: 150, desc: "LLM engineering, sovereign cloud infrastructure, and autonomous systems." },
  { title: "Women in Leadership & Tech Forum", type: "CAREER_JOBS", monthsAgo: 5, daysAgo: 135, desc: "Mentorship circles, venture scaling workshops, and executive panels." },
  { title: "Sahelian Solar & Energy Conclave", type: "SCIENCE_ENGINEERING", monthsAgo: 4, daysAgo: 120, desc: "Decarbonizing industrial energy with off-grid micro-grids and renewables." },
  { title: "Afrobeats Summer Jam 2026", type: "MUSIC_CONCERTS", monthsAgo: 4, daysAgo: 105, desc: "The ultimate outdoor summertime stadium concert celebrating chart toppers." },

  // 3 to 1 months ago (Jul - Sep 2026): Completed
  { title: "Nollywood Cinema Creators Conclave", type: "FILM_MEDIA", monthsAgo: 3, daysAgo: 90, desc: "International streaming distributions, film directing masterclasses, and premieres." },
  { title: "Kano Textile & Artisanal Expo 2026", type: "COMMUNITY_LOCAL", monthsAgo: 3, daysAgo: 75, desc: "Centuries-old indigo dye crafts meeting modern luxury fashion houses." },
  { title: "Lagos Street Food & Night Market", type: "FOOD_DRINK", monthsAgo: 2, daysAgo: 60, desc: "Late-night artisan street bites, live acoustic busking, and lively community vibes." },
  { title: "African Venture Capital Summit 2026", type: "STARTUPS_ENTREPRENEURSHIP", monthsAgo: 2, daysAgo: 45, desc: "Early-stage founders, accelerators, and venture capitalists exploring deals." },
  { title: "Eko Rhythm & Jazz Festival 2026", type: "MUSIC_CONCERTS", monthsAgo: 1, daysAgo: 30, desc: "Legendary jazz instrumentalists collaborating with contemporary Afro-fusionists." },
  { title: "Hope Health Foundation Charity Gala", type: "CHARITY_FUNDRAISING", monthsAgo: 1, daysAgo: 18, desc: "Black-tie fundraising ball providing rural community health and vision care." },

  // 2 Cancelled Events (Proper cancellation lifecycle & refund obligations)
  {
    title: "Monsoon Coastal Beach Regatta",
    type: "FESTIVALS_FAIRS",
    monthsAgo: 2,
    daysAgo: 55,
    isCancelled: true,
    cancelReason: "Severe tropical monsoon storm warning issued by marine weather authority.",
    desc: "Coastal boat regatta cancelled due to adverse weather advisories."
  },
  {
    title: "International Aviation & Flight Expo",
    type: "CONFERENCES_SEMINARS",
    monthsAgo: 4,
    daysAgo: 110,
    isCancelled: true,
    cancelReason: "Airspace maintenance schedule conflict at the host airfield.",
    desc: "Aviation showcase cancelled due to airfield scheduling reallocations."
  },

  // 2 Active / Ongoing Events (Happening this week in October 2026!)
  {
    title: "Munasaba Live Tech & Music Festival 2026",
    type: "FESTIVALS_FAIRS",
    isActiveNow: true,
    desc: "The premier 3-day hybrid celebration of tech demos, gaming tournaments, and live concerts!"
  },
  {
    title: "Lagos Contemporary Art Weekender",
    type: "ARTS_CULTURE",
    isActiveNow: true,
    desc: "Interactive canvas installations and gallery open-studios happening across the city."
  },

  // 6 Upcoming Listed Events (Scheduled in upcoming weeks/months)
  { title: "Lagos AfroBeats Mega Arena Carnival", type: "MUSIC_CONCERTS", isUpcoming: true, daysFromNow: 14, desc: "High energy music carnival featuring world-renowned superstars." },
  { title: "West Africa Clean Mobility Expo", type: "SCIENCE_ENGINEERING", isUpcoming: true, daysFromNow: 28, desc: "Electric vehicle charging networks and green public transportation." },
  { title: "Abuja Gourmet Food & Wine Fair 2026", type: "FOOD_DRINK", isUpcoming: true, daysFromNow: 42, desc: "Five-star dining tasting menus presented by internationally acclaimed chefs." },
  { title: "Naija Esports Pro Invitational Cup", type: "GAMING_ESPORTS", isUpcoming: true, daysFromNow: 56, desc: "Top esports rosters clashing in live broadcast playoff showdowns." },
  { title: "Sahel Health Tech Innovation Forum", type: "HEALTH_WELLNESS", isUpcoming: true, daysFromNow: 70, desc: "Telemedicine clinics, AI diagnostics, and rural healthcare delivery systems." },
  { title: "New Year Eve 2027 Grand Celebration", type: "PARTIES_NIGHTLIFE", isUpcoming: true, daysFromNow: 83, desc: "The most anticipated grand countdown ball and celebration welcoming 2027!" }
];

async function seedOneYearActivity() {
  console.log("==================================================");
  console.log("   SEEDING 1 FULL YEAR OF PLATFORM ACTIVITY");
  console.log("==================================================");

  await mongoose.connect(process.env.DATABASE_URI);
  console.log(" Connected to MongoDB:", mongoose.connection.name);

  // 1. Fetch Cohorts of Users
  console.log(" Fetching user cohorts from database...");
  const verifiedOrganisers = await User.find({ isIdentityVerified: true }).limit(25).lean();
  if (verifiedOrganisers.length === 0) {
    throw new Error("No verified organisers found! Please run 'npm run seed:users' first.");
  }

  const adminUser = await User.findOne({ email: "a@admin.com" }).lean();
  const primaryOrganisers = [...verifiedOrganisers];
  if (adminUser && !primaryOrganisers.some(u => u.email === adminUser.email)) {
    primaryOrganisers.unshift(adminUser);
  }

  // Staff and Co-organisers pool (users 5 through 30)
  const helperUsers = await User.find().skip(5).limit(50).lean();
  const staffPool = helperUsers.slice(0, 20);
  const coOrganiserPool = helperUsers.slice(20, 35);

  // Buyer pool (large cohort of attendees)
  const buyerPool = await User.find().skip(50).limit(400).lean();

  console.log(` - Selected ${primaryOrganisers.length} verified organizers`);
  console.log(` - Selected ${staffPool.length} staff members and ${coOrganiserPool.length} co-organizers`);
  console.log(` - Selected ${buyerPool.length} buyers for booking generation`);

  // Clear previous activity collections to maintain clean state
  console.log(" Clearing previous event/venue activity collections...");
  await Promise.all([
    Event.deleteMany({}),
    Ticket.deleteMany({}),
    EventBooking.deleteMany({}),
    UserEventTicket.deleteMany({}),
    EventCenter.deleteMany({}),
    EventCenterBooking.deleteMany({}),
    VenuePayout.deleteMany({}),
    BookingHistory.deleteMany({}),
    BookingAttendance.deleteMany({}),
    ManualBookingCheckIn.deleteMany({}),
    TicketTransferRequest.deleteMany({}),
    EventRefund.deleteMany({}),
    CoOrganiserInvitation.deleteMany({}),
    StaffInvitation.deleteMany({}),
    StaffActivity.deleteMany({}),
    Notification.deleteMany({}),
  ]);
  console.log(" Existing activity cleared.");

  // 2. Create Luxury Event Centers (Venues)
  console.log("\n Creating 12 Luxury Event Centers...");
  const createdVenues = [];

  for (let i = 0; i < VENUE_DEFINITIONS.length; i++) {
    const v = VENUE_DEFINITIONS[i];
    const organiser = primaryOrganisers[i % primaryOrganisers.length];
    const venueCoOrganisers = [coOrganiserPool[i % coOrganiserPool.length]._id];
    const venueStaff = [staffPool[i % staffPool.length]._id, staffPool[(i + 1) % staffPool.length]._id];

    const venueId = new mongoose.Types.ObjectId();
    const venueCreated = new Date(Date.now() - 365 * 86400000);

    const venue = await EventCenter.create({
      _id: venueId,
      venueName: v.venueName,
      venueType: v.venueType,
      yearEstablished: 2018 + (i % 6),
      totalArea: { value: 1200 + i * 150, unit: "SQ_METERS" },
      hallType: "Grand Ballroom & Exhibition Space",
      venueSetting: "Indoor with Luxury Outdoor Foyer",
      shortDescription: `Premier event destination in ${v.city} featuring top-tier acoustics and full amenities.`,
      description: `${v.venueName} is an iconic event space hosting weddings, summits, banquets, and major conventions. Equipped with high-speed fiber, executive lounges, and backup generators.`,
      oneLiner: `State-of-the-art event architecture in the heart of ${v.city}.`,
      theSpace: "Soaring 9-meter ceilings, pillarless open hall, ambient LED mood lighting, and acoustic dampening.",
      yourProperty: "Secure gated compound with dedicated multi-level valet parking and VIP holding suites.",
      location: {
        addressString: v.addressString,
        street: v.street,
        city: v.city,
        country: v.city === "London" ? "United Kingdom" : v.city === "New York" ? "United States" : "Nigeria",
        coordinates: { latitude: 6.428 + (i * 0.01), longitude: 3.421 + (i * 0.01) },
        isSpecificLocation: true,
      },
      supportedEvents: ["MUSIC_CONCERTS", "CONFERENCES_SEMINARS", "PARTIES_NIGHTLIFE", "BUSINESS_NETWORKING"],
      images: [
        { publicId: `seed/venue_${venueId}_1`, url: IMAGES[i % IMAGES.length], position: 0 },
        { publicId: `seed/venue_${venueId}_2`, url: IMAGES[(i + 1) % IMAGES.length], position: 1 },
      ],
      amenities: ["PARKING", "RESTROOMS", "VIP_AREA", "WIFI", "FIRST_AID", "SEATING"],
      capacity: { max: v.capacity },
      bookingSettings: v.bookingSettings,
      basePrice: {
        amount: v.baseDaily,
        currency: "NGN",
        unit: "day",
        feeMode: "addon",
        minDuration: 1,
      },
      weekendPrice: {
        amount: Math.round(v.baseDaily * 1.2),
        currency: "NGN",
        unit: "day",
        feeMode: "addon",
        minDuration: 1,
      },
      safety: ["FIRE_EXTINGUISHER", "EMERGENCY_EXIT", "CCTV", "FIRST_AID_KIT", "SECURITY_STATION"],
      safetyConsiderations: ["FIRE_SAFETY_COMPLIANCE", "EMERGENCY_PLAN", "CROWD_MANAGEMENT"],
      venueRules: ["NO_SMOKING", "SECURITY_REQUIRED"],
      status: "LISTED",
      createdBy: organiser._id,
      coOrganisers: venueCoOrganisers,
      staff: venueStaff,
      performance: {
        views: 1200 + i * 140,
        clicks: 450 + i * 50,
        wishlists: 80 + i * 15,
        bookings: 6 + (i % 4),
        revenue: v.baseDaily * 5,
      },
      createdAt: venueCreated,
      updatedAt: venueCreated,
    });

    createdVenues.push(venue);

    // Create Co-Organiser invitation
    await CoOrganiserInvitation.create({
      host: organiser._id,
      coOrganiserEmail: coOrganiserPool[i % coOrganiserPool.length].email,
      coOrganiser: coOrganiserPool[i % coOrganiserPool.length]._id,
      listings: [{ listingId: venue._id, listingType: "EventCenter" }],
      permissions: ["ALL_ACCESS", "MANAGE_LISTING", "MANAGE_BOOKINGS", "VIEW_FINANCES"],
      status: "ACCEPTED",
      respondedAt: new Date(venueCreated.getTime() + 86400000 * 2),
      createdAt: venueCreated,
    });

    // Create Staff invitation
    await StaffInvitation.create({
      organiser: organiser._id,
      staffEmail: staffPool[i % staffPool.length].email,
      staff: staffPool[i % staffPool.length]._id,
      listings: [{ listingId: venue._id, listingType: "EventCenter" }],
      permissions: ["ALL_ACCESS", "MANAGE_BOOKINGS", "SCAN_TICKET"],
      status: "ACCEPTED",
      respondedAt: new Date(venueCreated.getTime() + 86400000 * 3),
      createdAt: venueCreated,
    });
  }
  console.log(` Created ${createdVenues.length} listed event centers with team invitations.`);

  // 3. Generate Event Center Bookings, Check-ins, Payouts, and Booking History
  console.log("\n Generating Event Center Bookings (Instant, Review, Manual, Payouts)...");
  let venueBookingsCount = 0;

  for (let vi = 0; vi < createdVenues.length; vi++) {
    const venue = createdVenues[vi];
    const organiser = primaryOrganisers[vi % primaryOrganisers.length];

    // Generate 3 bookings per venue spread over the year:
    // 1 Past Completed (QR check-in & successful payout)
    // 1 Past Completed (Manual check-in & successful payout)
    // 1 Active or Pending Review
    const bookingConfigs = [
      { monthsAgo: 8, daysAgo: 240, status: "COMPLETED", checkInMethod: "QR", mode: "INSTANT" },
      { monthsAgo: 4, daysAgo: 120, status: "COMPLETED", checkInMethod: "MANUAL", mode: "REVIEW" },
      { monthsAgo: 0, daysAgo: -15, status: vi % 2 === 0 ? "CONFIRMED" : "PENDING_REVIEW", mode: venue.bookingSettings },
    ];

    for (let bi = 0; bi < bookingConfigs.length; bi++) {
      const cfg = bookingConfigs[bi];
      const buyer = buyerPool[(vi * 7 + bi * 13) % buyerPool.length];
      const staffMember = staffPool[vi % staffPool.length];
      const bookingDate = new Date(Date.now() - cfg.daysAgo * 86400000);
      const bookingDuration = 1;
      const subtotal = venue.basePrice.amount;
      const platformFee = Math.round(subtotal * 0.1);
      const organiserPayout = subtotal - platformFee;
      const totalPrice = subtotal + platformFee;
      const ticketNum = generateTicketNumber("MNS");
      const qrData = generateQRPayload(ticketNum, venue._id, "EVENT_CENTER");

      const bookingId = new mongoose.Types.ObjectId();
      const isPast = cfg.status === "COMPLETED";

      const centerBooking = await EventCenterBooking.create({
        _id: bookingId,
        buyer: buyer._id,
        guestDetails: {
          fullName: `${buyer.firstName} ${buyer.surname}`,
          phoneNumber: buyer.phoneNumber,
          email: buyer.email,
        },
        organiser: organiser._id,
        eventCenter: venue._id,
        selectedDates: [{ date: bookingDate }],
        bookingUnit: "day",
        duration: bookingDuration,
        totalPrice: { amount: totalPrice, currency: "NGN" },
        subtotalPrice: { amount: subtotal, currency: "NGN" },
        platformFeeAmount: platformFee,
        buyerFeeAmount: platformFee,
        organiserFeeAmount: 0,
        organiserPayoutAmount: organiserPayout,
        feePercentage: 10,
        feeMode: "PASS_TO_BUYER",
        paymentStatus: isPast || cfg.status === "CONFIRMED" ? "COMPLETED" : "PENDING",
        payoutDestination: organiser.bankDetails,
        paymentReference: `PAY_VEN_${bookingId}_${bi}`,
        status: cfg.status,
        bookingMode: cfg.mode,
        reviewDeadline: cfg.mode === "REVIEW" ? new Date(bookingDate.getTime() + 86400000 * 2) : undefined,
        reviewedAt: cfg.mode === "REVIEW" ? new Date(bookingDate.getTime() - 86400000 * 5) : undefined,
        ticketNumber: ticketNum,
        qrPayload: qrData,
        checkIn: {
          isCheckedIn: isPast,
          proofVerified: isPast,
          checkedInAt: isPast ? bookingDate : undefined,
          checkedInBy: isPast ? staffMember._id : undefined,
          method: isPast ? cfg.checkInMethod : undefined,
        },
        createdAt: new Date(bookingDate.getTime() - 86400000 * 14),
        updatedAt: isPast ? bookingDate : new Date(bookingDate.getTime() - 86400000 * 14),
      });

      venueBookingsCount++;

      // Create BookingHistory entry (immutable audit log)
      await BookingHistory.create({
        eventCenter: venue._id,
        ticket: centerBooking._id,
        bookingId: centerBooking._id.toString(),
        bookingType: "PLATFORM",
        bookingUnit: "day",
        action: isPast ? "CHECKED_IN" : cfg.status === "CONFIRMED" ? "ACCEPTED" : "CREATED",
        performedBy: isPast ? staffMember._id : buyer._id,
        dates: [{ date: bookingDate }],
        guestName: `${buyer.firstName} ${buyer.surname}`,
        totalPrice: { amount: totalPrice, currency: "NGN" },
        createdAt: isPast ? bookingDate : centerBooking.createdAt,
      });

      // If Manual check-in, create ManualBookingCheckIn record
      if (isPast && cfg.checkInMethod === "MANUAL") {
        await ManualBookingCheckIn.create({
          _id: centerBooking._id.toString(),
          eventCenter: venue._id,
          bookingId: centerBooking._id.toString(),
          checkedInBy: staffMember._id,
          checkedInAt: bookingDate,
          proofVerified: true,
        });

        // Record StaffActivity for Manual Check-In
        await StaffActivity.create({
          staff: staffMember._id,
          organiser: organiser._id,
          action: "CHECK_IN",
          title: "Manual Venue Booking Check-In",
          description: `Staff verified guest ID and manually checked in ${buyer.firstName} ${buyer.surname} for ${venue.venueName}.`,
          metadata: { bookingId: centerBooking._id, eventCenterId: venue._id },
          createdAt: bookingDate,
        });
      } else if (isPast && cfg.checkInMethod === "QR") {
        // Record StaffActivity for QR Scan
        await StaffActivity.create({
          staff: staffMember._id,
          organiser: organiser._id,
          action: "SCAN",
          title: "QR Ticket Scan for Venue Entrance",
          description: `Staff scanned QR payload for ticket ${ticketNum} at ${venue.venueName}.`,
          metadata: { ticketNumber: ticketNum, bookingId: centerBooking._id, eventCenterId: venue._id },
          createdAt: bookingDate,
        });
      }

      // If Past, create BookingAttendance and VenuePayout
      if (isPast) {
        await BookingAttendance.create({
          _id: `${venue._id}_${centerBooking._id}_session1`,
          eventCenter: venue._id,
          bookingId: centerBooking._id.toString(),
          sessionId: "session1",
          status: "ATTENDED",
          revision: 1,
          audit: [{
            status: "ATTENDED",
            actor: staffMember._id,
            at: bookingDate,
            reason: "Guest arrived on schedule with verified entry confirmation",
            method: cfg.checkInMethod,
            proofVerified: true,
          }],
        });

        await VenuePayout.create({
          booking: centerBooking._id,
          organiser: organiser._id,
          reference: `PO_VEN_${centerBooking._id}`,
          amountMinor: organiserPayout * 100, // minor unit
          currency: "NGN",
          destination: organiser.bankDetails,
          recipientCode: organiser.vendorAccountCode || `SUB_${vi + 1}`,
          status: "SUCCESS",
          createdAt: new Date(bookingDate.getTime() + 86400000),
        });
      }

      // Create booking notification for organiser & buyer
      await Notification.create({
        recipient: organiser._id,
        sender: buyer._id,
        type: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
        category: NOTIFICATION_CATEGORIES.BOOKINGS,
        title: `Booking Confirmed: ${venue.venueName}`,
        message: `${buyer.firstName} ${buyer.surname} booked ${venue.venueName} for ${bookingDate.toLocaleDateString()}. Total: ₦${totalPrice.toLocaleString()}.`,
        channelsDelivered: [
          { channel: "sms", status: "SENT", sentAt: centerBooking.createdAt },
          { channel: "push", status: "SENT", sentAt: centerBooking.createdAt },
          { channel: "email", status: "SENT", sentAt: centerBooking.createdAt },
          { channel: "in_app", status: "SENT", sentAt: centerBooking.createdAt },
        ],
        createdAt: centerBooking.createdAt,
      });
    }
  }
  console.log(` Created ${venueBookingsCount} venue bookings across all lifecycle states.`);

  // 4. Generate 32 Realistic Events Across 1 Full Year
  console.log("\n Generating 32 Events spanning the full year...");
  const createdEvents = [];

  for (let i = 0; i < EVENT_DEFINITIONS.length; i++) {
    const ed = EVENT_DEFINITIONS[i];
    const organiser = primaryOrganisers[i % primaryOrganisers.length];
    const eventCoOrganisers = [coOrganiserPool[i % coOrganiserPool.length]._id];
    const eventStaff = [staffPool[i % staffPool.length]._id, staffPool[(i + 1) % staffPool.length]._id];
    const venue = createdVenues[i % createdVenues.length];

    let scheduleFrom;
    let scheduleTo;
    let status;

    if (ed.isCancelled) {
      scheduleFrom = new Date(Date.now() - ed.daysAgo * 86400000);
      scheduleTo = new Date(scheduleFrom.getTime() + 86400000 * 2);
      status = "CANCELLED";
    } else if (ed.isActiveNow) {
      scheduleFrom = new Date(Date.now() - 86400000);
      scheduleTo = new Date(Date.now() + 86400000 * 2);
      status = "LISTED";
    } else if (ed.isUpcoming) {
      scheduleFrom = new Date(Date.now() + ed.daysFromNow * 86400000);
      scheduleTo = new Date(scheduleFrom.getTime() + 86400000);
      status = "LISTED";
    } else {
      // Completed past event
      scheduleFrom = new Date(Date.now() - ed.daysAgo * 86400000);
      scheduleTo = new Date(scheduleFrom.getTime() + 86400000);
      status = "COMPLETED";
    }

    const eventCreated = new Date(scheduleFrom.getTime() - 86400000 * 45); // Created 45 days before event

    const eventId = new mongoose.Types.ObjectId();
    const event = await Event.create({
      _id: eventId,
      title: ed.title,
      shortDescription: ed.desc,
      description: `${ed.title} is a premier ${ed.type.toLowerCase().replace(/_/g, " ")} experience hosted at ${venue.venueName}. Enjoy top-tier sound, world-class performers, VIP seating, and gourmet hospitality.`,
      images: [
        { publicId: `seed/event_${eventId}_1`, url: IMAGES[i % IMAGES.length], position: 0 },
        { publicId: `seed/event_${eventId}_2`, url: IMAGES[(i + 2) % IMAGES.length], position: 1 },
      ],
      highlights: ["Exclusive VIP access lounge", "Live superstar stage showcases", "Gourmet food & craft drink village"],
      amenities: ["PARKING", "RESTROOMS", "VIP_AREA", "WIFI", "FIRST_AID", "SEATING"],
      performers: [
        PERFORMERS[i % PERFORMERS.length],
        PERFORMERS[(i + 3) % PERFORMERS.length],
      ],
      eventType: ed.type,
      ageRestriction: { minAge: 18 },
      schedule: {
        timeZone: "Africa/Lagos",
        from: scheduleFrom,
        to: scheduleTo,
      },
      location: {
        venueName: venue.venueName,
        addressString: venue.location.addressString,
        street: venue.location.street,
        city: venue.location.city,
        country: venue.location.country,
        coordinates: venue.location.coordinates,
      },
      status: status,
      lifecycle: ed.isCancelled ? {
        cancellationMessage: ed.cancelReason,
        cancelledAt: new Date(scheduleFrom.getTime() - 86400000 * 3),
        cancelledBy: organiser._id,
      } : undefined,
      createdBy: organiser._id,
      coOrganisers: eventCoOrganisers,
      staff: eventStaff,
      performance: {
        views: 2500 + i * 200,
        clicks: 800 + i * 60,
        wishlists: 140 + i * 20,
        ticketSales: status === "CANCELLED" ? 15 : 45 + (i * 3),
        revenue: (45 + (i * 3)) * 15000,
      },
      createdAt: eventCreated,
      updatedAt: status === "CANCELLED" ? new Date(scheduleFrom.getTime() - 86400000 * 3) : scheduleTo,
    });

    createdEvents.push({ event, config: ed, scheduleFrom, scheduleTo, isCancelled: ed.isCancelled, isPast: status === "COMPLETED" });

    // Co-Organiser invitation
    await CoOrganiserInvitation.create({
      host: organiser._id,
      coOrganiserEmail: coOrganiserPool[i % coOrganiserPool.length].email,
      coOrganiser: coOrganiserPool[i % coOrganiserPool.length]._id,
      listings: [{ listingId: event._id, listingType: "Event" }],
      permissions: ["ALL_ACCESS", "MANAGE_LISTING", "MANAGE_TICKETS", "VIEW_FINANCES"],
      status: "ACCEPTED",
      respondedAt: new Date(eventCreated.getTime() + 86400000 * 2),
      createdAt: eventCreated,
    });

    // Staff invitation
    await StaffInvitation.create({
      organiser: organiser._id,
      staffEmail: staffPool[i % staffPool.length].email,
      staff: staffPool[i % staffPool.length]._id,
      listings: [{ listingId: event._id, listingType: "Event" }],
      permissions: ["ALL_ACCESS", "SCAN_TICKET", "CUSTOMER_CARE"],
      status: "ACCEPTED",
      respondedAt: new Date(eventCreated.getTime() + 86400000 * 3),
      createdAt: eventCreated,
    });
  }
  console.log(` Created ${createdEvents.length} events spanning past, active, upcoming, and cancelled.`);

  // 5. Create Ticket Types & Bookings & User Event Tickets
  console.log("\n Generating Event Ticket Tiers, Bookings, QR Tickets, and Scans...");
  let totalBookingsCreated = 0;
  let totalTicketsCreated = 0;
  let totalTransfersCreated = 0;
  let totalRefundsCreated = 0;

  for (let ei = 0; ei < createdEvents.length; ei++) {
    const { event, scheduleFrom, isCancelled, isPast } = createdEvents[ei];
    const organiser = primaryOrganisers[ei % primaryOrganisers.length];
    const staffMember = staffPool[ei % staffPool.length];

    // Create 3 Ticket Types per event: Regular, VIP, Early Bird
    const ticketTypesData = [
      { name: "Early Bird", priceNaira: 10000, totalQty: 100 },
      { name: "Regular Access", priceNaira: 15000, totalQty: 250 },
      { name: "VIP Experience", priceNaira: 35000, totalQty: 50 },
    ];

    const createdTicketTypes = [];
    for (const tt of ticketTypesData) {
      const salesStart = new Date(event.createdAt);
      const salesEnd = new Date(scheduleFrom.getTime() - 3600000);

      const ticketDoc = await Ticket.create({
        eventId: event._id,
        name: tt.name,
        description: `Admission tier: ${tt.name} for ${event.title}.`,
        ticketType: "PAID",
        totalQuantity: tt.totalQty,
        soldQuantity: isCancelled ? 5 : isPast ? 35 : 12,
        salesStartAt: salesStart,
        salesEndAt: salesEnd,
        currency: { code: "NGN", symbol: "₦" },
        commission: { percentage: 10, type: "ADD_ON" },
        price: { amountCents: tt.priceNaira * 100 },
      });
      createdTicketTypes.push(ticketDoc);
    }

    // Generate 4 Bookings per event (with 1-2 tickets per booking)
    const bookingsForEvent = isCancelled ? 2 : isPast ? 5 : 2;

    for (let bi = 0; bi < bookingsForEvent; bi++) {
      const buyer = buyerPool[(ei * 11 + bi * 19) % buyerPool.length];
      const selectedTT = createdTicketTypes[bi % createdTicketTypes.length];
      const qty = (bi % 2) + 1;
      const pricePerUnit = selectedTT.price.amountCents;
      const subtotalCents = pricePerUnit * qty;
      const platformFeeCents = Math.round(subtotalCents * 0.1);
      const totalAmountCents = subtotalCents + platformFeeCents;
      const bookingCreated = new Date(scheduleFrom.getTime() - (30 - bi * 5) * 86400000);

      const bookingStatus = isCancelled ? "CANCELLED" : "ACTIVE";
      const paymentStatus = isCancelled ? "REFUNDED" : "COMPLETED";

      const booking = await EventBooking.create({
        eventId: event._id,
        buyer: buyer._id,
        guestDetails: {
          fullName: `${buyer.firstName} ${buyer.surname}`,
          phoneNumber: buyer.phoneNumber,
          email: buyer.email,
        },
        items: [
          {
            ticketId: selectedTT._id,
            name: selectedTT.name,
            quantity: qty,
            pricePerUnit: pricePerUnit,
            totalPrice: subtotalCents,
            subtotalAmount: subtotalCents,
            feeMode: "PASS_TO_BUYER",
            feeAmount: platformFeeCents,
            buyerFeeAmount: platformFeeCents,
            organiserFeeAmount: 0,
          },
        ],
        subtotalAmount: subtotalCents,
        platformFeeAmount: platformFeeCents,
        buyerFeeAmount: platformFeeCents,
        organiserFeeAmount: 0,
        organiserPayoutAmount: subtotalCents,
        feePercentage: 10,
        feeMode: "PASS_TO_BUYER",
        totalAmount: totalAmountCents,
        currency: "NGN",
        paymentStatus: paymentStatus,
        paymentMethod: bi % 2 === 0 ? "CARD" : "TRANSFER",
        paymentReference: `PAY_EVT_${event._id}_${bi}_${Date.now() % 10000}`,
        status: bookingStatus,
        createdAt: bookingCreated,
        updatedAt: bookingCreated,
      });

      totalBookingsCreated++;

      // Issue individual UserEventTickets
      for (let qi = 0; qi < qty; qi++) {
        const ticketNum = generateTicketNumber("MNB");
        const qrPayload = generateQRPayload(ticketNum, event._id, "EVENT");
        const ticketStatus = isCancelled ? "CANCELLED" : isPast ? "REDEEMED" : "UNREDEEMED";
        const checkInMethod = qi % 2 === 0 ? "QR" : "MANUAL";
        const checkInTime = new Date(scheduleFrom.getTime() + 3600000 * 2 + qi * 900000);

        const userTicket = await UserEventTicket.create({
          bookingId: booking._id,
          eventId: event._id,
          ticketTypeId: selectedTT._id,
          owner: buyer._id,
          ticketName: selectedTT.name,
          ticketNumber: ticketNum,
          qrPayload: qrPayload,
          status: ticketStatus,
          invalidatedReason: isCancelled ? "EVENT_CANCELLED" : null,
          invalidatedAt: isCancelled ? new Date(scheduleFrom.getTime() - 86400000 * 3) : undefined,
          redeemedAt: isPast ? checkInTime : undefined,
          redeemedBy: isPast ? staffMember._id : undefined,
          checkIn: {
            isCheckedIn: isPast,
            checkedInAt: isPast ? checkInTime : undefined,
            checkedInBy: isPast ? staffMember._id : undefined,
            method: isPast ? checkInMethod : undefined,
          },
          eventSnapshot: {
            title: event.title,
            shortDescription: event.shortDescription,
            coverImage: IMAGES[ei % IMAGES.length],
            eventType: event.eventType,
            organiser: {
              name: `${organiser.firstName} ${organiser.surname}`,
              email: organiser.email,
              phoneNumber: organiser.phoneNumber,
            },
            location: {
              addressString: event.location.addressString,
              city: event.location.city,
              country: event.location.country,
              coordinates: event.location.coordinates,
            },
            schedule: {
              startDate: scheduleFrom,
              endDate: event.schedule.to,
            },
          },
          ticketSnapshot: {
            name: selectedTT.name,
            ticketType: "PAID",
            price: { amount: selectedTT.price.amountCents / 100, currency: "NGN", symbol: "₦" },
          },
          createdAt: bookingCreated,
          updatedAt: isPast ? checkInTime : bookingCreated,
        });

        totalTicketsCreated++;

        // If ticket was scanned/checked in, create StaffActivity audit log
        if (isPast) {
          await StaffActivity.create({
            staff: staffMember._id,
            organiser: organiser._id,
            action: checkInMethod === "QR" ? "SCAN" : "CHECK_IN",
            title: `${checkInMethod} Entry Gate Ticket Validation`,
            description: `Staff checked in ticket ${ticketNum} (${selectedTT.name}) for ${buyer.firstName} ${buyer.surname}.`,
            metadata: { ticketNumber: ticketNum, ticketId: userTicket._id, eventId: event._id },
            createdAt: checkInTime,
          });
        }

        // Seed Ticket Transfer Requests (for a curated subset of active/completed tickets)
        if (totalTransfersCreated < 12 && !isCancelled && qi === 0) {
          const recipient = buyerPool[(ei * 13 + 7) % buyerPool.length];
          const isAccepted = totalTransfersCreated < 8;

          await TicketTransferRequest.create({
            sender: buyer._id,
            recipient: recipient._id,
            ticketId: userTicket._id,
            ticketCategory: "USER_EVENT",
            status: isAccepted ? "ACCEPTED" : "PENDING",
            createdAt: new Date(bookingCreated.getTime() + 86400000 * 3),
          });

          if (isAccepted) {
            // Update ticket's transfer history
            userTicket.transferHistory.push({
              fromUser: buyer._id,
              toUser: recipient._id,
              transferredAt: new Date(bookingCreated.getTime() + 86400000 * 3),
              previousTicketNumber: ticketNum,
            });
            await userTicket.save();
          }

          totalTransfersCreated++;
        }
      }

      // If Event was cancelled, create EventRefund direct obligation records
      if (isCancelled) {
        const refundStatuses = ["CONFIRMED_BY_BUYER", "MARKED_PAID", "DUE_FROM_ORGANISER"];
        const refundStatus = refundStatuses[bi % refundStatuses.length];

        await EventRefund.create({
          eventId: event._id,
          bookingId: booking._id,
          buyer: buyer._id,
          organiser: organiser._id,
          amountMinor: totalAmountCents,
          currency: "NGN",
          bankDetails: buyer.bankDetails || {
            accountName: `${buyer.firstName} ${buyer.surname}`,
            accountNumber: "0123456789",
            bankName: "Guaranty Trust Bank",
            bankCode: "058",
          },
          status: refundStatus,
          dueAt: new Date(scheduleFrom.getTime() + 86400000 * 7),
          markedPaidAt: refundStatus === "CONFIRMED_BY_BUYER" || refundStatus === "MARKED_PAID" ? new Date(scheduleFrom.getTime() + 86400000 * 2) : undefined,
          confirmedAt: refundStatus === "CONFIRMED_BY_BUYER" ? new Date(scheduleFrom.getTime() + 86400000 * 3) : undefined,
        });

        totalRefundsCreated++;
      }

      // Notification for ticket purchase (with SMS, Push, Email channels)
      await Notification.create({
        recipient: buyer._id,
        sender: organiser._id,
        type: NOTIFICATION_TYPES.TICKET_PURCHASED,
        category: NOTIFICATION_CATEGORIES.TICKETS,
        title: `Tickets Confirmed: ${event.title}`,
        message: `Your booking for ${qty}x ${selectedTT.name} ticket(s) to ${event.title} is confirmed. Show QR at entrance.`,
        channelsDelivered: [
          { channel: "sms", status: "SENT", sentAt: bookingCreated },
          { channel: "push", status: "SENT", sentAt: bookingCreated },
          { channel: "email", status: "SENT", sentAt: bookingCreated },
          { channel: "in_app", status: "SENT", sentAt: bookingCreated },
        ],
        createdAt: bookingCreated,
      });
    }
  }

  console.log(` Created ${totalBookingsCreated} event ticket bookings.`);
  console.log(` Created ${totalTicketsCreated} individual QR tickets with full check-in scans.`);
  console.log(` Created ${totalTransfersCreated} ticket transfer audit records.`);
  console.log(` Created ${totalRefundsCreated} event refund lifecycle obligations.`);

  // Summary counts
  const totalVenuesCount = await EventCenter.countDocuments();
  const totalEventsCount = await Event.countDocuments();
  const totalTicketTypesCount = await Ticket.countDocuments();
  const totalBookingsCount = await EventBooking.countDocuments();
  const totalUserTicketsCount = await UserEventTicket.countDocuments();
  const checkedInTicketsCount = await UserEventTicket.countDocuments({ "checkIn.isCheckedIn": true });
  const venueBookingsTotal = await EventCenterBooking.countDocuments();
  const notificationsTotal = await Notification.countDocuments();
  const staffActivitiesTotal = await StaffActivity.countDocuments();
  const refundsTotal = await EventRefund.countDocuments();

  console.log("\n==================================================");
  console.log(" 1-YEAR PLATFORM SEEDING COMPLETE SUMMARY:");
  console.log("==================================================");
  console.log(` Event Centers (Venues):            ${totalVenuesCount}`);
  console.log(` Events (Spanning 1 Full Year):     ${totalEventsCount}`);
  console.log(` Ticket Tiers:                      ${totalTicketTypesCount}`);
  console.log(` Event Ticket Bookings:             ${totalBookingsCount}`);
  console.log(` Total QR Tickets Issued:           ${totalUserTicketsCount}`);
  console.log(` Successfully Scanned / Checked In: ${checkedInTicketsCount}`);
  console.log(` Venue Bookings:                    ${venueBookingsTotal}`);
  console.log(` Staff Audit Log Activities:        ${staffActivitiesTotal}`);
  console.log(` Ticket Refund Records:             ${refundsTotal}`);
  console.log(` Notifications Delivered (SMS/Push): ${notificationsTotal}`);
  console.log("==================================================\n");

  await mongoose.disconnect();
  console.log(" Database disconnected safely.");
}

seedOneYearActivity().catch((err) => {
  console.error(" Failed seeding activity history:", err);
  process.exit(1);
});
