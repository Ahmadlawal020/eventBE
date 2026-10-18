/**
 * Seed 1,000 Users with sequential email pattern (a@a.com, b@b.com ... z@z.com, aa@aa.com ... all@all.com)
 * Password for all users: 12345678
 * First 100 users: Identity Verified (approved IdentityVerification document) & Payout Account (bankDetails + vendorAccountCode) set
 * Realistic, diverse names and locations from around the world
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const User = require("../models/client/user.schema");
const IdentityVerification = require("../models/client/identityVerification.schema");
const { codeForUser } = require("../utils/referralCode");

// Sequence converter:
// 0 -> 'a'
// 25 -> 'z'
// 26 -> 'aa'
// 701 -> 'zz'
// 702 -> 'aaa'
// 999 -> 'all'
function indexToLetterCode(n) {
  let result = "";
  while (n >= 0) {
    result = String.fromCharCode(97 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

// Global demographic dataset
const CULTURES = [
  {
    country: "Nigeria",
    cities: ["Lagos", "Abuja", "Kano", "Port Harcourt", "Ibadan", "Enugu"],
    phoneCode: "+234",
    firstNames: [
      "Chinedu", "Amina", "Babatunde", "Ngozi", "Olumide", "Zainab", "Emeka", "Fatima",
      "Kelechi", "Halima", "Tunde", "Amaka", "Damilola", "Ifeanyi", "Folake", "Ibrahim",
      "Kemi", "Femi", "Chioma", "Mustapha", "Bilkisu", "Adeola", "Farida", "Abubakar"
    ],
    lastNames: [
      "Okonkwo", "Adebayo", "Balogun", "Eze", "Bello", "Okafor", "Adeleke", "Sanusi",
      "Nwosu", "Garba", "Chukwu", "Babangida", "Aliyu", "Danjuma", "Alabi", "Ojo"
    ],
    streets: ["Adetokunbo Ademola St", "Herbert Macaulay Way", "Zoo Road", "Broad Street", "Ahmadu Bello Way", "Allen Avenue"]
  },
  {
    country: "United States",
    cities: ["New York", "Los Angeles", "Chicago", "Houston", "Atlanta", "Seattle", "Miami"],
    phoneCode: "+1",
    firstNames: [
      "James", "Emma", "Ethan", "Sophia", "Michael", "Ava", "Alexander", "Isabella",
      "Daniel", "Mia", "Benjamin", "Charlotte", "Lucas", "Amelia", "Henry", "Harper",
      "Jackson", "Evelyn", "Liam", "Abigail", "Noah", "Emily", "William", "Elizabeth"
    ],
    lastNames: [
      "Smith", "Johnson", "Williams", "Brown", "Jones", "Miller", "Davis", "Wilson",
      "Anderson", "Taylor", "Thomas", "Moore", "Jackson", "Martin", "Lee", "Harris"
    ],
    streets: ["Broadway", "Oak Street", "Maple Avenue", "Sunset Blvd", "Michigan Ave", "Peachtree St", "Pine Street"]
  },
  {
    country: "United Kingdom",
    cities: ["London", "Manchester", "Birmingham", "Edinburgh", "Glasgow", "Bristol", "Leeds"],
    phoneCode: "+44",
    firstNames: [
      "Oliver", "Olivia", "George", "Amelia", "Harry", "Isla", "Jack", "Ava",
      "Noah", "Grace", "Leo", "Freya", "Arthur", "Florence", "Callum", "Siobhan",
      "Declan", "Poppy", "Oscar", "Evie", "Archie", "Ruby", "Alfie", "Daisy"
    ],
    lastNames: [
      "Smith", "Jones", "Taylor", "Davies", "Evans", "Wilson", "Thomas", "Roberts",
      "Gallagher", "O'Connor", "Campbell", "Stewart", "Clarke", "Hughes", "Edwards"
    ],
    streets: ["High Street", "Church Road", "Victoria Street", "Park Road", "Queen Street", "Kings Road"]
  },
  {
    country: "Japan",
    cities: ["Tokyo", "Osaka", "Kyoto", "Yokohama", "Nagoya", "Fukuoka", "Sapporo"],
    phoneCode: "+81",
    firstNames: [
      "Haruto", "Yui", "Ren", "Hina", "Souta", "Mei", "Yuuto", "Sakura",
      "Kaito", "Aoi", "Takumi", "Nana", "Daiki", "Rin", "Kenji", "Akari",
      "Sho", "Koharu", "Riku", "Mio", "Hayato", "Yuna", "Kazuki", "Honoka"
    ],
    lastNames: [
      "Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito", "Yamamoto",
      "Nakamura", "Kobayashi", "Kato", "Yoshida", "Yamada", "Sasaki", "Yamaguchi"
    ],
    streets: ["Chuo Dori", "Shibuya 1-chome", "Roppongi Hills Ave", "Ginza 4-chome", "Meiji Dori"]
  },
  {
    country: "France",
    cities: ["Paris", "Lyon", "Marseille", "Toulouse", "Nice", "Nantes", "Strasbourg"],
    phoneCode: "+33",
    firstNames: [
      "Gabriel", "Jade", "Raphael", "Louise", "Leo", "Ambre", "Louis", "Alba",
      "Arthur", "Emma", "Jules", "Rose", "Lucas", "Alice", "Hugo", "Camille",
      "Maxime", "Chloe", "Paul", "Manon", "Mathis", "Zoe", "Thomas", "Ines"
    ],
    lastNames: [
      "Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit",
      "Durand", "Leroy", "Moreau", "Simon", "Laurent", "Lefebvre", "Michel"
    ],
    streets: ["Rue de la Paix", "Avenue des Champs-Elysees", "Boulevard Saint-Germain", "Rue de Rivoli", "Rue Victor Hugo"]
  },
  {
    country: "Germany",
    cities: ["Berlin", "Munich", "Hamburg", "Frankfurt", "Cologne", "Stuttgart"],
    phoneCode: "+49",
    firstNames: [
      "Noah", "Mia", "Matteo", "Emma", "Finn", "Sophia", "Leon", "Hannah",
      "Elias", "Emilia", "Paul", "Lina", "Lukas", "Ella", "Felix", "Clara",
      "Maximilian", "Marie", "Jonas", "Lea", "Moritz", "Anna", "Niklas", "Laura"
    ],
    lastNames: [
      "Muller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner",
      "Becker", "Schulz", "Hoffmann", "Schäfer", "Koch", "Bauer", "Richter"
    ],
    streets: ["Friedrichstrasse", "Kurfürstendamm", "Maximilianstrasse", "Kaufingerstrasse", "Unter den Linden"]
  },
  {
    country: "Brazil",
    cities: ["Sao Paulo", "Rio de Janeiro", "Salvador", "Brasilia", "Curitiba", "Belo Horizonte"],
    phoneCode: "+55",
    firstNames: [
      "Miguel", "Helena", "Arthur", "Alice", "Gael", "Laura", "Heitor", "Manuela",
      "Theo", "Sophia", "Davi", "Isabella", "Gabriel", "Luiza", "Bernardo", "Heloisa",
      "Lucas", "Valentina", "Matheus", "Livia", "Pedro", "Cecilia", "Felipe", "Julia"
    ],
    lastNames: [
      "Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves",
      "Pereira", "Lima", "Gomes", "Costa", "Ribeiro", "Martins", "Carvalho"
    ],
    streets: ["Avenida Paulista", "Rua Augusta", "Avenida Atlantica", "Rua Oscar Freire", "Avenida Brasil"]
  },
  {
    country: "India",
    cities: ["Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Chennai", "Kolkata", "Pune"],
    phoneCode: "+91",
    firstNames: [
      "Aarav", "Ananya", "Vihaan", "Diya", "Reyansh", "Ishaan", "Saanvi", "Advait",
      "Aditi", "Arjun", "Priya", "Rohan", "Kabir", "Meera", "Vivaan", "Riya",
      "Ayaan", "Tara", "Dhruv", "Avani", "Kavya", "Shaurya", "Anushka", "Nikhil"
    ],
    lastNames: [
      "Sharma", "Patel", "Verma", "Singh", "Kumar", "Rao", "Gupta", "Nair",
      "Das", "Chatterjee", "Reddy", "Mehta", "Chopra", "Joshi", "Bose"
    ],
    streets: ["MG Road", "Brigade Road", "Connaught Place", "Marine Drive", "Park Street", "Anna Salai"]
  },
  {
    country: "South Korea",
    cities: ["Seoul", "Busan", "Incheon", "Daegu", "Daejeon", "Gwangju"],
    phoneCode: "+82",
    firstNames: [
      "Min-jun", "Seo-yeon", "Ha-joon", "Seo-jun", "Ji-woo", "Do-yun", "Ye-jun",
      "Ha-eun", "Si-woo", "Ji-ah", "Ju-won", "Seo-ah", "Eun-woo", "Soo-ah",
      "Yoo-joon", "Chae-won", "Min-seo", "Ji-ho", "Da-eun", "Hyun-woo"
    ],
    lastNames: [
      "Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon", "Jang", "Lim", "Han", "Shin"
    ],
    streets: ["Teheran-ro", "Gangnam-daero", "Myeongdong-gil", "Itaewon-ro", "Jong-ro"]
  },
  {
    country: "Spain",
    cities: ["Madrid", "Barcelona", "Valencia", "Seville", "Bilbao", "Malaga"],
    phoneCode: "+34",
    firstNames: [
      "Mateo", "Lucia", "Hugo", "Sofia", "Martin", "Maria", "Lucas", "Julia",
      "Leo", "Paula", "Daniel", "Valeria", "Alejandro", "Emma", "Manuel", "Martina",
      "Pablo", "Carla", "Alvaro", "Alba", "Adrian", "Sara", "Diego", "Noa"
    ],
    lastNames: [
      "Garcia", "Rodriguez", "Gonzalez", "Fernandez", "Lopez", "Martinez", "Sanchez",
      "Perez", "Gomez", "Martin", "Jimenez", "Ruiz", "Hernandez", "Diaz"
    ],
    streets: ["Gran Via", "Paseo de la Castellana", "La Rambla", "Passeig de Gracia", "Calle Mayor"]
  },
  {
    country: "Egypt",
    cities: ["Cairo", "Alexandria", "Giza", "Luxor", "Aswan"],
    phoneCode: "+20",
    firstNames: [
      "Youssef", "Mariam", "Omar", "Nour", "Ahmed", "Salma", "Karim", "Farida",
      "Mahmoud", "Malak", "Tarek", "Laila", "Mostafa", "Hana", "Amr", "Zainab"
    ],
    lastNames: [
      "Mansour", "El-Masry", "Hassan", "Ibrahim", "Khalil", "Abdel-Rahman", "Farouk", "Nasser", "Suleiman"
    ],
    streets: ["Tahrir Street", "Corniche El Nil", "Kasr El Aini St", "Al Ahram St"]
  },
  {
    country: "Australia",
    cities: ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide"],
    phoneCode: "+61",
    firstNames: [
      "Oliver", "Charlotte", "William", "Amelia", "Jack", "Olivia", "Noah", "Mia",
      "Thomas", "Isla", "Lucas", "Grace", "Lachlan", "Chloe", "Cooper", "Zoe"
    ],
    lastNames: [
      "Smith", "Jones", "Williams", "Brown", "Wilson", "Taylor", "Johnson", "White", "Martin", "Anderson"
    ],
    streets: ["George Street", "Collins Street", "Queen Street Mall", "Bourke Street", "Pitt Street"]
  },
  {
    country: "Canada",
    cities: ["Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa"],
    phoneCode: "+1",
    firstNames: [
      "Liam", "Olivia", "Noah", "Emma", "Jackson", "Charlotte", "Lucas", "Amelia",
      "Benjamin", "Chloe", "Logan", "Sophia", "Jacob", "Mia", "Ethan", "Ava"
    ],
    lastNames: [
      "Smith", "Brown", "Tremblay", "Martin", "Roy", "Wilson", "Macdonald", "Gagnon", "Johnson", "Taylor"
    ],
    streets: ["Yonge Street", "Bay Street", "Robson Street", "Sainte-Catherine St", "Jasper Avenue"]
  },
  {
    country: "United Arab Emirates",
    cities: ["Dubai", "Abu Dhabi", "Sharjah", "Ajman"],
    phoneCode: "+971",
    firstNames: [
      "Zayed", "Fatima", "Rashid", "Maryam", "Hamdan", "Latifa", "Sultan", "Shamma",
      "Mansoor", "Alia", "Khalid", "Mona", "Saeed", "Salama"
    ],
    lastNames: [
      "Al-Maktoum", "Al-Nahyan", "Al-Qasimi", "Al-Nuaimi", "Al-Zaabi", "Al-Falasi", "Al-Suwaidi"
    ],
    streets: ["Sheikh Zayed Road", "Corniche Road", "Jumeirah Beach Road", "Al Wasl Road"]
  },
  {
    country: "Sweden",
    cities: ["Stockholm", "Gothenburg", "Malmo", "Uppsala"],
    phoneCode: "+46",
    firstNames: [
      "Lucas", "Alice", "Liam", "Maja", "William", "Elsa", "Elias", "Astrid",
      "Hugo", "Wilma", "Oliver", "Freja", "Alexander", "Ebba", "Axel", "Agnes"
    ],
    lastNames: [
      "Johansson", "Andersson", "Karlsson", "Nilsson", "Eriksson", "Larsson", "Olsson", "Persson"
    ],
    streets: ["Drottninggatan", "Sveavägen", "Kungsgatan", "Avenyn", "Götgatan"]
  }
];

// Curated Nigerian Banks for the 100 verified payout accounts
const NIGERIAN_BANKS = [
  { name: "Access Bank", code: "044" },
  { name: "Guaranty Trust Bank", code: "058" },
  { name: "Zenith Bank", code: "057" },
  { name: "United Bank for Africa", code: "033" },
  { name: "First Bank of Nigeria", code: "011" },
  { name: "Stanbic IBTC Bank", code: "221" },
  { name: "Kuda Bank", code: "50211" },
  { name: "Moniepoint MFB", code: "50515" },
  { name: "OPay", code: "999992" },
  { name: "Sterling Bank", code: "232" },
  { name: "Fidelity Bank", code: "070" },
  { name: "Wema Bank", code: "035" },
];

// Realistic high-quality profile avatars pool
const AVATAR_POOL = [
  "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1534751516642-a171edd2521d?w=400&auto=format&fit=crop&q=80",
];

async function seed() {
  console.log("==================================================");
  console.log("   SEEDING 1,000 REALISTIC USERS");
  console.log("==================================================");

  if (!process.env.DATABASE_URI) {
    throw new Error("DATABASE_URI is not set in environment or .env");
  }

  await mongoose.connect(process.env.DATABASE_URI);
  console.log(" Connected to MongoDB:", mongoose.connection.name);

  // Pre-compute bcrypt password hash for "12345678"
  console.log(" Hashing password '12345678' with bcrypt (10 rounds)...");
  const commonPasswordHash = await bcrypt.hash("12345678", 10);
  console.log(" Password hash ready.");

  const totalUsersToSeed = 1000;
  const verifiedUsersCount = 100;

  console.log(` Generating ${totalUsersToSeed} user records...`);
  console.log(` - Pattern: a@a.com, b@b.com ... z@z.com, aa@aa.com ...`);
  console.log(` - Top ${verifiedUsersCount} users will have Identity Verified & Payout Account set.`);

  const userDocs = [];
  const verificationDocs = [];
  const usedReferralCodes = new Set();

  for (let i = 0; i < totalUsersToSeed; i++) {
    const letterCode = indexToLetterCode(i);
    const email = `${letterCode}@${letterCode}.com`;

    // Pick culture deterministically/pseudo-randomly to ensure worldwide distribution
    const culture = CULTURES[i % CULTURES.length];
    const firstName = culture.firstNames[(i * 7 + 3) % culture.firstNames.length];
    const surname = culture.lastNames[(i * 11 + 5) % culture.lastNames.length];
    const city = culture.cities[(i * 3) % culture.cities.length];
    const street = `${(i % 180) + 1} ${culture.streets[i % culture.streets.length]}`;
    const postalCode = String(10000 + ((i * 137) % 89999));
    const phoneDigits = String(8000000000 + ((i * 3571) % 1999999999)).slice(0, 10);
    const phoneNumber = `${culture.phoneCode}${phoneDigits}`;
    const avatarUrl = AVATAR_POOL[i % AVATAR_POOL.length];

    // Dates
    const birthYear = 1978 + (i % 26); // 1978 to 2004
    const birthMonth = (i % 12);
    const birthDay = 1 + (i % 28);
    const dob = new Date(birthYear, birthMonth, birthDay);

    const createdAt = new Date(Date.now() - (1000 - i) * 3600000 * 12); // staggered account creation
    const emailVerifiedAt = new Date(createdAt.getTime() + 60000 * 5);

    const userId = new mongoose.Types.ObjectId();
    let refCode = codeForUser(userId);
    while (usedReferralCodes.has(refCode)) {
      refCode = "MN" + Math.random().toString(36).substring(2, 8).toUpperCase();
    }
    usedReferralCodes.add(refCode);

    const isVerifiedOrganiser = i < verifiedUsersCount;

    let vendorAccountCode = null;
    let paystackSubaccountCode = null;
    let bankDetails = undefined;

    if (isVerifiedOrganiser) {
      const bank = NIGERIAN_BANKS[i % NIGERIAN_BANKS.length];
      const accountNum = String(1000000000 + ((i * 8317 + 101) % 899999999)).slice(0, 10);
      const subCode = `SUB_${String(i + 1).padStart(6, "0")}`;

      vendorAccountCode = subCode;
      paystackSubaccountCode = subCode;
      bankDetails = {
        accountName: `${firstName} ${surname}`.toUpperCase(),
        accountNumber: accountNum,
        bankName: bank.name,
        bankCode: bank.code,
      };

      // Create approved IdentityVerification document
      const idTypes = ["ID", "PP", "DL"];
      const idType = idTypes[i % idTypes.length];
      verificationDocs.push({
        _id: new mongoose.Types.ObjectId(),
        userId: userId,
        idType: idType,
        idFrontImage: {
          url: "https://images.unsplash.com/photo-1544717305-2782549b5136?w=600&auto=format&fit=crop&q=80",
          publicId: `seed/id_front_${userId}`,
        },
        idBackImage: {
          url: "https://images.unsplash.com/photo-1544717305-2782549b5136?w=600&auto=format&fit=crop&q=80",
          publicId: `seed/id_back_${userId}`,
        },
        selfieImage: {
          url: avatarUrl,
          publicId: `seed/selfie_${userId}`,
        },
        status: "approved",
        reviewedAt: new Date(createdAt.getTime() + 3600000 * 24),
        reviewedBy: userId,
        createdAt: createdAt,
        updatedAt: createdAt,
      });
    }

    userDocs.push({
      _id: userId,
      firstName,
      surname,
      preferredFirstName: firstName,
      phoneNumber,
      email,
      password: commonPasswordHash,
      dob,
      authProvider: "local",
      profilePicture: {
        url: avatarUrl,
        publicId: `seed/avatars/user_${userId}`,
      },
      roles: isVerifiedOrganiser ? ["user", "organiser"] : ["user"],
      isEmailVerified: true,
      emailVerifiedAt,
      isPhoneVerified: isVerifiedOrganiser,
      phoneVerifiedAt: isVerifiedOrganiser ? emailVerifiedAt : null,
      isIdentityVerified: isVerifiedOrganiser,
      residentialAddress: {
        country: culture.country,
        city: city,
        street: street,
        postalCode: postalCode,
        county: city,
        unit: `Apt ${((i % 40) + 1)}`,
      },
      emergencyContact: {
        name: `${culture.firstNames[(i + 4) % culture.firstNames.length]} ${surname}`,
        relationship: ["Spouse", "Sibling", "Parent", "Friend"][(i % 4)],
        email: `emergency.${letterCode}@${letterCode}.com`,
        phoneNumber: `${culture.phoneCode}${String(7000000000 + ((i * 1237) % 1999999999)).slice(0, 10)}`,
      },
      vendorAccountCode,
      paystackSubaccountCode,
      bankDetails,
      referralCode: refCode,
      isActive: true,
      preferredLanguage: "en",
      createdAt,
      updatedAt: createdAt,
    });
  }

  // Clear existing users with the same generated email patterns to prevent duplicate keys
  const emailsList = userDocs.map((u) => u.email);
  console.log(" Cleaning any existing records matching candidate emails...");
  const existingDeleted = await User.deleteMany({ email: { $in: emailsList } });
  if (existingDeleted.deletedCount > 0) {
    console.log(` Removed ${existingDeleted.deletedCount} existing test user accounts.`);
  }

  // Insert in batches
  const batchSize = 250;
  console.log(` Inserting ${userDocs.length} users into MongoDB in batches of ${batchSize}...`);
  for (let b = 0; b < userDocs.length; b += batchSize) {
    const chunk = userDocs.slice(b, b + batchSize);
    await User.insertMany(chunk, { ordered: true });
    console.log(`   -> Inserted users ${b + 1} to ${b + chunk.length}`);
  }

  // Insert Identity Verifications
  if (verificationDocs.length > 0) {
    console.log(` Inserting ${verificationDocs.length} approved KYC verification documents...`);
    const userIds = verificationDocs.map((v) => v.userId);
    await IdentityVerification.deleteMany({ userId: { $in: userIds } });
    await IdentityVerification.insertMany(verificationDocs, { ordered: true });
    console.log(`   -> KYC documents inserted.`);
  }

  console.log(" Validating seeded users...");
  const totalCount = await User.countDocuments();
  const verifiedCount = await User.countDocuments({ isIdentityVerified: true });
  const payoutCount = await User.countDocuments({ vendorAccountCode: { $ne: null } });

  console.log("\n==================================================");
  console.log(" SEEDING COMPLETE SUMMARY:");
  console.log("==================================================");
  console.log(` Total Users in Database:               ${totalCount}`);
  console.log(` Total Identity-Verified Users:         ${verifiedCount}`);
  console.log(` Total Users with Payout Account Set:   ${payoutCount}`);

  // Test password verification on sample accounts
  const firstUser = await User.findOne({ email: "a@a.com" }).lean();
  const midVerifiedUser = await User.findOne({ email: indexToLetterCode(99) + "@" + indexToLetterCode(99) + ".com" }).lean();
  const unverifiedUser = await User.findOne({ email: indexToLetterCode(100) + "@" + indexToLetterCode(100) + ".com" }).lean();
  const lastUser = await User.findOne({ email: indexToLetterCode(999) + "@" + indexToLetterCode(999) + ".com" }).lean();

  const isPasswordCorrect = await bcrypt.compare("12345678", firstUser.password);

  console.log("\n--- Sample Account Verification ---");
  console.log("1. First User (a@a.com):");
  console.log({
    email: firstUser.email,
    name: `${firstUser.firstName} ${firstUser.surname}`,
    country: firstUser.residentialAddress?.country,
    isIdentityVerified: firstUser.isIdentityVerified,
    payoutBank: firstUser.bankDetails?.bankName,
    accountNumber: firstUser.bankDetails?.accountNumber,
    vendorAccountCode: firstUser.vendorAccountCode,
    referralCode: firstUser.referralCode,
    passwordMatchFor12345678: isPasswordCorrect,
  });

  console.log("\n2. 100th User (Verified boundary):");
  console.log({
    email: midVerifiedUser.email,
    name: `${midVerifiedUser.firstName} ${midVerifiedUser.surname}`,
    country: midVerifiedUser.residentialAddress?.country,
    isIdentityVerified: midVerifiedUser.isIdentityVerified,
    payoutBank: midVerifiedUser.bankDetails?.bankName,
    vendorAccountCode: midVerifiedUser.vendorAccountCode,
  });

  console.log("\n3. 101st User (Unverified boundary):");
  console.log({
    email: unverifiedUser.email,
    name: `${unverifiedUser.firstName} ${unverifiedUser.surname}`,
    country: unverifiedUser.residentialAddress?.country,
    isIdentityVerified: unverifiedUser.isIdentityVerified,
    payoutBank: unverifiedUser.bankDetails?.bankName || null,
    vendorAccountCode: unverifiedUser.vendorAccountCode,
  });

  console.log("\n4. 1000th User (Last in sequence):");
  console.log({
    email: lastUser.email,
    name: `${lastUser.firstName} ${lastUser.surname}`,
    country: lastUser.residentialAddress?.country,
    isIdentityVerified: lastUser.isIdentityVerified,
    referralCode: lastUser.referralCode,
  });

  await mongoose.disconnect();
  console.log("\n Database connection closed safely.");
}

seed().catch((err) => {
  console.error(" Seed failed with error:", err);
  process.exit(1);
});
