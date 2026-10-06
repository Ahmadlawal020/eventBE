const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeCsvValue, formatCsvRow, formatDateForCsv } = require("../services/csvExport.service");

test("sanitizeCsvValue escapes commas, quotes, and newlines per RFC 4180", () => {
  // Plain text remains unchanged
  assert.equal(sanitizeCsvValue("VIP Ticket"), "VIP Ticket");

  // Strings with commas are wrapped in quotes
  assert.equal(sanitizeCsvValue("Lagos, Nigeria"), '"Lagos, Nigeria"');

  // Strings with double quotes have quotes escaped as double quotes
  assert.equal(sanitizeCsvValue('John "The Host" Doe'), '"John ""The Host"" Doe"');

  // Strings with newlines are wrapped in quotes
  assert.equal(sanitizeCsvValue("Line 1\nLine 2"), '"Line 1\nLine 2"');
  assert.equal(sanitizeCsvValue("Line 1\r\nLine 2"), '"Line 1\r\nLine 2"');

  // Null and undefined return empty string
  assert.equal(sanitizeCsvValue(null), "");
  assert.equal(sanitizeCsvValue(undefined), "");
});

test("sanitizeCsvValue neutralizes CSV formula injection attacks", () => {
  // Formula starting with =
  assert.equal(sanitizeCsvValue("=SUM(A1:A10)"), "'=SUM(A1:A10)");
  assert.equal(sanitizeCsvValue("=cmd|' /C calc'!A0"), "'=cmd|' /C calc'!A0");

  // Formula starting with = and containing double quotes
  assert.equal(sanitizeCsvValue('="calc"'), `"'=""calc"""`);


  // Formula starting with +
  assert.equal(sanitizeCsvValue("+12345"), "'+12345");

  // Formula starting with -
  assert.equal(sanitizeCsvValue("-2+3"), "'-2+3");

  // Formula starting with @ (and containing comma, which triggers RFC 4180 quotes)
  assert.equal(sanitizeCsvValue("@SUM(1,2)"), '"\'@SUM(1,2)"');
});


test("formatCsvRow serializes an array of values into a valid CSV line", () => {
  const fields = [
    "TKT-001",
    "John Doe",
    "john@example.com",
    "5000",
    "NGN",
    "Lagos, Nigeria",
    "UNREDEEMED",
  ];
  const row = formatCsvRow(fields);
  assert.equal(row, 'TKT-001,John Doe,john@example.com,5000,NGN,"Lagos, Nigeria",UNREDEEMED');
});

test("formatDateForCsv produces ISO dates or empty strings cleanly", () => {
  const d = new Date("2030-05-15T10:30:00.000Z");
  assert.equal(formatDateForCsv(d), "2030-05-15T10:30:00.000Z");
  assert.equal(formatDateForCsv("2030-05-15T10:30:00.000Z"), "2030-05-15T10:30:00.000Z");
  assert.equal(formatDateForCsv(null), "");
  assert.equal(formatDateForCsv("invalid-date"), "");
});
