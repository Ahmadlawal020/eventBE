require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const User = require("./models/user/user.schema");
const Event = require("./models/user/event.schema");
const EventCenter = require("./models/user/eventCenter.schema");
const EventTicket = require("./models/user/eventTicket.schema");
const UserEventTicket = require("./models/user/userEventTicket.schema");
const EventBooking = require("./models/user/eventBooking.schema");
const EventCenterTicket = require("./models/user/eventCenterTicket.schema");

const emails = ["b@b.com", "c@c.com", "d@d.com", "e@e.com", "f@f.com"];
const names = ["Ahmad", "Chuka", "Daniel", "Elias", "Femi", "Grace", "Hassan", "Ife", "Joy", "Kunle"];
const surnames = ["Bello", "Chukwu", "Danjuma", "Eze", "Fashola", "Okafor", "Nwachukwu", "Ade", "Lawal", "Musa"];

const SAFETY_OPTIONS = ["FIRE_EXTINGUISHER", "EMERGENCY_EXIT", "CCTV", "FIRST_AID_KIT", "SECURITY_STATION"];
const SAFETY_CONSIDERATIONS = ["FIRE_SAFETY_COMPLIANCE", "EMERGENCY_PLAN", "CROWD_MANAGEMENT", "MEDICAL_SUPPORT"];
const AMENITIES = ["WIFI", "PARKING", "SEATING", "RESTROOMS", "VIP_AREA", "BAR_DRINKS", "FOOD_STALLS"];
const VENUE_RULES = ["NO_SMOKING", "NO_OUTSIDE_FOOD", "SECURITY_REQUIRED", "TIME_RESTRICTION", "CHILD_FRIENDLY"];
const DISCOUNTS = ["MULTI_DAY", "EARLY_BIRD", "OFF_PEAK"];
const SUPPORTED_EVENTS = ["MUSIC_CONCERTS", "PARTIES_NIGHTLIFE", "FESTIVALS_FAIRS", "CONFERENCES_SEMINARS", "FAMILY_KIDS"];

const getRandomSubset = (arr, size) => {
  const shuffled = arr.slice(0).sort(() => 0.5 - Math.random());
  return shuffled.slice(0, size);
};

const generateRandomString = (length) => {
  return Math.random().toString(36).substring(2, 2 + length);
};

