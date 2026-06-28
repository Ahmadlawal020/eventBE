const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.EMAIL_FROM || "Munasaba <onboarding@resend.dev>";

/**
 * Send an email via Resend
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML body
 * @returns {Promise<Object>} Resend API response
 */
async function sendEmail({ to, subject, html }) {
  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    html,
  });

  if (error) {
    throw new Error(`Resend email error: ${error.message}`);
  }

  return data;
}

module.exports = { sendEmail };
