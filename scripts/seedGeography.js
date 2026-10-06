require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const GeographicLocation = require("../models/management/geographicLocation.schema");

// Continents
const CONTINENTS = [
  { code: "CONT-AF", name: "Africa" },
  { code: "CONT-EU", name: "Europe" },
  { code: "CONT-NA", name: "North America" },
  { code: "CONT-AS", name: "Asia" },
  { code: "CONT-SA", name: "South America" },
  { code: "CONT-OC", name: "Oceania" },
  { code: "CONT-AN", name: "Antarctica" },
];

// Mapping of ISO-2 country codes to continent codes
const COUNTRY_CONTINENT_MAP = {
  // Africa
  DZ: "CONT-AF", AO: "CONT-AF", BJ: "CONT-AF", BW: "CONT-AF", BF: "CONT-AF", BI: "CONT-AF",
  CV: "CONT-AF", CM: "CONT-AF", CF: "CONT-AF", TD: "CONT-AF", KM: "CONT-AF", CG: "CONT-AF",
  CD: "CONT-AF", CI: "CONT-AF", DJ: "CONT-AF", EG: "CONT-AF", GQ: "CONT-AF", ER: "CONT-AF",
  SZ: "CONT-AF", ET: "CONT-AF", GA: "CONT-AF", GM: "CONT-AF", GH: "CONT-AF", GN: "CONT-AF",
  GW: "CONT-AF", KE: "CONT-AF", LS: "CONT-AF", LR: "CONT-AF", LY: "CONT-AF", MG: "CONT-AF",
  MW: "CONT-AF", ML: "CONT-AF", MR: "CONT-AF", MU: "CONT-AF", MA: "CONT-AF", MZ: "CONT-AF",
  NA: "CONT-AF", NE: "CONT-AF", NG: "CONT-AF", RW: "CONT-AF", ST: "CONT-AF", SN: "CONT-AF",
  SC: "CONT-AF", SL: "CONT-AF", SO: "CONT-AF", ZA: "CONT-AF", SS: "CONT-AF", SD: "CONT-AF",
  TZ: "CONT-AF", TG: "CONT-AF", TN: "CONT-AF", UG: "CONT-AF", ZM: "CONT-AF", ZW: "CONT-AF",

  // Europe
  AL: "CONT-EU", AD: "CONT-EU", AT: "CONT-EU", BY: "CONT-EU", BE: "CONT-EU", BA: "CONT-EU",
  BG: "CONT-EU", HR: "CONT-EU", CY: "CONT-EU", CZ: "CONT-EU", DK: "CONT-EU", EE: "CONT-EU",
  FI: "CONT-EU", FR: "CONT-EU", DE: "CONT-EU", GR: "CONT-EU", HU: "CONT-EU", IS: "CONT-EU",
  IE: "CONT-EU", IT: "CONT-EU", LV: "CONT-EU", LI: "CONT-EU", LT: "CONT-EU", LU: "CONT-EU",
  MT: "CONT-EU", MD: "CONT-EU", MC: "CONT-EU", ME: "CONT-EU", NL: "CONT-EU", MK: "CONT-EU",
  NO: "CONT-EU", PL: "CONT-EU", PT: "CONT-EU", RO: "CONT-EU", RU: "CONT-EU", SM: "CONT-EU",
  RS: "CONT-EU", SK: "CONT-EU", SI: "CONT-EU", ES: "CONT-EU", SE: "CONT-EU", CH: "CONT-EU",
  UA: "CONT-EU", GB: "CONT-EU", VA: "CONT-EU",

  // North America
  AG: "CONT-NA", BS: "CONT-NA", BB: "CONT-NA", BZ: "CONT-NA", CA: "CONT-NA", CR: "CONT-NA",
  CU: "CONT-NA", DM: "CONT-NA", DO: "CONT-NA", SV: "CONT-NA", GD: "CONT-NA", GT: "CONT-NA",
  HT: "CONT-NA", HN: "CONT-NA", JM: "CONT-NA", MX: "CONT-NA", NI: "CONT-NA", PA: "CONT-NA",
  KN: "CONT-NA", LC: "CONT-NA", VC: "CONT-NA", TT: "CONT-NA", US: "CONT-NA", PR: "CONT-NA",

  // South America
  AR: "CONT-SA", BO: "CONT-SA", BR: "CONT-SA", CL: "CONT-SA", CO: "CONT-SA", EC: "CONT-SA",
  GY: "CONT-SA", PY: "CONT-SA", PE: "CONT-SA", SR: "CONT-SA", UY: "CONT-SA", VE: "CONT-SA",

  // Asia
  AF: "CONT-AS", AM: "CONT-AS", AZ: "CONT-AS", BH: "CONT-AS", BD: "CONT-AS", BT: "CONT-AS",
  BN: "CONT-AS", KH: "CONT-AS", CN: "CONT-AS", GE: "CONT-AS", HK: "CONT-AS", IN: "CONT-AS",
  ID: "CONT-AS", IR: "CONT-AS", IQ: "CONT-AS", IL: "CONT-AS", JP: "CONT-AS", JO: "CONT-AS",
  KZ: "CONT-AS", KW: "CONT-AS", KG: "CONT-AS", LA: "CONT-AS", LB: "CONT-AS", MY: "CONT-AS",
  MV: "CONT-AS", MN: "CONT-AS", MM: "CONT-AS", NP: "CONT-AS", KP: "CONT-AS", KR: "CONT-AS",
  OM: "CONT-AS", PK: "CONT-AS", PS: "CONT-AS", PH: "CONT-AS", QA: "CONT-AS", SA: "CONT-AS",
  SG: "CONT-AS", LK: "CONT-AS", SY: "CONT-AS", TW: "CONT-AS", TJ: "CONT-AS", TH: "CONT-AS",
  TL: "CONT-AS", TR: "CONT-AS", TM: "CONT-AS", AE: "CONT-AS", UZ: "CONT-AS", VN: "CONT-AS",
  YE: "CONT-AS",

  // Oceania
  AU: "CONT-OC", FJ: "CONT-OC", KI: "CONT-OC", MH: "CONT-OC", FM: "CONT-OC", NR: "CONT-OC",
  NZ: "CONT-OC", PW: "CONT-OC", PG: "CONT-OC", WS: "CONT-OC", SB: "CONT-OC", TO: "CONT-OC",
  TV: "CONT-OC", VU: "CONT-OC",
};