const runSeed = async () => {
  try {
    console.log("Connecting to Database...");
    await mongoose.connect(process.env.DATABASE_URI);
    
    console.log("Cleaning up old seed data (this might take a moment)...");
    const existingUsers = await User.find({ email: { $in: emails } });
    const userIds = existingUsers.map(u => u._id);
    
    if (userIds.length > 0) {
      await Event.deleteMany({ createdBy: { $in: userIds } });
      await EventCenter.deleteMany({ createdBy: { $in: userIds } });
      await EventTicket.deleteMany({});
      await UserEventTicket.deleteMany({}); 
      await EventBooking.deleteMany({}); 
      await EventCenterTicket.deleteMany({});
      await User.deleteMany({ _id: { $in: userIds } });
    }

    const hashedPassword = await bcrypt.hash("12345678", 10);
    const users = [];
    
    console.log("Creating Rich Organiser accounts...");
    for (let i = 0; i < emails.length; i++) {
      const user = await User.create({
        firstName: names[i],
        surname: surnames[i],
        email: emails[i],
        password: hashedPassword,
        authProvider: "local",
        dob: new Date("1988-06-15"),
        phoneNumber: `+234800000000${i}`,
        roles: ["user", "organiser"],
        isActive: true,
        isEmailVerified: true,
        isPhoneVerified: true,
        isIdentityVerified: true,
        residentialAddress: {
          country: "Nigeria",
          street: `${10 + i} Ahmadu Bello Way`,
          city: "Victoria Island",
          county: "Lagos",
          postalCode: "101241"
        },
        emergencyContact: {
          name: `Emergency ${names[i]}`,
          relationship: "Sibling",
          email: `emergency_${emails[i]}`,
          phoneNumber: `+234900000000${i}`
        },
        bankDetails: {
          accountName: `${names[i]} ${surnames[i]}`,
          accountNumber: `001122334${i}`,
          bankName: "Guaranty Trust Bank",
          bankCode: "058"
        }
      });
      users.push(user);
    }

    const getRandomDate = (start, end) => new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));

    let bookingsToInsert = [];
    let userTicketsToInsert = [];
    let centerTicketsToInsert = [];

    console.log("Generating Detailed Events, Centers, and massive Transaction pipelines...");
    for (const user of users) {
      for (let i = 1; i <= 5; i++) {
        const isPast = i <= 2; 
        const startDate = isPast 
          ? getRandomDate(new Date(Date.now() - 300 * 24 * 60 * 60 * 1000), new Date(Date.now() - 10 * 24 * 60 * 60 * 1000))
          : getRandomDate(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), new Date(Date.now() + 90 * 24 * 60 * 60 * 1000));
        
        const endDate = new Date(startDate.getTime() + 8 * 60 * 60 * 1000); 
        
        const tierSales1 = Math.floor(Math.random() * 200) + 400; 
        const tierSales2 = Math.floor(Math.random() * 150) + 300; 
        const tierSales3 = Math.floor(Math.random() * 50) + 100;  
        const totalTicketsSold = tierSales1 + tierSales2 + tierSales3;
        const totalRevenue = (tierSales1*5000) + (tierSales2*10000) + (tierSales3*50000);

        // CREATE EVENT
        const event = await Event.create({
          title: `${user.firstName}'s Spectacular Fest ${i}`,
          shortDescription: "An unforgettable night filled with incredible music, top-tier networking, and amazing food. Don't miss out!",
          description: `Welcome to our legendary festival! We have partnered with world-renowned artists to bring you a multi-sensory experience. Enjoy immersive art installations, gourmet culinary corners, and a huge celebration of culture and entertainment!`,
          status: isPast ? "UNLISTED" : "LISTED",
          eventType: "MUSIC_CONCERTS",
          createdBy: user._id,
          date: { startDate, endDate, timeZone: "Africa/Lagos" },
          schedule: { from: startDate, to: endDate },
          ageRestriction: { minAge: 18, maxAge: 99 },
          location: {
            addressString: "Eko Atlantic City, Lagos",
            street: "Ahmadu Bello Way",
            city: "Lagos",
            area: "Victoria Island",
            postcode: "101241",
            country: "Nigeria",
            coordinates: { latitude: 6.4253, longitude: 3.4095 }
          },
          entry: { ticketRequired: true, onSiteTickets: false, idRequired: true },
          ticketGuide: {
            description: "Please have your QR code ready on your mobile device at the gate.",
            includeFees: true,
            refundPolicy: "No refunds unless the event is canceled or postponed by the organiser."
          },
          arrivalGuide: {
            notes: "Gates open exactly 2 hours before the main act.",
            parking: "Valet parking available for VIPs. Public parking located 5 minutes walking distance from the main gate.",
            checkInInstructions: "Proceed to the main entrance and present your QR code to our scanning agents."
          },
          capacity: 2500,
          amenities: getRandomSubset(AMENITIES, 6),
          performers: [
            { name: "DJ Spinall", role: "Main DJ", bio: "Award-winning DJ" },
            { name: "Burna Boy (Tribute Band)", role: "Live Band", bio: "The best Afrobeat experience" }
          ],
          safety: getRandomSubset(SAFETY_OPTIONS, 3),
          safetyConsiderations: getRandomSubset(SAFETY_CONSIDERATIONS, 2),
          performance: {
            views: totalTicketsSold * 10,
            clicks: totalTicketsSold * 6,
            wishlists: Math.floor(totalTicketsSold / 2),
            reach: totalTicketsSold * 20,
            engagement: totalTicketsSold * 5,
            ticketSales: totalTicketsSold,
            revenue: totalRevenue,
            pendingInquiries: Math.floor(Math.random() * 10),
            responseRate: 98
          },
          images: []
        });

        // Generate EventTicket (Tiers)
        const tiers = [
          { name: "Early Bird", price: 5000, sold: tierSales1, limit: 800 },
          { name: "General Admission", price: 10000, sold: tierSales2, limit: 1200 },
          { name: "VIP", price: 50000, sold: tierSales3, limit: 500 }
        ];

        for (const tier of tiers) {
          const ticketTier = await EventTicket.create({
            eventId: event._id,
            name: tier.name,
            ticketType: "PAID",
            totalQuantity: tier.limit,
            soldQuantity: tier.sold,
            salesStartAt: new Date(startDate.getTime() - 60 * 24 * 60 * 60 * 1000),
            salesEndAt: startDate,
            currency: { code: "NGN", symbol: "₦" },
            commission: { percentage: 5, type: "ADD_ON" },
            price: { amountCents: tier.price * 100 },
          });

          for (let t = 0; t < tier.sold; t++) {
            const ticketOwner = users[Math.floor(Math.random() * users.length)];
            const bookingId = new mongoose.Types.ObjectId();
            const fakeName = `${names[Math.floor(Math.random() * names.length)]} ${surnames[Math.floor(Math.random() * surnames.length)]}`;
            const fakePhone = `+2348${Math.floor(Math.random() * 90000000) + 10000000}`;
            
            bookingsToInsert.push({
              _id: bookingId,
              eventId: event._id,
              buyer: ticketOwner._id,
              guestDetails: {
                fullName: fakeName,
                phoneNumber: fakePhone,
                email: `buyer_${t}_${generateRandomString(4)}@example.com`
              },
              items: [{
                ticketId: ticketTier._id,
                name: ticketTier.name,
                quantity: 1,
                pricePerUnit: tier.price * 100,
                totalPrice: tier.price * 100
              }],
              totalAmount: tier.price * 100,
              currency: "NGN",
              paymentStatus: "COMPLETED",
              paymentMethod: "PAYSTACK",
              paystackReference: `REF-${generateRandomString(10).toUpperCase()}`,
              status: "COMPLETED"
            });

            let checkInObj = { isCheckedIn: false };
            if (isPast && Math.random() > 0.1) {
              checkInObj = {
                isCheckedIn: true,
                checkedInAt: getRandomDate(new Date(startDate.getTime() - 3600000), new Date(startDate.getTime() + 7200000)),
                method: "QR"
              };
            }

            userTicketsToInsert.push({
              bookingId: bookingId,
              eventId: event._id,
              ticketTypeId: ticketTier._id,
              owner: ticketOwner._id,
              ticketName: ticketTier.name,
              ticketNumber: `TKT-${event._id.toString().substring(0,4).toUpperCase()}-${generateRandomString(6).toUpperCase()}-${t}`,
              qrPayload: `qr-payload-${generateRandomString(12)}`,
              status: isPast && checkInObj.isCheckedIn ? "REDEEMED" : "UNREDEEMED",
              checkIn: checkInObj,
              eventSnapshot: {
                title: event.title,
                shortDescription: event.shortDescription,
                eventType: event.eventType,
                organiser: {
                  name: user.firstName,
                  email: user.email,
                  phoneNumber: user.phoneNumber,
                },
                location: {
                  addressString: "Eko Atlantic City, Lagos",
                  city: "Lagos",
                  country: "Nigeria",
                  coordinates: { latitude: 6.4253, longitude: 3.4095 }
                },
                schedule: {
                  startDate: event.schedule.from,
                  endDate: event.schedule.to,
                }
              },
              ticketSnapshot: {
                name: ticketTier.name,
                ticketType: "PAID",
                price: {
                  amount: ticketTier.price.amountCents / 100, 
                  currency: "NGN",
                  symbol: "₦"
                }
              }
            });
          }
        }

        // CREATE EVENT CENTER
        const pastBlockedDate1 = getRandomDate(new Date(Date.now() - 200 * 24 * 60 * 60 * 1000), new Date(Date.now() - 50 * 24 * 60 * 60 * 1000));
        const pastBlockedDate2 = new Date(pastBlockedDate1.getTime() + (24 * 60 * 60 * 1000));
        
        const centerBookingsCount = Math.floor(Math.random() * 30) + 10;
        const basePriceNaira = 500000;

        const center = await EventCenter.create({
          venueName: `${user.surname} Luxury Center ${i}`,
          venueType: "BANQUET_HALL",
          yearEstablished: 2015,
          totalArea: { value: 15000, unit: "SQ_METERS" },
          hallType: "Grand Ballroom",
          venueSetting: "Indoor/Outdoor Mix",
          oneLiner: "The premier luxury event destination in the heart of the city.",
          shortDescription: "A state-of-the-art venue offering world-class amenities, stunning architecture, and flexible spaces perfect for weddings, conferences, and high-end parties.",
          description: "Our luxury center has hosted some of the most prestigious events in the country. Featuring crystal chandeliers, smart climate control, imported marble floors, and an acoustic design optimized for live bands and DJs. With expansive outdoor terraces and lush gardens, it provides the perfect backdrop for photos. Our dedicated events team ensures every detail is executed flawlessly from setup to teardown.",
          guestAccessDescription: "Guests enter through the main glass pavilion. VIPs have access to a private side entrance and dedicated elevators.",
          interactionDescription: "Our venue manager and concierge will be on standby 24/7 during your rental period to assist with any logistical needs.",
          neighborhoodDescription: "Located in the upscale district, surrounded by 5-star hotels, fine dining restaurants, and secure promenades.",
          transitDescription: "Easily accessible via the main expressway. Dedicated Uber/Bolt drop-off zones are marked at the front.",
          otherDetailsDescription: "A fully equipped commercial kitchen is attached to the ballroom for catering teams.",
          status: "LISTED",
          createdBy: user._id,
          supportedEvents: getRandomSubset(SUPPORTED_EVENTS, 3),
          checkIn: { isFlexible: false, start: "10:00 AM", end: "12:00 PM" },
          checkOut: { time: "06:00 AM" },
          loadingDockDetails: "Back-alley loading dock fits two 50ft trucks. Accessible 24/7.",
          handoverDetails: "Keys and smart-access fobs will be handed over by the facility manager upon final inspection at Check-in.",
          availability: {
            minDuration: 1,
            maxDuration: 14,
            bookingWindow: 12,
            unavailableDates: [
              {
                date: pastBlockedDate1,
                type: "MANUAL",
                clientName: "Chevron End of Year",
                clientPhone: "+2348033333333",
                totalPrice: 1500000,
                depositAmount: 1500000,
                paymentStatus: "paid"
              },
              {
                date: pastBlockedDate2,
                type: "BLOCKED"
              }
            ],
            operationalHours: { open: "06:00", close: "02:00" }
          },
          location: {
            addressString: "789 Boulevard Avenue",
            street: "Boulevard Avenue",
            city: "Metropolis",
            area: "Central Business District",
            postcode: "100231",
            country: "Nigeria",
            coordinates: { latitude: 6.4531, longitude: 3.3958 }
          },
          capacity: { max: 2000 },
          safety: getRandomSubset(SAFETY_OPTIONS, 4),
          safetyConsiderations: getRandomSubset(SAFETY_CONSIDERATIONS, 3),
          amenities: getRandomSubset(AMENITIES, 5),
          venueRules: getRandomSubset(VENUE_RULES, 4),
          discounts: getRandomSubset(DISCOUNTS, 2),
          basePrice: { amount: basePriceNaira, currency: "NGN", unit: "day", feeMode: "addon", minDuration: 1 },
          weekendPrice: { amount: 600000, currency: "NGN", unit: "day", feeMode: "addon", minDuration: 1 },
          performance: {
            views: centerBookingsCount * 800,
            clicks: centerBookingsCount * 400,
            wishlists: centerBookingsCount * 30,
            reach: centerBookingsCount * 1500,
            engagement: centerBookingsCount * 50,
            bookings: centerBookingsCount,
            revenue: centerBookingsCount * basePriceNaira,
          },
          images: []
        });

        // Generate Event Center Tickets (Transactions)
        for (let b = 0; b < centerBookingsCount; b++) {
          const bookingDate = getRandomDate(new Date(Date.now() - 300 * 24 * 60 * 60 * 1000), new Date(Date.now() + 90 * 24 * 60 * 60 * 1000));
          const isCenterPast = bookingDate < new Date();
          const ticketOwner = users[Math.floor(Math.random() * users.length)];
          const fakeName = `${names[Math.floor(Math.random() * names.length)]} ${surnames[Math.floor(Math.random() * surnames.length)]}`;
          const fakePhone = `+2348${Math.floor(Math.random() * 90000000) + 10000000}`;

          centerTicketsToInsert.push({
            buyer: ticketOwner._id,
            guestDetails: {
              fullName: fakeName,
              phoneNumber: fakePhone,
              email: `renter_${b}_${generateRandomString(4)}@example.com`
            },
            organiser: user._id,
            eventCenter: center._id,
            selectedDates: [{ date: bookingDate }],
            bookingUnit: "day",
            duration: 1,
            totalPrice: { amount: basePriceNaira, currency: "NGN" },
            paymentStatus: "COMPLETED",
            paystackReference: `VENUE-REF-${generateRandomString(10).toUpperCase()}`,
            status: isCenterPast ? "COMPLETED" : "ACTIVE",
            ticketNumber: `VNU-${center._id.toString().substring(0,4).toUpperCase()}-${generateRandomString(6).toUpperCase()}-${b}`,
            qrPayload: `venue-qr-${generateRandomString(12)}`,
            checkIn: {
              isCheckedIn: isCenterPast,
              checkedInAt: isCenterPast ? bookingDate : null,
              method: "QR"
            }
          });
        }
      }
    }

    console.log(`Inserting ${bookingsToInsert.length} Event Bookings, ${userTicketsToInsert.length} User Tickets, and ${centerTicketsToInsert.length} Event Center Transactions...`);
    
    // Batch insert for massive performance boost
    const batchSize = 2000;
    for (let i = 0; i < bookingsToInsert.length; i += batchSize) {
      await EventBooking.insertMany(bookingsToInsert.slice(i, i + batchSize));
      await UserEventTicket.insertMany(userTicketsToInsert.slice(i, i + batchSize));
    }
    
    for (let i = 0; i < centerTicketsToInsert.length; i += batchSize) {
      await EventCenterTicket.insertMany(centerTicketsToInsert.slice(i, i + batchSize));
    }

    console.log("Ultimate Real-Life Mock Data Generated Successfully!");
    process.exit(0);
  } catch (error) {
    console.error("SEED ERROR:", error.message || error);
    process.exit(1);
  }
};

runSeed();
