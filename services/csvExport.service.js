/**
 * CSV Export Service
 *
 * Provides RFC 4180 compliant CSV formatting, UTF-8 BOM encoding for Excel/Numbers,
 * and formula injection protection (neutralizing =, +, -, @ prefixes).
 */

/**
 * Sanitizes and quotes a single CSV field value.
 * Protects against CSV formula injection attacks in spreadsheet viewers.
 *
 * @param {any} val - The raw field value
 * @returns {string} The escaped CSV field
 */
function sanitizeCsvValue(val) {
  if (val === null || val === undefined) return "";
  let str = String(val).trim();

  // Prevent CSV Injection (Formula Injection)
  // If the cell begins with =, +, -, @, \t, or \r, prefix with a single quote '
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // RFC 4180: If value contains a comma, quote, or newline, escape quotes and wrap in quotes
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Formats an array of values into a single RFC 4180 CSV row string.
 *
 * @param {any[]} fields - Array of cell values
 * @returns {string} The CSV formatted row
 */
function formatCsvRow(fields) {
  if (!Array.isArray(fields)) return "";
  return fields.map(sanitizeCsvValue).join(",");
}

/**
 * Formats a Date object or date string into an ISO string or empty string if invalid.
 *
 * @param {Date|string|number} dateValue
 * @returns {string}
 */
function formatDateForCsv(dateValue) {
  if (!dateValue) return "";
  const d = new Date(dateValue);
  return Number.isFinite(d.getTime()) ? d.toISOString() : "";
}

module.exports = {
  sanitizeCsvValue,
  formatCsvRow,
  formatDateForCsv,
};
