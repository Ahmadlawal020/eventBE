/**
 * Seed 100 Rich Events for Existing User (Ahmad Lawal) spanning 5 Years (2021 - 2026)
 * Completing all lifecycles: Events, Ticket Types, Bookings, User Tickets, Check-ins (QR & Manual),
 * Staff Assignments, Staff Activities, Invitations, and Notifications.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { generateTicketNumber, generateQRPayload } = require("../utils/qr");

// Models
const User = require("../models/client/user.schema");
const Event = require("../models/client/event.schema");
const Ticket = require("../models/client/eventTicketType.schema");
const EventBooking = require("../models/client/eventBooking.schema");
const UserEventTicket = require("../models/client/userEventTicket.schema");
const StaffActivity = require("../models/client/staffActivity.schema");
const StaffInvitation = require("../models/client/staffInvitation.schema");
const CoOrganiserInvitation = require("../models/client/coOrganiserInvitation.schema");
const Notification = require("../models/client/notification.schema");

// Curated Nigerian / Global Cities & Venues
const VENUE_TEMPLATES = [
  { city: "Lagos", address: "Victoria Island, Lagos", street: "Plot 1415 Adetokunbo Ademola St", lat: 6.4281, lng: 3.4219 },
  { city: "Lagos", address: "Landmark Centre, Water Corporation Drive, Victoria Island", street: "Water Corporation Drive", lat: 6.4253, lng: 3.4442 },
  { city: "Lagos", address: "Eko Hotels & Suites, Plot 1415 Adetokunbo Ademola, VI", street: "Adetokunbo Ademola", lat: 6.4278, lng: 3.4320 },
  { city: "Lagos", address: "Balmoral Convention Centre, Federal Palace Hotel, VI", street: "Ahmadu Bello Way", lat: 6.4350, lng: 3.4150 },
  { city: "Lagos", address: "The Good Beach, Sinari Daranijo St, Victoria Island", street: "Sinari Daranijo", lat: 6.4312, lng: 3.4398 },
  { city: "Lagos", address: "Harbour Point, 4 Wilmot Point Rd, Victoria Island", street: "Wilmot Point Rd", lat: 6.4360, lng: 3.4280 },
  { city: "Abuja", address: "International Conference Centre, Central Business District", street: "Herbert Macaulay Way", lat: 9.0579, lng: 7.4951 },
  { city: "Abuja", address: "Transcorp Hilton Congress Hall, 1 Aguiyi Ironsi St, Maitama", street: "Aguiyi Ironsi St", lat: 9.0765, lng: 7.4934 },
  { city: "Abuja", address: "Baze University Multipurpose Hall, Jabi, Abuja", street: "Plot 686 Jabi Airport Road Bypass", lat: 9.0322, lng: 7.4110 },
  { city: "Abuja", address: "The Dome, Plot 423 Adekunle Fajuyi Way, Central Area", street: "Adekunle Fajuyi Way", lat: 9.0620, lng: 7.4890 },
  { city: "Kano", address: "Tahir Guest Palace Convention Hall, 4 Bank Rd, Nasarawa GRA", street: "Bank Rd", lat: 12.0022, lng: 8.5920 },
  { city: "Kano", address: "Ado Bayero Mall Event Pavilion, Zoo Road, Kano", street: "Zoo Road", lat: 11.9689, lng: 8.5298 },
  { city: "Kano", address: "Royal Tropicana Grand Arena, Niger Street, Kano", street: "Niger Street", lat: 12.0001, lng: 8.5150 },
  { city: "Kano", address: "Bristol Palace Grand Ballroom, 54/56 Guda Abdullahi Rd, Farm Centre", street: "Guda Abdullahi Rd", lat: 11.9790, lng: 8.5520 },
  { city: "Kaduna", address: "Kaduna International Trade Fair Complex, KM 4 Zaria Road", street: "Zaria Road", lat: 10.5500, lng: 7.4500 },
  { city: "Ibadan", address: "Jogor Centre, 1 Harvester Drive, Liberty Stadium Rd, Ibadan", street: "Liberty Stadium Rd", lat: 7.3556, lng: 3.8722 },
  { city: "Port Harcourt", address: "Aztech Arcum Event Centre, Stadium Road, Port Harcourt", street: "Stadium Road", lat: 4.8242, lng: 7.0090 }
];

// Rich Curated Cloudinary Image Assets from existing DB pool
const IMAGE_POOL = [
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
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782722108/ilkuzzsqiut7z6sbpimi.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782722109/jashlfkbftjeh01rzhyo.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782722111/nna0wrefzdhfaxjrhnro.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782721982/bt4jz3vncof8lalcsrey.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782721984/idcplq4gu5yqcfhateju.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782721986/uhkjea8cj375ttbp9ge2.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782722361/fi7r7ekiurkin9rx9bim.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782722363/mnp72vcraant0ezvvn54.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782722365/t9tiig1allkf1hjyvuv2.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782722242/mowpclpro7wnj0vpynj6.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782722244/c8isv2xi33atzgnyqphl.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782722246/nuwtv09rryeh7yrckxma.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782722576/zdv2rwhjvo316ptpqb2p.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782722577/vwxyiekgykypmtygnezf.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782722498/pqyrupb2nix7mmojhfoy.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782722500/w76xjc6h8lzjad4c9did.jpg",
  "https://res.cloudinary.com/djpyy3s9u/image/upload/v1782722501/hycuextj036gdha9aiyj.jpg"
];

// Performers pool
const PERFORMERS_POOL = [
  { name: "Burna Boy Live Band", role: "Headliner", bio: "Grammy-winning African giant performing global hits." },
  { name: "Wizkid Sound System", role: "Special Guest", bio: "International Afrobeats sensation." },
  { name: "Davido & The Compozers", role: "Co-Headliner", bio: "Energetic hitmaker bringing timeless festival energy." },
  { name: "Asake & Orchestra", role: "Performer", bio: "Fuji-infused fusion and modern street anthems." },
  { name: "Tiwa Savage", role: "Guest Artiste", bio: "The Queen of Afrobeats delivering melodic grace." },
  { name: "Olamide Baddo", role: "Special Appearance", bio: "Indigenous rap pioneer and music executive." },
  { name: "Simi & The Banjos", role: "Acoustic Set", bio: "Soulful vocalist with intimate acoustic performances." },
  { name: "Dr. Bosun Tijani", role: "Keynote Speaker", bio: "Minister of Communications, Innovation & Digital Economy." },
  { name: "Iyinoluwa Aboyeji", role: "Tech Panelist", bio: "Co-founder of Andela and Flutterwave, venture capitalist." },
  { name: "Chef Fregz", role: "Masterclass Host", bio: "Renowned culinary artist transforming Nigerian gastronomy." },
  { name: "Basketmouth", role: "Master of Ceremonies", bio: "Africa's comedy titan and international entertainer." },
  { name: "Ali Nuhu", role: "Guest Host", bio: "Kannywood legend and cinema director." },
  { name: "Kaffy Dance Troupe", role: "Dance Performers", bio: "World record holder and premier choreographic director." },
  { name: "DJ Spinall", role: "Official DJ", bio: "Top boy delivering curated Afro-house and party tracks." },
  { name: "Maryam Booth", role: "Panel Moderator", bio: "Award-winning actress and cultural ambassador." }
];

// 100 Realistic Event Titles and Categories
const EVENT_DEFINITIONS = [
  // 2021 (Nov - Dec): 8 events
  { title: "Lagos AfroTech Summit 2021", type: "TECHNOLOGY_INNOVATION", desc: "Connecting Africa's brightest tech innovators and venture capital funds." },
  { title: "Eko Music & Arts Carnival 2021", type: "MUSIC_CONCERTS", desc: "Premier coastal celebration of Nigerian musical heritage and live contemporary sound." },
  { title: "Northern Flavors Food Expo 2021", type: "FOOD_DRINK", desc: "A showcase of traditional Hausa and Sahelian culinary delicacies." },
  { title: "Abuja Executive Leadership Dinner", type: "BUSINESS_NETWORKING", desc: "High-level networking banquet for private sector executives and leaders." },
  { title: "Kano Heritage Craft & Fashion Gala", type: "FASHION_BEAUTY", desc: "Celebrating traditional dye pits, handwoven fabrics, and modern Northern couture." },
  { title: "Lekki Beach Sunset Acoustic Session", type: "MUSIC_CONCERTS", desc: "Intimate beachside acoustic performances featuring rising indie voices." },
  { title: "Green Planet Nigeria Charity Ball", type: "CHARITY_FUNDRAISING", desc: "Fundraising gala dedicated to reforestation and solar community lighting." },
  { title: "End of Year Comedy Explosion 2021", type: "COMEDY_ENTERTAINMENT", desc: "Laugh out loud comedy night with the nation's funniest standup comics." },

  // 2022: 20 events
  { title: "Nigeria Fintech Frontier 2022", type: "TECHNOLOGY_INNOVATION", desc: "Disrupting payments, embedded finance, and cross-border remittances." },
  { title: "Durbar Cultural Exhibition 2022", type: "COMMUNITY_LOCAL", desc: "Royal equestrian pageantry, royal trumpets, and historic cultural celebration." },
  { title: "Abuja Tech Founders Breakfast", type: "STARTUPS_ENTREPRENEURSHIP", desc: "Early-stage founders meeting angels, mentors, and corporate partners." },
  { title: "West African Art & Sculpture Biennale", type: "ARTS_CULTURE", desc: "Masterpieces from leading contemporary African painters and sculptors." },
  { title: "Lagos International Marathon Expo", type: "SPORTS_FITNESS", desc: "Health, fitness, and endurance preparation ahead of the national marathon." },
  { title: "Kano Youth Coding Championship", type: "EDUCATION_LEARNING", desc: "High-energy hackathon empowering students in algorithmic problem solving." },
  { title: "Afrobeats Summer Jam 2022", type: "MUSIC_CONCERTS", desc: "The biggest outdoor concert celebrating summertime chart toppers." },
  { title: "Suya & Grills Weekend Festival", type: "FOOD_DRINK", desc: "Nigeria's finest pitmasters, smoky spiced meats, and refreshing craft cocktails." },
  { title: "Women in Enterprise Conference", type: "CONFERENCES_SEMINARS", desc: "Empowering female-led enterprises with funding and scaling toolkits." },
  { title: "Kaduna Creative Economy Forum", type: "BUSINESS_NETWORKING", desc: "Unlocking opportunities in digital media, game dev, and animation." },
  { title: "Sahel Literary & Poetry Fest", type: "LITERATURE_BOOKS", desc: "Book signings, spoken word open mics, and thought-provoking panel discussions." },
  { title: "Lagos Streetwear & Sneaker Con 2022", type: "FASHION_BEAUTY", desc: "Urban youth culture, custom kicks, thrift pop-ups, and indie streetwear labels." },
  { title: "Naija Gaming & Esports Open", type: "GAMING_ESPORTS", desc: "Competitive FIFA, Street Fighter, and Call of Duty tournament with cash prizes." },
  { title: "Clean Energy Transition Forum", type: "SCIENCE_ENGINEERING", desc: "Decarbonizing industrial energy with off-grid solar and micro-grids." },
  { title: "Abuja International Film Screening", type: "FILM_MEDIA", desc: "Nollywood premieres and African documentary showcases under the stars." },
  { title: "Hope Foundation Health & Vision Gala", type: "CHARITY_FUNDRAISING", desc: "Delivering free eye surgeries and medical kits to rural communities." },
  { title: "Zenith Real Estate & Property Fair", type: "CONFERENCES_SEMINARS", desc: "Investment opportunities in smart homes and commercial architecture." },
  { title: "Northern Nigerian Photography Masterclass", type: "WORKSHOPS_TRAINING", desc: "Mastering portraiture, documentary lenswork, and visual storytelling." },
  { title: "Lagos Symphony Orchestra Night", type: "THEATER_PERFORMING_ARTS", desc: "Classical orchestral arrangements of beloved West African compositions." },
  { title: "New Year Eve Grand Countdown 2022", type: "PARTIES_NIGHTLIFE", desc: "Fireworks, superstar DJ sets, and champagne toasts welcoming 2023." },

  // 2023: 20 events
  { title: "Africa Web3 & Blockchain Summit 2023", type: "TECHNOLOGY_INNOVATION", desc: "Crypto infrastructure, decentralized finance, and digital asset custody." },
  { title: "Eko Food & Wine Festival 2023", type: "FOOD_DRINK", desc: "Gastronomic delights, celebrity cooking showdowns, and wine pairings." },
  { title: "Kano Textile & Indigo Dyers Expo", type: "COMMUNITY_LOCAL", desc: "Centuries-old artisanal textile crafts meeting modern fashion houses." },
  { title: "National High School Robotics Derby", type: "SCIENCE_ENGINEERING", desc: "Next-gen young engineers competing with autonomous robotics." },
  { title: "Abuja Jazz in the Garden 2023", type: "MUSIC_CONCERTS", desc: "Lush botanical gardens, smooth saxophone solos, and craft beverages." },
  { title: "African E-Commerce Growth Summit", type: "BUSINESS_NETWORKING", desc: "Last-mile logistics, social commerce, and cross-border trade." },
  { title: "Lagos International Theatre Festival", type: "THEATER_PERFORMING_ARTS", desc: "Dramatic plays, stage adaptations, and riveting spoken performances." },
  { title: "Nigeria Fitness & Bodybuilding Classic", type: "SPORTS_FITNESS", desc: "Showcasing athleticism, calisthenics, powerlifting, and wellness." },
  { title: "Sahel Health & Wellness Retreat", type: "HEALTH_WELLNESS", desc: "Mindfulness meditation, nutrition workshops, and organic herbal wellness." },
  { title: "Kaduna Peace & Unity Football Derby", type: "SPORTS_FITNESS", desc: "Grassroots sports bringing communities together in joyful rivalry." },
  { title: "Lagos Career Fair & Talent Match", type: "CAREER_JOBS", desc: "Top multinationals and high-growth startups hiring senior talent." },
  { title: "African Fashion Week Lagos 2023", type: "FASHION_BEAUTY", desc: "Catwalk runway presentations by top designers across the continent." },
  { title: "Tech in Agriculture Symposium 2023", type: "CONFERENCES_SEMINARS", desc: "Drone spraying, IoT soil sensors, and precision farming for food security." },
  { title: "Abuja Comedy All-Stars Night", type: "COMEDY_ENTERTAINMENT", desc: "The biggest comedic names delivering non-stop rib-cracking humor." },
  { title: "Naija Indie Rock & Alternative Waves", type: "MUSIC_CONCERTS", desc: "Spotlighting vibrant alternative genres, guitars, and indie bands." },
  { title: "Ibadan Heritage Writers Meet", type: "LITERATURE_BOOKS", desc: "In-depth literary workshops and dialogue with celebrated authors." },
  { title: "Port Harcourt Energy & Oil Forum", type: "CONFERENCES_SEMINARS", desc: "Transitioning upstream oil operations to cleaner downstream energy." },
  { title: "Children & Family Fun Fair 2023", type: "FAMILY_KIDS", desc: "Bouncy castles, face painting, educational science shows, and games." },
  { title: "Afro-Fusion Beats Carnival 2023", type: "FESTIVALS_FAIRS", desc: "Electrifying soundscapes, drum circles, and open-air food stalls." },
  { title: "Munasaba Year-End Organiser Gala 2023", type: "PARTIES_NIGHTLIFE", desc: "Celebrating event creators, venue owners, and community stalwarts." },

  // 2024: 22 events
  { title: "Lagos Artificial Intelligence Summit 2024", type: "TECHNOLOGY_INNOVATION", desc: "LLMs, computer vision, and building homegrown AI models for Africa." },
  { title: "Abuja Gourmet Food Conclave", type: "FOOD_DRINK", desc: "Five-star dining tasting menus presented by internationally trained chefs." },
  { title: "Kano Cultural Heritage Carnival 2024", type: "ARTS_CULTURE", desc: "Historical artifacts, traditional flute melodies, and communal dance." },
  { title: "Eko 10K Sunrise Run 2024", type: "SPORTS_FITNESS", desc: "A scenic morning run across the Lekki-Ikoyi bridge." },
  { title: "West Africa Venture Capital Conclave", type: "STARTUPS_ENTREPRENEURSHIP", desc: "LP and GP summits exploring early-stage valuations and exits." },
  { title: "Naija Gaming Championship Season 3", type: "GAMING_ESPORTS", desc: "Broadcast esports league with live shoutcasting and arena battles." },
  { title: "Afrobeats to the World Concert 2024", type: "MUSIC_CONCERTS", desc: "Stadium concert featuring chart-topping global sensations." },
  { title: "Women in Tech Leadership Forum", type: "CAREER_JOBS", desc: "Executive tracks, mentorship circles, and technical leadership workshops." },
  { title: "Sahelian Solar Power Conference 2024", type: "SCIENCE_ENGINEERING", desc: "Scaling utility-grade solar farms across the northern sunbelt." },
  { title: "Lagos International Book & Art Fair", type: "LITERATURE_BOOKS", desc: "A week of intellectual engagement, publisher showcases, and book signings." },
  { title: "Eko Film & Nollywood Masterclass", type: "FILM_MEDIA", desc: "Cinematography, color grading, and international festival distribution." },
  { title: "Kaduna Tech Innovation Expo 2024", type: "TECHNOLOGY_INNOVATION", desc: "Showcasing Northern Nigeria's booming startup ecosystem." },
  { title: "Abuja Diplomatic Charity Dinner", type: "CHARITY_FUNDRAISING", desc: "Black-tie diplomatic ball supporting primary school nutrition programs." },
  { title: "African Traditional Medicine & Wellness", type: "HEALTH_WELLNESS", desc: "Scientific validation and modern formulation of indigenous botanicals." },
  { title: "Lagos Cocktail & Mixology Week", type: "FOOD_DRINK", desc: "Craft syrups, local fruit blends, and flair bartending competitions." },
  { title: "Northern Nigerian Youth Summit 2024", type: "COMMUNITY_LOCAL", desc: "Youth civic engagement, vocational skills, and entrepreneurship." },
  { title: "Port Harcourt Marine & Logistics Conclave", type: "BUSINESS_NETWORKING", desc: "Optimizing coastal shipping, port automation, and freight clearing." },
  { title: "Ibadan Tech & Startup Mixer", type: "STARTUPS_ENTREPRENEURSHIP", desc: "Connecting developers and designers in Oyo state's growing tech hub." },
  { title: "Abuja Modern Architecture & Urban Design", type: "CONFERENCES_SEMINARS", desc: "Designing sustainable cities with green building materials." },
  { title: "Eko Night Market & Music Lounge", type: "PARTIES_NIGHTLIFE", desc: "Late-night artisan shopping, street snacks, and smooth DJ vibes." },
  { title: "Lagos Street Dance Championship 2024", type: "THEATER_PERFORMING_ARTS", desc: "Afrobeat, popping, and breakdance crews battling for the national crown." },
  { title: "Countdown to 2025 Stadium Festival", type: "MUSIC_CONCERTS", desc: "An unforgettable end-of-year stadium spectacle." },

  // 2025: 18 events
  { title: "African Cloud & CyberSec Summit 2025", type: "TECHNOLOGY_INNOVATION", desc: "Zero-trust architectures, sovereign data clouds, and threat hunting." },
  { title: "Kano International Agro-Allied Expo", type: "CONFERENCES_SEMINARS", desc: "Grain storage, smart irrigation, and mechanized farm equipment." },
  { title: "Eko Rhythm & Jazz Festival 2025", type: "MUSIC_CONCERTS", desc: "Legendary jazz instrumentalists meeting contemporary Afrobeats rhythms." },
  { title: "Abuja Spring Fashion Extravaganza", type: "FASHION_BEAUTY", desc: "Haute couture runway featuring sustainable African textiles." },
  { title: "Lagos Street Food Carnival 2025", type: "FOOD_DRINK", desc: "Celebrating Akara, Puff-puff, Asun, Kilishi, and culinary street culture." },
  { title: "Sahel Health Tech Innovation Forum", type: "HEALTH_WELLNESS", desc: "Telemedicine clinics, AI diagnostics, and rural healthcare delivery." },
  { title: "Naija Esports Pro Invitational 2025", type: "GAMING_ESPORTS", desc: "Elite pro teams facing off in high-stakes esports matches." },
  { title: "West Africa Logistics & Supply Chain Conclave", type: "BUSINESS_NETWORKING", desc: "Solving interstate haulage, cold chain storage, and customs clearing." },
  { title: "Durbar Royal Festival Celebration 2025", type: "COMMUNITY_LOCAL", desc: "Spectacular royal cavalry procession and centuries of vibrant tradition." },
  { title: "Lagos Graphic Design & UX Conf 2025", type: "WORKSHOPS_TRAINING", desc: "Product designers, Figma masters, and brand identity creators." },
  { title: "Children's Creative Science Fair", type: "FAMILY_KIDS", desc: "Interactive physics experiments, volcano models, and telescope stargazing." },
  { title: "Kaduna Peace & Harmony Marathon", type: "SPORTS_FITNESS", desc: "Thousands running together for peace, unity, and healthy lifestyle." },
  { title: "Nollywood Cinema Creators Forum 2025", type: "FILM_MEDIA", desc: "Streaming deals, IP rights, and international co-productions." },
  { title: "Abuja Comedy & Laughter Extravaganza", type: "COMEDY_ENTERTAINMENT", desc: "Top tier satire, standup routines, and musical parodies." },
  { title: "Sahel Writers & Poets Anthology Launch", type: "LITERATURE_BOOKS", desc: "Celebration of new contemporary African novels and poetic voices." },
  { title: "Green Future Clean Energy Gala", type: "CHARITY_FUNDRAISING", desc: "Supporting clean water boreholes and solar mini-grids for schools." },
  { title: "Lagos Nightlife & DJ Showcase 2025", type: "PARTIES_NIGHTLIFE", desc: "High energy electronic Afro-dance beats till the break of dawn." },
  { title: "Munasaba Community Year-End Review", type: "COMMUNITY_LOCAL", desc: "Gathering event organizers and community creators for festive reflection." },

  // 2026: 12 events (8 completed, 1 in-progress, 3 upcoming)
  { title: "Africa FinTech Evolution 2026", type: "TECHNOLOGY_INNOVATION", desc: "Cross-border instant payments, open banking, and regulatory sandboxes." },
  { title: "Abuja Spring Gourmet & Barbecue Fiesta", type: "FOOD_DRINK", desc: "Signature smoked briskets, grilled prawns, and local fruit mocktails." },
  { title: "Lagos Art & Cultural Heritage Biennial 2026", type: "ARTS_CULTURE", desc: "Exhibiting visionary contemporary works and digital canvas art." },
  { title: "Kano Digital Creators Meetup", type: "STARTUPS_ENTREPRENEURSHIP", desc: "YouTubers, podcasters, and software engineers collaborating on new media." },
  { title: "Sahel Marathon & Wellness Walk 2026", type: "SPORTS_FITNESS", desc: "Promoting cardiac wellness, community walking, and fitness awareness." },
  { title: "Eko Music & Sounds Spectacular 2026", type: "MUSIC_CONCERTS", desc: "A stellar celebration of Afrobeats, Highlife, and Fuji fusion." },
  { title: "African AI & Robotics Summit 2026", type: "TECHNOLOGY_INNOVATION", desc: "Humanoid robotics, autonomous vehicles, and industrial edge computing." },
  { title: "Lagos International Comedy Festival 2026", type: "COMEDY_ENTERTAINMENT", desc: "Africa's funniest comedic minds sharing the big stage." },
  
  // 1 IN_PROGRESS (Running Right Now! October 2026)
  { title: "Munasaba Live Tech & Music Festival 2026", type: "FESTIVALS_FAIRS", desc: "The ultimate 3-day hybrid celebration of tech demos, gaming, and superstar concerts.", isCurrent: true },

  // 3 Upcoming (LISTED) in late 2026 / 2027
  { title: "Lagos AfroBeats Grand Carnival 2026", type: "MUSIC_CONCERTS", desc: "Upcoming blockbuster music carnival closing out the magnificent year.", isUpcoming: true, daysFromNow: 21 },
  { title: "Nigeria E-Mobility & Clean Tech Summit 2026", type: "SCIENCE_ENGINEERING", desc: "Electric vehicles, two-wheeler battery swapping, and green transit.", isUpcoming: true, daysFromNow: 45 },
  { title: "New Year Eve 2027 Mega Countdown Celebration", type: "PARTIES_NIGHTLIFE", desc: "The most anticipated New Year countdown party in West Africa.", isUpcoming: true, daysFromNow: 82 }
];

async function seed() {
  console.log("=== STARTING 5-YEAR HISTORICAL SEEDING FOR EXISTING USER ===");
  await mongoose.connect(process.env.DATABASE_URI, { autoIndex: false });
  console.log("Connected to MongoDB:", mongoose.connection.name);

  // 1. Locate existing primary user (Ahmad Lawal)
  const targetEmail = "ahmadlawal020@gmail.com";
  let primaryUser = await User.findOne({ email: targetEmail });
  if (!primaryUser) {
    throw new Error(`Primary user with email ${targetEmail} not found!`);
  }
  console.log(`Found primary user: ${primaryUser.firstName} ${primaryUser.surname} (${primaryUser._id})`);

  // Update primary user to show 5 years of account history (October 2021)
  const fiveYearsAgo = new Date("2021-10-15T09:00:00.000Z");
  await User.updateOne(
    { _id: primaryUser._id },
    {
      $set: {
        createdAt: fiveYearsAgo,
        emailVerifiedAt: new Date("2021-10-15T09:05:00.000Z"),
        isEmailVerified: true,
        isIdentityVerified: true,
        roles: ["user", "organiser"],
      }
    }
  );
  console.log(`Updated ${primaryUser.email} account creation date to 5 years ago: ${fiveYearsAgo.toISOString()}`);

  // 2. Fetch or create a strong cohort of helper users (Co-organisers, staff, attendees, buyers)
  const existingUsers = await User.find({ _id: { $ne: primaryUser._id } }).limit(25).lean();
  let buyerUsers = [...existingUsers];

  // If there are fewer than 15 other users, create some realistic attendee users with historical dates
  if (buyerUsers.length < 15) {
    const passwordHash = await bcrypt.hash("Password123!", 10);
    const extraNames = [
      { firstName: "Chinedu", surname: "Eze", email: "chinedu.eze@example.com" },
      { firstName: "Oluwaseun", surname: "Adeyemi", email: "seun.adeyemi@example.com" },
      { firstName: "Emeka", surname: "Okonkwo", email: "emeka.okonkwo@example.com" },
      { firstName: "Ngozi", surname: "Obi", email: "ngozi.obi@example.com" },
      { firstName: "Tunde", surname: "Bakare", email: "tunde.bakare@example.com" },
      { firstName: "Bilkisu", surname: "Sanusi", email: "bilkisu.sanusi@example.com" },
      { firstName: "Farida", surname: "Bello", email: "farida.bello@example.com" },
      { firstName: "Zaharaddeen", surname: "Umar", email: "zaharaddeen.umar@example.com" },
      { firstName: "Hadiza", surname: "Garba", email: "hadiza.garba@example.com" },
      { firstName: "Kelechi", surname: "Iheanacho", email: "kelechi.iheanacho@example.com" },
    ];

    for (let i = 0; i < extraNames.length; i++) {
      const u = extraNames[i];
      let found = await User.findOne({ email: u.email });
      if (!found) {
        const userCreated = new Date(fiveYearsAgo.getTime() + (i + 1) * 30 * 86400000);
        found = await User.create({
          firstName: u.firstName,
          surname: u.surname,
          email: u.email,
          password: passwordHash,
          roles: ["user"],
          isEmailVerified: true,
          emailVerifiedAt: userCreated,
          createdAt: userCreated,
          updatedAt: userCreated
        });
      }
      buyerUsers.push(found);
    }
  }

  // Select 2 co-organisers and 3 staff users
  const coOrganisers = buyerUsers.slice(0, 2).map(u => u._id);
  const staffMembers = buyerUsers.slice(2, 5).map(u => u._id);
  const attendees = buyerUsers.slice(5);

  console.log(`Using ${coOrganisers.length} co-organisers, ${staffMembers.length} staff, and ${attendees.length} attendees for full cycle simulations.`);

  // 3. Establish Timeline for 100 Events across 5 Years
  // Starting Nov 2021 up to Oct 2026 (current time), and upcoming events in late 2026/early 2027.
  const now = new Date();
  const startTime = new Date("2021-11-01T10:00:00.000Z").getTime();
  const endTime = now.getTime() - (3 * 86400000); // 3 days ago for past events
  const totalSpan = endTime - startTime;

  const pastEventsCount = EVENT_DEFINITIONS.filter(e => !e.isCurrent && !e.isUpcoming).length; // 96
  const stepMs = Math.floor(totalSpan / pastEventsCount);

  let pastIndex = 0;
  const eventsToInsert = [];
  const ticketsToInsert = [];
  const bookingsToInsert = [];
  const userTicketsToInsert = [];
  const staffActivitiesToInsert = [];
  const notificationsToInsert = [];

  const nigeriaLocationId = new mongoose.Types.ObjectId("6abe3f9f82ea79dd24e39f0e");

  console.log(`Preparing data generation for ${EVENT_DEFINITIONS.length} events...`);

  for (let i = 0; i < EVENT_DEFINITIONS.length; i++) {
    const def = EVENT_DEFINITIONS[i];
    const eventId = new mongoose.Types.ObjectId();

    // Determine event timing
    let eventFrom, eventTo, eventCreatedAt, status;

    if (def.isCurrent) {
      // IN_PROGRESS: started yesterday, ends tomorrow
      eventFrom = new Date(now.getTime() - 86400000);
      eventTo = new Date(now.getTime() + (2 * 86400000));
      eventCreatedAt = new Date(now.getTime() - (21 * 86400000));
      status = "IN_PROGRESS";
    } else if (def.isUpcoming) {
      // UPCOMING / LISTED: future date
      const days = def.daysFromNow || (30 * (i - 96));
      eventFrom = new Date(now.getTime() + (days * 86400000));
      eventTo = new Date(eventFrom.getTime() + (8 * 3600000)); // 8 hours duration
      eventCreatedAt = new Date(now.getTime() - (7 * 86400000));
      status = "LISTED";
    } else {
      // PAST / COMPLETED
      const eventTime = startTime + (pastIndex * stepMs) + (Math.floor(Math.random() * 3) * 86400000);
      eventFrom = new Date(eventTime);
      eventTo = new Date(eventTime + (6 * 3600000) + (Math.floor(Math.random() * 12) * 3600000)); // 6-18 hours duration
      eventCreatedAt = new Date(eventFrom.getTime() - (25 * 86400000) - Math.floor(Math.random() * 15 * 86400000)); // announced 25-40 days prior
      status = "COMPLETED";

      // 1 CANCELLED event for realistic complete lifecycle coverage
      if (i === 42) {
        status = "CANCELLED";
      }
      pastIndex++;
    }

    // Venue & location
    const venue = VENUE_TEMPLATES[i % VENUE_TEMPLATES.length];

    // Images (3 images per event)
    const img1 = IMAGE_POOL[(i * 3) % IMAGE_POOL.length];
    const img2 = IMAGE_POOL[(i * 3 + 1) % IMAGE_POOL.length];
    const img3 = IMAGE_POOL[(i * 3 + 2) % IMAGE_POOL.length];
    const images = [
      { url: img1, publicId: `img_${eventId}_1`, position: 0 },
      { url: img2, publicId: `img_${eventId}_2`, position: 1 },
      { url: img3, publicId: `img_${eventId}_3`, position: 2 }
    ];

    // Performers (2 performers per event)
    const perf1 = PERFORMERS_POOL[(i * 2) % PERFORMERS_POOL.length];
    const perf2 = PERFORMERS_POOL[(i * 2 + 1) % PERFORMERS_POOL.length];
    const performers = [
      {
        name: perf1.name,
        role: perf1.role,
        bio: perf1.bio,
        image: img2,
        socialLinks: [
          { platform: "instagram", url: `https://instagram.com/${perf1.name.toLowerCase().replace(/[^a-z]/g, "")}` },
          { platform: "twitter", url: `https://x.com/${perf1.name.toLowerCase().replace(/[^a-z]/g, "")}` }
        ]
      },
      {
        name: perf2.name,
        role: perf2.role,
        bio: perf2.bio,
        image: img3,
        socialLinks: [
          { platform: "instagram", url: `https://instagram.com/${perf2.name.toLowerCase().replace(/[^a-z]/g, "")}` }
        ]
      }
    ];

    // Performance metrics based on status
    const isFinished = status === "COMPLETED";
    const multiplier = 1 + (i % 5);
    const views = isFinished ? 2500 * multiplier + Math.floor(Math.random() * 1200) : 320 * multiplier;
    const clicks = Math.floor(views * 0.45);
    const shares = Math.floor(views * 0.08);
    const wishlists = Math.floor(views * 0.05);

    // Build Event document
    const eventDoc = {
      _id: eventId,
      title: def.title.slice(0, 50),
      shortDescription: def.desc.slice(0, 500),
      description: (def.desc + " Join us for an unforgettable experience with world-class hospitality, networking, and entertainment.").slice(0, 250),
      eventType: def.type,
      schedule: {
        from: eventFrom,
        to: eventTo,
        timeZone: "Africa/Lagos"
      },
      location: {
        addressString: `${venue.address}, ${venue.city}, Nigeria`,
        street: venue.street,
        flat: "",
        city: venue.city,
        area: venue.city,
        country: "Nigeria",
        postcode: "100001",
        isSpecificLocation: true,
        coordinates: {
          latitude: venue.lat,
          longitude: venue.lng
        }
      },
      managementLocation: nigeriaLocationId,
      images,
      highlights: ["Live Performance", "VIP Hospitality", "Fast Check-In", "Curated Network"],
      amenities: ["FOOD_STALLS", "BAR_DRINKS", "PARKING", "RESTROOMS", "FIRST_AID", "VIP_AREA", "WIFI", "ACCESSIBILITY"],
      performers,
      safety: ["FIRE_EXTINGUISHER", "EMERGENCY_EXIT", "CCTV", "FIRST_AID_KIT", "SECURITY_STATION"],
      safetyConsiderations: ["CROWD_MANAGEMENT", "FIRE_SAFETY_COMPLIANCE", "MEDICAL_SUPPORT"],
      entry: {
        ticketRequired: true,
        onSiteTickets: false,
        idRequired: true
      },
      ticketGuide: {
        refundPolicy: status === "CANCELLED" ? "Full refund processed automatically to all ticket holders." : "Standard 48-hour refundable policy before event kick-off.",
        includeFees: true
      },
      arrivalGuide: {
        notes: "Please arrive 45 minutes prior to scheduled start time for hassle-free accreditation.",
        parking: "Secured on-site multi-level parking available for all ticket holders.",
        checkInInstructions: "Present your digital or printed QR code at the designated scanner gate."
      },
      capacity: 500 + (multiplier * 250),
      status,
      lifecycle: status === "CANCELLED" ? {
        cancellationMessage: "Rescheduled due to venue renovation works. All buyers have been refunded.",
        cancelledAt: new Date(eventFrom.getTime() - (5 * 86400000)),
        cancelledBy: primaryUser._id
      } : {},
      saleVersion: 1,
      createdBy: primaryUser._id,
      coOrganisers: [coOrganisers[i % coOrganisers.length]],
      staff: staffMembers,
      performance: {
        views,
        clicks,
        wishlists,
        reach: views * 2,
        engagement: clicks + shares,
        messages: 5 * multiplier,
        pendingInquiries: 0,
        responseRate: 98,
        shares,
        ticketSales: 0, // will increment below
        revenue: 0      // will increment below
      },
      moderation: {
        status: "APPROVED",
        reviewedAt: eventCreatedAt,
        reviewedBy: primaryUser._id
      },
      createdAt: eventCreatedAt,
      updatedAt: isFinished ? eventTo : now
    };

    // 4. Create 3 Ticket Tiers for this Event
    // Tier 1: Early Bird / Regular (e.g., 5,000 NGN)
    // Tier 2: VIP Pass (e.g., 25,000 NGN)
    // Tier 3: VVIP Table / Student Community (e.g., 60,000 NGN or Free)
    const tier1Id = new mongoose.Types.ObjectId();
    const tier2Id = new mongoose.Types.ObjectId();
    const tier3Id = new mongoose.Types.ObjectId();

    const tier1PriceCents = 500000; // 5,000 NGN
    const tier2PriceCents = 2500000; // 25,000 NGN
    const tier3PriceCents = (i % 4 === 0) ? 0 : 6000000; // Free community or 60,000 NGN

    const tier1Capacity = 200 + (multiplier * 50);
    const tier2Capacity = 60 + (multiplier * 15);
    const tier3Capacity = 20 + (multiplier * 5);

    // Sales percentages
    const soldRatio = status === "CANCELLED" ? 0.3 : (isFinished ? 0.85 + (Math.random() * 0.12) : 0.45);
    const tier1Sold = Math.floor(tier1Capacity * soldRatio);
    const tier2Sold = Math.floor(tier2Capacity * soldRatio);
    const tier3Sold = Math.floor(tier3Capacity * soldRatio);

    const ticketDocs = [
      {
        _id: tier1Id,
        eventId,
        name: "Regular Access",
        description: "General admission pass with full access to main arena and exhibition.",
        ticketType: "PAID",
        totalQuantity: tier1Capacity,
        soldQuantity: tier1Sold,
        perTransactionLimit: { min: 1, max: 10 },
        salesStartAt: eventCreatedAt,
        salesEndAt: eventFrom,
        currency: { code: "NGN", symbol: "₦" },
        commission: { percentage: 5, type: "DEDUCT_FROM_PRICE" },
        price: { amountCents: tier1PriceCents },
        groupName: "General",
        createdAt: eventCreatedAt,
        updatedAt: isFinished ? eventTo : now
      },
      {
        _id: tier2Id,
        eventId,
        name: "VIP Experience",
        description: "Priority fast-track entry, VIP lounge access, and complimentary refreshments.",
        ticketType: "PAID",
        totalQuantity: tier2Capacity,
        soldQuantity: tier2Sold,
        perTransactionLimit: { min: 1, max: 5 },
        salesStartAt: eventCreatedAt,
        salesEndAt: eventFrom,
        currency: { code: "NGN", symbol: "₦" },
        commission: { percentage: 5, type: "DEDUCT_FROM_PRICE" },
        price: { amountCents: tier2PriceCents },
        groupName: "VIP",
        createdAt: eventCreatedAt,
        updatedAt: isFinished ? eventTo : now
      },
      {
        _id: tier3Id,
        name: tier3PriceCents === 0 ? "Community Pass" : "VVIP Gold Table",
        description: tier3PriceCents === 0 ? "Complimentary sponsored community pass." : "Reserved private table seating with champagne service.",
        ticketType: tier3PriceCents === 0 ? "FREE" : "PAID",
        totalQuantity: tier3Capacity,
        soldQuantity: tier3Sold,
        perTransactionLimit: { min: 1, max: 4 },
        salesStartAt: eventCreatedAt,
        salesEndAt: eventFrom,
        currency: { code: "NGN", symbol: "₦" },
        commission: { percentage: 5, type: "DEDUCT_FROM_PRICE" },
        price: { amountCents: tier3PriceCents },
        groupName: "Premium",
        createdAt: eventCreatedAt,
        updatedAt: isFinished ? eventTo : now
      }
    ];

    ticketsToInsert.push(...ticketDocs);

    // Calculate total event tickets and revenue
    const totalEventSold = tier1Sold + tier2Sold + tier3Sold;
    const totalRevenueCents = (tier1Sold * tier1PriceCents) + (tier2Sold * tier2PriceCents) + (tier3Sold * tier3PriceCents);
    eventDoc.performance.ticketSales = totalEventSold;
    eventDoc.performance.revenue = totalRevenueCents;
    eventsToInsert.push(eventDoc);

    // 5. Generate Concrete Bookings and Issued User Tickets
    // Create 3 to 5 realistic customer orders for this event
    const bookingBuyers = attendees.sort(() => 0.5 - Math.random()).slice(0, 4);

    for (let b = 0; b < bookingBuyers.length; b++) {
      const buyer = bookingBuyers[b];
      const bookingId = new mongoose.Types.ObjectId();
      const bookingTime = new Date(eventCreatedAt.getTime() + (b + 1) * 3 * 86400000);

      // Select tier
      const chosenTier = b === 0 ? ticketDocs[0] : (b === 1 ? ticketDocs[1] : ticketDocs[2]);
      const quantity = 1 + (b % 3);
      const unitPrice = chosenTier.price?.amountCents || 0;
      const subtotalAmount = unitPrice * quantity;
      const platformFee = Math.floor(subtotalAmount * 0.05);
      const organiserPayout = subtotalAmount - platformFee;
      const paymentMethod = unitPrice === 0 ? "FREE" : (b % 2 === 0 ? "CARD" : "PAYSTACK");
      const orderRef = `MNB_ORD_${bookingTime.getTime()}_${crypto.randomBytes(3).toString("hex")}`;

      const bookingStatus = status === "CANCELLED" ? "CANCELLED" : (isFinished ? "COMPLETED" : "ACTIVE");
      const paymentStatus = status === "CANCELLED" ? "REFUNDED" : "COMPLETED";

      const bookingDoc = {
        _id: bookingId,
        eventId,
        buyer: buyer._id,
        guestDetails: {
          fullName: `${buyer.firstName} ${buyer.surname}`,
          phoneNumber: buyer.phoneNumber || "+2348030001122",
          email: buyer.email
        },
        items: [
          {
            ticketId: chosenTier._id,
            name: chosenTier.name,
            quantity,
            pricePerUnit: unitPrice,
            totalPrice: subtotalAmount,
            subtotalAmount,
            feeMode: "ABSORB_BY_ORGANISER",
            feeAmount: platformFee,
            buyerFeeAmount: 0,
            organiserFeeAmount: platformFee
          }
        ],
        subtotalAmount,
        platformFeeAmount: platformFee,
        buyerFeeAmount: 0,
        organiserFeeAmount: platformFee,
        organiserPayoutAmount: organiserPayout,
        feePercentage: 5,
        feeMode: "ABSORB_BY_ORGANISER",
        fixedFeeAmount: 0,
        totalAmount: subtotalAmount,
        currency: "NGN",
        referralQualifiedAt: bookingTime,
        referralPaymentAt: bookingTime,
        paymentStatus,
        paymentMethod,
        paymentReference: orderRef,
        paystackReference: orderRef,
        status: bookingStatus,
        createdAt: bookingTime,
        updatedAt: isFinished ? eventTo : bookingTime
      };

      bookingsToInsert.push(bookingDoc);

      // 6. Generate Individual Tickets with QR Codes & Check-In Cycles
      const assignedStaff = staffMembers[b % staffMembers.length];

      for (let q = 0; q < quantity; q++) {
        const ticketNumber = generateTicketNumber("MNB");
        const qrPayload = generateQRPayload(ticketNumber, eventId, "EVENT");

        let ticketStatus = "UNREDEEMED";
        let isCheckedIn = false;
        let checkedInAt = null;
        let checkInMethod = null;
        let redeemedAt = null;
        let redeemedBy = null;

        if (status === "CANCELLED") {
          ticketStatus = "CANCELLED";
        } else if (isFinished) {
          // 92% of tickets checked in (attended), 8% no-shows
          const attended = (q !== 3);
          if (attended) {
            ticketStatus = "REDEEMED";
            isCheckedIn = true;
            // Checked in on event day between 30 mins before start and 2 hours after start
            checkedInAt = new Date(eventFrom.getTime() + (Math.floor(Math.random() * 90) - 15) * 60000);
            checkInMethod = Math.random() > 0.35 ? "QR" : "MANUAL";
            redeemedAt = checkedInAt;
            redeemedBy = assignedStaff;

            // Log staff scan activity
            staffActivitiesToInsert.push({
              staff: assignedStaff,
              organiser: primaryUser._id,
              action: checkInMethod === "QR" ? "SCAN" : "CHECK_IN",
              title: `Validated ticket ${ticketNumber}`,
              description: `Successfully checked in attendee for ${eventDoc.title}`,
              metadata: { eventId, ticketNumber, buyer: buyer._id },
              createdAt: checkedInAt
            });
          }
        }

        const userTicketDoc = {
          _id: new mongoose.Types.ObjectId(),
          bookingId,
          eventId,
          ticketTypeId: chosenTier._id,
          owner: buyer._id,
          ticketName: chosenTier.name,
          ticketNumber,
          qrPayload,
          status: ticketStatus,
          invalidatedReason: status === "CANCELLED" ? "EVENT_CANCELLED" : null,
          invalidatedAt: status === "CANCELLED" ? eventDoc.lifecycle.cancelledAt : null,
          redeemedAt,
          redeemedBy,
          checkIn: {
            isCheckedIn,
            checkedInAt,
            checkedInBy: isCheckedIn ? assignedStaff : null,
            method: checkInMethod
          },
          eventSnapshot: {
            title: eventDoc.title,
            shortDescription: eventDoc.shortDescription,
            coverImage: img1,
            eventType: eventDoc.eventType,
            organiser: {
              name: `${primaryUser.firstName} ${primaryUser.surname}`,
              email: primaryUser.email,
              phoneNumber: primaryUser.phoneNumber || ""
            },
            location: eventDoc.location,
            schedule: {
              startDate: eventDoc.schedule.from,
              endDate: eventDoc.schedule.to
            },
            arrivalGuide: eventDoc.arrivalGuide
          },
          ticketSnapshot: {
            name: chosenTier.name,
            description: chosenTier.description,
            additionalInstruction: "",
            ticketType: chosenTier.ticketType,
            price: {
              amount: unitPrice / 100,
              currency: "NGN",
              symbol: "₦"
            }
          },
          transferHistory: [],
          createdAt: bookingTime,
          updatedAt: checkedInAt || bookingTime
        };

        userTicketsToInsert.push(userTicketDoc);
      }
    }

    // 7. Staff & Co-Organiser Invitations
    // Every 5th event has an explicit staff invitation record
    if (i % 5 === 0) {
      staffActivitiesToInsert.push({
        staff: staffMembers[0],
        organiser: primaryUser._id,
        action: "TASK_COMPLETE",
        title: `Pre-event checklist completed`,
        description: `Turnstiles and gate scanners initialized for ${eventDoc.title}`,
        metadata: { eventId },
        createdAt: new Date(eventFrom.getTime() - 2 * 3600000)
      });
    }

    // 8. Organiser Notifications across the 5 years
    if (isFinished) {
      notificationsToInsert.push({
        recipient: primaryUser._id,
        type: "EVENT_COMPLETED",
        category: "SYSTEM",
        title: "Event Successfully Concluded",
        message: `Congratulations! ${eventDoc.title} has completed with ${eventDoc.performance.ticketSales} tickets sold.`,
        isRead: true,
        createdAt: eventTo
      });
      notificationsToInsert.push({
        recipient: primaryUser._id,
        type: "TICKET_PURCHASED",
        category: "TICKETS",
        title: "New Tickets Booked",
        message: `High sales velocity recorded for ${eventDoc.title}.`,
        isRead: true,
        createdAt: new Date(eventCreatedAt.getTime() + 5 * 86400000)
      });
    }
  }

  // Invitations
  const sampleEventIds = eventsToInsert.slice(0, 10).map(e => ({ listingId: e._id, listingType: "Event" }));
  const invitationsToInsert = [
    {
      host: primaryUser._id,
      coOrganiserEmail: attendees[0].email,
      coOrganiser: attendees[0]._id,
      listings: sampleEventIds,
      permissions: ["ALL_ACCESS", "MANAGE_LISTING", "MANAGE_TICKETS", "VIEW_FINANCES"],
      status: "ACCEPTED",
      createdAt: fiveYearsAgo,
      updatedAt: fiveYearsAgo
    },
    {
      organiser: primaryUser._id,
      staffEmail: staffMembers[0].email || "staff1@example.com",
      staff: staffMembers[0],
      listings: sampleEventIds,
      permissions: ["SCAN_TICKET", "MANAGE_TICKETS"],
      status: "ACCEPTED",
      createdAt: fiveYearsAgo,
      updatedAt: fiveYearsAgo
    }
  ];

  console.log(`\nInserting documents into MongoDB...`);
  console.log(`- Events: ${eventsToInsert.length}`);
  console.log(`- Ticket Types: ${ticketsToInsert.length}`);
  console.log(`- Bookings: ${bookingsToInsert.length}`);
  console.log(`- User Tickets: ${userTicketsToInsert.length}`);
  console.log(`- Staff Activities: ${staffActivitiesToInsert.length}`);
  console.log(`- Notifications: ${notificationsToInsert.length}`);

  // Bulk Insertions with native collection driver for optimal speed
  await mongoose.connection.collection("events").insertMany(eventsToInsert);
  console.log("✓ Events inserted.");

  await mongoose.connection.collection("tickets").insertMany(ticketsToInsert);
  console.log("✓ Ticket types inserted.");

  await mongoose.connection.collection("eventbookings").insertMany(bookingsToInsert);
  console.log("✓ Event bookings inserted.");

  await mongoose.connection.collection("usereventtickets").insertMany(userTicketsToInsert);
  console.log("✓ User event tickets inserted.");

  if (staffActivitiesToInsert.length > 0) {
    await mongoose.connection.collection("staffactivities").insertMany(staffActivitiesToInsert);
    console.log("✓ Staff activities inserted.");
  }

  if (notificationsToInsert.length > 0) {
    await mongoose.connection.collection("notifications").insertMany(notificationsToInsert);
    console.log("✓ Historical notifications inserted.");
  }

  await mongoose.connection.collection("coorganiserinvitations").insertMany([invitationsToInsert[0]]);
  await mongoose.connection.collection("staffinvitations").insertMany([invitationsToInsert[1]]);
  console.log("✓ Staff and Co-organiser invitations created.");

  // Summary statistics
  const userEventCount = await mongoose.connection.collection("events").countDocuments({ createdBy: primaryUser._id });
  const totalUserTickets = await mongoose.connection.collection("usereventtickets").countDocuments();
  console.log("\n================ SEED SUMMARY ================");
  console.log(`Primary User ID: ${primaryUser._id}`);
  console.log(`Primary User Email: ${primaryUser.email}`);
  console.log(`Total Events Owned by User: ${userEventCount}`);
  console.log(`Total System Event Tickets: ${totalUserTickets}`);
  console.log(`Timeline: Spanned 5 Years (from ${fiveYearsAgo.toDateString()} to ${now.toDateString()})`);
  console.log("==============================================\n");

  await mongoose.disconnect();
  console.log("Done! Disconnected cleanly.");
}

seed().catch(err => {
  console.error("FATAL Seeding Error:", err);
  process.exit(1);
});
