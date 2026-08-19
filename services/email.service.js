const { Resend } = require("resend");

let resendInstance = null;

function getResendClient() {
  if (!resendInstance) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn("[EMAIL SERVICE] RESEND_API_KEY is not configured in environment.");
      return null;
    }
    resendInstance = new Resend(apiKey);
  }
  return resendInstance;
}

const FROM_EMAIL = process.env.EMAIL_FROM || "Munasaba <onboarding@resend.dev>";

/**
 * Send an email via Resend
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML body
 * @returns {Promise<Object>} Resend API response or null
 */
async function sendEmail({ to, subject, html }) {
  const client = getResendClient();
  if (!client) {
    console.warn(`[EMAIL SERVICE] Skipping email to ${to}: Resend client not initialized.`);
    return null;
  }

  const { data, error } = await client.emails.send({
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