// All universally recognized countries and territories (ISO 3166-1 alpha-2)
const ALL_COUNTRIES = [
  { code: "AF", name: "Afghanistan" },
  { code: "AL", name: "Albania" },
  { code: "DZ", name: "Algeria" },
  { code: "AD", name: "Andorra" },
  { code: "AO", name: "Angola" },
  { code: "AG", name: "Antigua and Barbuda" },
  { code: "AR", name: "Argentina" },
  { code: "AM", name: "Armenia" },
  { code: "AU", name: "Australia" },
  { code: "AT", name: "Austria" },
  { code: "AZ", name: "Azerbaijan" },
  { code: "BS", name: "Bahamas" },
  { code: "BH", name: "Bahrain" },
  { code: "BD", name: "Bangladesh" },
  { code: "BB", name: "Barbados" },
  { code: "BY", name: "Belarus" },
  { code: "BE", name: "Belgium" },
  { code: "BZ", name: "Belize" },
  { code: "BJ", name: "Benin" },
  { code: "BT", name: "Bhutan" },
  { code: "BO", name: "Bolivia" },
  { code: "BA", name: "Bosnia and Herzegovina" },
  { code: "BW", name: "Botswana" },
  { code: "BR", name: "Brazil" },
  { code: "BN", name: "Brunei" },
  { code: "BG", name: "Bulgaria" },
  { code: "BF", name: "Burkina Faso" },
  { code: "BI", name: "Burundi" },
  { code: "CV", name: "Cabo Verde" },
  { code: "KH", name: "Cambodia" },
  { code: "CM", name: "Cameroon" },
  { code: "CA", name: "Canada" },
  { code: "CF", name: "Central African Republic" },
  { code: "TD", name: "Chad" },
  { code: "CL", name: "Chile" },
  { code: "CN", name: "China" },
  { code: "CO", name: "Colombia" },
  { code: "KM", name: "Comoros" },
  { code: "CG", name: "Congo" },
  { code: "CD", name: "Congo, Democratic Republic of the" },
  { code: "CR", name: "Costa Rica" },
  { code: "CI", name: "Cote d'Ivoire" },
  { code: "HR", name: "Croatia" },
  { code: "CU", name: "Cuba" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czech Republic" },
  { code: "DK", name: "Denmark" },
  { code: "DJ", name: "Djibouti" },
  { code: "DM", name: "Dominica" },
  { code: "DO", name: "Dominican Republic" },
  { code: "EC", name: "Ecuador" },
  { code: "EG", name: "Egypt" },
  { code: "SV", name: "El Salvador" },
  { code: "GQ", name: "Equatorial Guinea" },
  { code: "ER", name: "Eritrea" },
  { code: "EE", name: "Estonia" },
  { code: "SZ", name: "Eswatini" },
  { code: "ET", name: "Ethiopia" },
  { code: "FJ", name: "Fiji" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "GA", name: "Gabon" },
  { code: "GM", name: "Gambia" },
  { code: "GE", name: "Georgia" },
  { code: "DE", name: "Germany" },
  { code: "GH", name: "Ghana" },
  { code: "GR", name: "Greece" },
  { code: "GD", name: "Grenada" },
  { code: "GT", name: "Guatemala" },
  { code: "GN", name: "Guinea" },
  { code: "GW", name: "Guinea-Bissau" },
  { code: "GY", name: "Guyana" },
  { code: "HT", name: "Haiti" },
  { code: "HN", name: "Honduras" },
  { code: "HK", name: "Hong Kong" },
  { code: "HU", name: "Hungary" },
  { code: "IS", name: "Iceland" },
  { code: "IN", name: "India" },
  { code: "ID", name: "Indonesia" },
  { code: "IR", name: "Iran" },
  { code: "IQ", name: "Iraq" },
  { code: "IE", name: "Ireland" },
  { code: "IL", name: "Israel" },
  { code: "IT", name: "Italy" },
  { code: "JM", name: "Jamaica" },
  { code: "JP", name: "Japan" },
  { code: "JO", name: "Jordan" },
  { code: "KZ", name: "Kazakhstan" },
  { code: "KE", name: "Kenya" },
  { code: "KI", name: "Kiribati" },
  { code: "KP", name: "Korea, North" },
  { code: "KR", name: "Korea, South" },
  { code: "KW", name: "Kuwait" },
  { code: "KG", name: "Kyrgyzstan" },
  { code: "LA", name: "Laos" },
  { code: "LV", name: "Latvia" },
  { code: "LB", name: "Lebanon" },
  { code: "LS", name: "Lesotho" },
  { code: "LR", name: "Liberia" },
  { code: "LY", name: "Libya" },
  { code: "LI", name: "Liechtenstein" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MG", name: "Madagascar" },
  { code: "MW", name: "Malawi" },
  { code: "MY", name: "Malaysia" },
  { code: "MV", name: "Maldives" },
  { code: "ML", name: "Mali" },
  { code: "MT", name: "Malta" },
  { code: "MH", name: "Marshall Islands" },
  { code: "MR", name: "Mauritania" },
  { code: "MU", name: "Mauritius" },
  { code: "MX", name: "Mexico" },
  { code: "FM", name: "Micronesia" },
  { code: "MD", name: "Moldova" },
  { code: "MC", name: "Monaco" },
  { code: "MN", name: "Mongolia" },
  { code: "ME", name: "Montenegro" },
  { code: "MA", name: "Morocco" },
  { code: "MZ", name: "Mozambique" },
  { code: "MM", name: "Myanmar" },
  { code: "NA", name: "Namibia" },
  { code: "NR", name: "Nauru" },
  { code: "NP", name: "Nepal" },
  { code: "NL", name: "Netherlands" },
  { code: "NZ", name: "New Zealand" },
  { code: "NI", name: "Nicaragua" },
  { code: "NE", name: "Niger" },
  { code: "NG", name: "Nigeria" },
  { code: "MK", name: "North Macedonia" },
  { code: "NO", name: "Norway" },
  { code: "OM", name: "Oman" },
  { code: "PK", name: "Pakistan" },
  { code: "PW", name: "Palau" },
  { code: "PS", name: "Palestine" },
  { code: "PA", name: "Panama" },
  { code: "PG", name: "Papua New Guinea" },
  { code: "PY", name: "Paraguay" },
  { code: "PE", name: "Peru" },
  { code: "PH", name: "Philippines" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "PR", name: "Puerto Rico" },
  { code: "QA", name: "Qatar" },
  { code: "RO", name: "Romania" },
  { code: "RU", name: "Russia" },
  { code: "RW", name: "Rwanda" },
  { code: "KN", name: "Saint Kitts and Nevis" },
  { code: "LC", name: "Saint Lucia" },
  { code: "VC", name: "Saint Vincent and the Grenadines" },
  { code: "WS", name: "Samoa" },
  { code: "SM", name: "San Marino" },
  { code: "ST", name: "Sao Tome and Principe" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "SN", name: "Senegal" },
  { code: "RS", name: "Serbia" },
  { code: "SC", name: "Seychelles" },
  { code: "SL", name: "Sierra Leone" },
  { code: "SG", name: "Singapore" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "SB", name: "Solomon Islands" },
  { code: "SO", name: "Somalia" },
  { code: "ZA", name: "South Africa" },
  { code: "SS", name: "South Sudan" },
  { code: "ES", name: "Spain" },
  { code: "LK", name: "Sri Lanka" },
  { code: "SD", name: "Sudan" },
  { code: "SR", name: "Suriname" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "SY", name: "Syria" },
  { code: "TW", name: "Taiwan" },
  { code: "TJ", name: "Tajikistan" },
  { code: "TZ", name: "Tanzania" },
  { code: "TH", name: "Thailand" },
  { code: "TL", name: "Timor-Leste" },
  { code: "TG", name: "Togo" },
  { code: "TO", name: "Tonga" },
  { code: "TT", name: "Trinidad and Tobago" },
  { code: "TN", name: "Tunisia" },
  { code: "TR", name: "Turkey" },
  { code: "TM", name: "Turkmenistan" },
  { code: "TV", name: "Tuvalu" },
  { code: "UG", name: "Uganda" },
  { code: "UA", name: "Ukraine" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "UY", name: "Uruguay" },
  { code: "UZ", name: "Uzbekistan" },
  { code: "VU", name: "Vanuatu" },
  { code: "VA", name: "Vatican City" },
  { code: "VE", name: "Venezuela" },
  { code: "VN", name: "Vietnam" },
  { code: "YE", name: "Yemen" },
  { code: "ZM", name: "Zambia" },
  { code: "ZW", name: "Zimbabwe" },
];

// Key operational regional hierarchies (Subdivisions & Cities)
const REGIONAL_HIERARCHIES = [
  // ── NIGERIA ──
  {
    countryCode: "NG",
    subdivisions: [
      {
        code: "NG-LA",
        name: "Lagos State",
        cities: [
          { code: "NG-LOS", name: "Lagos City" },
          { code: "NG-IKJ", name: "Ikeja" },
          { code: "NG-LEK", name: "Lekki" },
          { code: "NG-VI", name: "Victoria Island" },
        ],
      },
      {
        code: "NG-FC",
        name: "Federal Capital Territory",
        cities: [
          { code: "NG-ABJ", name: "Abuja" },
          { code: "NG-GWG", name: "Gwagwalada" },
        ],
      },
      {
        code: "NG-RI",
        name: "Rivers State",
        cities: [{ code: "NG-PHC", name: "Port Harcourt" }],
      },
      {
        code: "NG-KN",
        name: "Kano State",
        cities: [{ code: "NG-KAN", name: "Kano City" }],
      },
      {
        code: "NG-OY",
        name: "Oyo State",
        cities: [{ code: "NG-IBD", name: "Ibadan" }],
      },
      {
        code: "NG-ED",
        name: "Edo State",
        cities: [{ code: "NG-BNN", name: "Benin City" }],
      },
      {
        code: "NG-EN",
        name: "Enugu State",
        cities: [{ code: "NG-ENU", name: "Enugu City" }],
      },
      {
        code: "NG-OG",
        name: "Ogun State",
        cities: [{ code: "NG-ABK", name: "Abeokuta" }],
      },
      {
        code: "NG-KD",
        name: "Kaduna State",
        cities: [{ code: "NG-KAD", name: "Kaduna City" }],
      },
      {
        code: "NG-DT",
        name: "Delta State",
        cities: [{ code: "NG-WAR", name: "Warri" }, { code: "NG-ASA", name: "Asaba" }],
      },
    ],
  },

  // ── UNITED KINGDOM ──
  {
    countryCode: "GB",
    subdivisions: [
      {
        code: "GB-ENG",
        name: "England",
        cities: [
          { code: "GB-LON", name: "London" },
          { code: "GB-MAN", name: "Manchester" },
          { code: "GB-BIR", name: "Birmingham" },
          { code: "GB-LEE", name: "Leeds" },
        ],
      },
      {
        code: "GB-SCT",
        name: "Scotland",
        cities: [
          { code: "GB-EDI", name: "Edinburgh" },
          { code: "GB-GLA", name: "Glasgow" },
        ],
      },
      {
        code: "GB-WLS",
        name: "Wales",
        cities: [{ code: "GB-CRD", name: "Cardiff" }],
      },
      {
        code: "GB-NIR",
        name: "Northern Ireland",
        cities: [{ code: "GB-BFS", name: "Belfast" }],
      },
    ],
  },

  // ── UNITED STATES ──
  {
    countryCode: "US",
    subdivisions: [
      {
        code: "US-NY",
        name: "New York",
        cities: [{ code: "US-NYC", name: "New York City" }, { code: "US-BUF", name: "Buffalo" }],
      },
      {
        code: "US-CA",
        name: "California",
        cities: [
          { code: "US-LAX", name: "Los Angeles" },
          { code: "US-SFO", name: "San Francisco" },
          { code: "US-SAN", name: "San Diego" },
        ],
      },
      {
        code: "US-TX",
        name: "Texas",
        cities: [{ code: "US-HOU", name: "Houston" }, { code: "US-AUS", name: "Austin" }, { code: "US-DAL", name: "Dallas" }],
      },
      {
        code: "US-FL",
        name: "Florida",
        cities: [{ code: "US-MIA", name: "Miami" }, { code: "US-ORL", name: "Orlando" }],
      },
      {
        code: "US-IL",
        name: "Illinois",
        cities: [{ code: "US-CHI", name: "Chicago" }],
      },
      {
        code: "US-GA",
        name: "Georgia",
        cities: [{ code: "US-ATL", name: "Atlanta" }],
      },
    ],
  },

  // ── UNITED ARAB EMIRATES ──
  {
    countryCode: "AE",
    subdivisions: [
      {
        code: "AE-DXB",
        name: "Dubai",
        cities: [{ code: "AE-DXBC", name: "Dubai City" }],
      },
      {
        code: "AE-AUH",
        name: "Abu Dhabi",
        cities: [{ code: "AE-AUHC", name: "Abu Dhabi City" }],
      },
      {
        code: "AE-SHJ",
        name: "Sharjah",
        cities: [{ code: "AE-SHJC", name: "Sharjah City" }],
      },
    ],
  },

  // ── SAUDI ARABIA ──
  {
    countryCode: "SA",
    subdivisions: [
      {
        code: "SA-01",
        name: "Riyadh Region",
        cities: [{ code: "SA-RUH", name: "Riyadh" }],
      },
      {
        code: "SA-02",
        name: "Makkah Region",
        cities: [{ code: "SA-JED", name: "Jeddah" }, { code: "SA-MAK", name: "Mecca" }],
      },
      {
        code: "SA-04",
        name: "Eastern Province",
        cities: [{ code: "SA-DMM", name: "Dammam" }, { code: "SA-KHB", name: "Khobar" }],
      },
    ],
  },

  // ── GHANA ──
  {
    countryCode: "GH",
    subdivisions: [
      {
        code: "GH-AA",
        name: "Greater Accra Region",
        cities: [{ code: "GH-ACC", name: "Accra" }, { code: "GH-TEM", name: "Tema" }],
      },
      {
        code: "GH-AH",
        name: "Ashanti Region",
        cities: [{ code: "GH-KMS", name: "Kumasi" }],
      },
    ],
  },

  // ── KENYA ──
  {
    countryCode: "KE",
    subdivisions: [
      {
        code: "KE-30",
        name: "Nairobi County",
        cities: [{ code: "KE-NBI", name: "Nairobi City" }],
      },
      {
        code: "KE-28",
        name: "Mombasa County",
        cities: [{ code: "KE-MBA", name: "Mombasa City" }],
      },
    ],
  },

  // ── SOUTH AFRICA ──
  {
    countryCode: "ZA",
    subdivisions: [
      {
        code: "ZA-GP",
        name: "Gauteng",
        cities: [{ code: "ZA-JNB", name: "Johannesburg" }, { code: "ZA-PRY", name: "Pretoria" }],
      },
      {
        code: "ZA-WC",
        name: "Western Cape",
        cities: [{ code: "ZA-CPT", name: "Cape Town" }],
      },
      {
        code: "ZA-KZN",
        name: "KwaZulu-Natal",
        cities: [{ code: "ZA-DUR", name: "Durban" }],
      },
    ],
  },

  // ── CANADA ──
  {
    countryCode: "CA",
    subdivisions: [
      {
        code: "CA-ON",
        name: "Ontario",
        cities: [{ code: "CA-TOR", name: "Toronto" }, { code: "CA-OTT", name: "Ottawa" }],
      },
      {
        code: "CA-QC",
        name: "Quebec",
        cities: [{ code: "CA-MTL", name: "Montreal" }],
      },
      {
        code: "CA-BC",
        name: "British Columbia",
        cities: [{ code: "CA-VAN", name: "Vancouver" }],
      },
    ],
  },
];

async function seed() {
  const uri = process.env.DATABASE_URI;
  if (!uri) {
    console.error("No DATABASE_URI provided in environment.");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(uri);
  console.log("Connected successfully.");

  let continentCount = 0;
  let countryCount = 0;
  let subdivisionCount = 0;
  let cityCount = 0;

  // 1. Seed Continents
  console.log(`Seeding ${CONTINENTS.length} continents...`);
  const continentMap = new Map(); // code -> document

  for (const cont of CONTINENTS) {
    const doc = await GeographicLocation.findOneAndUpdate(
      { code: cont.code.toUpperCase() },
      {
        $set: {
          name: cont.name,
          code: cont.code.toUpperCase(),
          kind: "continent",
          parent: null,
          ancestors: [],
          active: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    continentMap.set(cont.code.toUpperCase(), doc);
    continentCount++;
  }

  // 2. Seed Countries with Continent parent
  console.log(`Seeding ${ALL_COUNTRIES.length} countries under continents...`);
  const countryMap = new Map(); // code -> document

  for (const c of ALL_COUNTRIES) {
    const continentCode = COUNTRY_CONTINENT_MAP[c.code.toUpperCase()] || "CONT-AF";
    const continent = continentMap.get(continentCode);

    const doc = await GeographicLocation.findOneAndUpdate(
      { code: c.code.toUpperCase() },
      {
        $set: {
          name: c.name,
          code: c.code.toUpperCase(),
          kind: "country",
          parent: continent ? continent._id : null,
          ancestors: continent ? [continent._id] : [],
          active: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    countryMap.set(c.code.toUpperCase(), doc);
    countryCount++;
  }

  // 3. Seed Subdivisions and Cities
  console.log("Seeding regional hierarchies (subdivisions and cities)...");
  for (const group of REGIONAL_HIERARCHIES) {
    const country = countryMap.get(group.countryCode.toUpperCase());
    if (!country) {
      console.warn(`Country not found for code: ${group.countryCode}`);
      continue;
    }

    const continentId = country.parent;
    const countryAncestors = continentId ? [continentId, country._id] : [country._id];

    for (const sub of group.subdivisions) {
      const subDoc = await GeographicLocation.findOneAndUpdate(
        { code: sub.code.toUpperCase() },
        {
          $set: {
            name: sub.name,
            code: sub.code.toUpperCase(),
            kind: "subdivision",
            parent: country._id,
            ancestors: countryAncestors,
            active: true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      subdivisionCount++;

      if (Array.isArray(sub.cities)) {
        for (const city of sub.cities) {
          const cityAncestors = [...countryAncestors, subDoc._id];
          await GeographicLocation.findOneAndUpdate(
            { code: city.code.toUpperCase() },
            {
              $set: {
                name: city.name,
                code: city.code.toUpperCase(),
                kind: "city",
                parent: subDoc._id,
                ancestors: cityAncestors,
                active: true,
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          cityCount++;
        }
      }
    }
  }

  const totalInDb = await GeographicLocation.countDocuments();

  console.log("======================================");
  console.log("Geographic Seeding with Continents Completed!");
  console.log(`- Continents: ${continentCount}`);
  console.log(`- Countries: ${countryCount}`);
  console.log(`- Subdivisions / States / Regions: ${subdivisionCount}`);
  console.log(`- Cities: ${cityCount}`);
  console.log(`- Total Records in Database: ${totalInDb}`);
  console.log("======================================");

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seeding error:", err);
  process.exit(1);
});
