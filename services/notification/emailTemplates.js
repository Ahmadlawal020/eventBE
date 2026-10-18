/**
 * Modern, responsive HTML email templates for Munasaba Notifications
 */

const baseEmailLayout = (title, contentHtml) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #0F0F11;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #E2E8F0;
    }
    .wrapper {
      width: 100%;
      background-color: #0F0F11;
      padding: 40px 16px;
      box-sizing: border-box;
    }
    .container {
      max-width: 560px;
      margin: 0 auto;
      background-color: #1A1A1E;
      border: 1px solid #2D2D35;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    .header {
      padding: 32px 32px 24px 32px;
      text-align: center;
      border-bottom: 1px solid #2D2D35;
      background-color: #23232A;
    }
    .logo {
      font-size: 24px;
      font-weight: 800;
      color: #FFFFFF;
      letter-spacing: -0.5px;
      text-decoration: none;
    }
    .content {
      padding: 32px;
    }
    .h1 {
      font-size: 22px;
      font-weight: 700;
      color: #FFFFFF;
      margin: 0 0 16px 0;
      line-height: 1.3;
    }
    .text {
      font-size: 15px;
      line-height: 1.6;
      color: #94A3B8;
      margin: 0 0 20px 0;
    }
    .card {
      background-color: #121215;
      border: 1px solid #2D2D35;
      border-radius: 14px;
      padding: 20px;
      margin: 24px 0;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #23232A;
      font-size: 14px;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      color: #64748B;
    }
    .detail-value {
      color: #FFFFFF;
      font-weight: 600;
      text-align: right;
    }
    .btn-container {
      text-align: center;
      margin: 32px 0 16px 0;
    }
    .btn {
      display: inline-block;
      background-color: #6366F1;
      color: #FFFFFF !important;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 600;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
    }
    .footer {
      padding: 24px 32px;
      text-align: center;
      border-top: 1px solid #23232A;
      font-size: 12px;
      color: #475569;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <span class="logo">Munasaba</span>
      </div>
      <div class="content">
        ${contentHtml}
      </div>
      <div class="footer">
        <p>© ${new Date().getFullYear()} Munasaba. All rights reserved.</p>
        <p>You received this transactional email based on your account activity.</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

/**
 * Ticket Purchase Confirmation Email
 */
const ticketPurchaseTemplate = ({
  attendeeName,
  eventTitle,
  eventDate,
  venueName,
  ticketCount,
  totalAmount,
  bookingReference,
  actionUrl,
}) => {
  const content = `
    <h1 class="h1">Tickets Confirmed! 🎉</h1>
    <p class="text">Hello ${attendeeName || "there"}, your ticket purchase for <strong>${eventTitle}</strong> is confirmed. Your digital ticket is ready in your app.</p>
    
    <div class="card">
      <div class="detail-row">
        <span class="detail-label">Event</span>
        <span class="detail-value">${eventTitle}</span>
      </div>
      ${eventDate ? `<div class="detail-row"><span class="detail-label">Date & Time</span><span class="detail-value">${eventDate}</span></div>` : ""}
      ${venueName ? `<div class="detail-row"><span class="detail-label">Venue</span><span class="detail-value">${venueName}</span></div>` : ""}
      <div class="detail-row">
        <span class="detail-label">Quantity</span>
        <span class="detail-value">${ticketCount} Ticket(s)</span>
      </div>
      ${totalAmount ? `<div class="detail-row"><span class="detail-label">Total Paid</span><span class="detail-value">₦${Number(totalAmount).toLocaleString()}</span></div>` : ""}
      ${bookingReference ? `<div class="detail-row"><span class="detail-label">Reference</span><span class="detail-value">${bookingReference}</span></div>` : ""}
    </div>

    ${actionUrl ? `
    <div class="btn-container">
      <a href="${actionUrl}" class="btn">View My Tickets</a>
    </div>
    ` : ""}
  `;
  return baseEmailLayout("Tickets Confirmed - Munasaba", content);
};

/**
 * Venue Booking Notification Email
 */
const venueBookingTemplate = ({
  recipientName,
  title,
  message,
  venueName,
  bookingDates,
  totalAmount,
  status,
  actionUrl,
  actionText = "View Booking Details",
}) => {
  const content = `
    <h1 class="h1">${title}</h1>
    <p class="text">Hello ${recipientName || "there"}, ${message}</p>
    
    <div class="card">
      <div class="detail-row">
        <span class="detail-label">Venue</span>
        <span class="detail-value">${venueName}</span>
      </div>
      ${bookingDates ? `<div class="detail-row"><span class="detail-label">Dates</span><span class="detail-value">${bookingDates}</span></div>` : ""}
      ${status ? `<div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${status}</span></div>` : ""}
      ${totalAmount ? `<div class="detail-row"><span class="detail-label">Amount</span><span class="detail-value">₦${Number(totalAmount).toLocaleString()}</span></div>` : ""}
    </div>

    ${actionUrl ? `
    <div class="btn-container">
      <a href="${actionUrl}" class="btn">${actionText}</a>
    </div>
    ` : ""}
  `;
  return baseEmailLayout(title, content);
};

/**
 * Ticket Transfer Request & Confirmation Email
 */
const ticketTransferTemplate = ({
  recipientName,
  title,
  message,
  senderName,
  eventTitle,
  actionUrl,
  actionText = "Review Transfer",
}) => {
  const content = `
    <h1 class="h1">${title}</h1>
    <p class="text">Hello ${recipientName || "there"}, ${message}</p>
    
    <div class="card">
      <div class="detail-row">
        <span class="detail-label">Event</span>
        <span class="detail-value">${eventTitle}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">From</span>
        <span class="detail-value">${senderName}</span>
      </div>
    </div>

    ${actionUrl ? `
    <div class="btn-container">
      <a href="${actionUrl}" class="btn">${actionText}</a>
    </div>
    ` : ""}
  `;
  return baseEmailLayout(title, content);
};

/**
 * Staff / Co-Organiser Invitation Email
 */
const invitationTemplate = ({
  recipientName,
  senderName,
  roleName,
  listingNames,
  actionUrl,
}) => {
  const content = `
    <h1 class="h1">You've Been Invited! 🤝</h1>
    <p class="text">Hello ${recipientName || "there"}, <strong>${senderName}</strong> has invited you to collaborate as a <strong>${roleName}</strong> on Munasaba.</p>
    
    <div class="card">
      <div class="detail-row">
        <span class="detail-label">Invited By</span>
        <span class="detail-value">${senderName}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Role</span>
        <span class="detail-value">${roleName}</span>
      </div>
      ${listingNames ? `<div class="detail-row"><span class="detail-label">Assigned To</span><span class="detail-value">${listingNames}</span></div>` : ""}
    </div>

    ${actionUrl ? `
    <div class="btn-container">
      <a href="${actionUrl}" class="btn">View & Accept Invitation</a>
    </div>
    ` : ""}
  `;
  return baseEmailLayout(`Invitation to join as ${roleName} - Munasaba`, content);
};

/**
 * General Announcement or Notification Email
 */
const generalNotificationTemplate = ({
  recipientName,
  title,
  message,
  actionUrl,
  actionText = "Open App",
}) => {
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const content = `
    <h1 class="h1">${escape(title)}</h1>
    <p class="text">Hello ${escape(recipientName || "there")},</p>
    <p class="text">${escape(message).replace(/\n/g, "<br>")}</p>

    ${actionUrl ? `
    <div class="btn-container">
      <a href="${actionUrl}" class="btn">${actionText}</a>
    </div>
    ` : ""}
  `;
  return baseEmailLayout(escape(title), content);
};

module.exports = {
  ticketPurchaseTemplate,
  venueBookingTemplate,
  ticketTransferTemplate,
  invitationTemplate,
  generalNotificationTemplate,
};
