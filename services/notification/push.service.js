const axios = require("axios");

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK_SIZE = 100;

/**
 * Validates whether a given string is a valid Expo push token.
 * @param {string} token
 * @returns {boolean}
 */
const isExpoPushToken = (token) => {
  if (!token || typeof token !== "string") return false;
  return (
    token.startsWith("ExponentPushToken[") ||
    token.startsWith("ExpoPushToken[") ||
    /^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}$/i.test(token)
  );
};

/**
 * Splits an array into chunks of a specified size.
 * @param {Array} array
 * @param {number} size
 * @returns {Array[]}
 */
const chunkArray = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

/**
 * Send push notifications to one or multiple push tokens.
 *
 * @param {Object} options
 * @param {string[]|string} options.tokens - Single token or array of Expo push tokens
 * @param {string} options.title - Notification title
 * @param {string} options.body - Notification body
 * @param {Object} [options.data] - Custom data payload for navigation & context
 * @param {string} [options.sound="default"] - Notification sound
 * @param {number} [options.badge] - Application icon badge number
 * @param {string} [options.priority="high"] - 'default' | 'normal' | 'high'
 * @param {string} [options.channelId="default"] - Android notification channel
 * @returns {Promise<{ successCount: number, failureCount: number, invalidTokens: string[], errors: any[] }>}
 */
const sendPushNotifications = async ({
  tokens,
  title,
  body,
  data = {},
  sound = "default",
  badge,
  priority = "high",
  channelId = "default",
}) => {
  const tokenList = Array.isArray(tokens) ? tokens : [tokens];
  const validTokens = tokenList.filter(isExpoPushToken);

  if (validTokens.length === 0) {
    return {
      successCount: 0,
      failureCount: tokenList.length,
      invalidTokens: tokenList.filter((t) => !isExpoPushToken(t)),
      errors: tokenList.length > 0 ? ["No valid Expo push tokens provided"] : [],
    };
  }

  const messages = validTokens.map((to) => {
    const msg = {
      to,
      title,
      body,
      data,
      sound,
      priority,
      channelId,
      _displayInForeground: true,
    };
    if (typeof badge === "number") {
      msg.badge = badge;
    }
    return msg;
  });

  const chunks = chunkArray(messages, CHUNK_SIZE);
  let successCount = 0;
  let failureCount = 0;
  const invalidTokens = [];
  const errors = [];

  for (const chunk of chunks) {
    try {
      const response = await axios.post(EXPO_PUSH_URL, chunk, {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        timeout: 10000,
      });

      const tickets = response.data?.data || [];
      tickets.forEach((ticket, idx) => {
        const correspondingToken = chunk[idx]?.to;
        if (ticket.status === "ok") {
          successCount++;
        } else {
          failureCount++;
          const errorMsg = ticket.message || ticket.details?.error || "Unknown push error";
          errors.push({ token: correspondingToken, error: errorMsg });

          // DeviceNotRegistered means the token is no longer active/valid
          if (ticket.details?.error === "DeviceNotRegistered") {
            if (correspondingToken) invalidTokens.push(correspondingToken);
          }
        }
      });
    } catch (err) {
      console.error("[PUSH SERVICE ERROR]", err?.response?.data || err.message);
      failureCount += chunk.length;
      errors.push({ chunkTokens: chunk.map((c) => c.to), error: err.message });
    }
  }

  return {
    successCount,
    failureCount,
    invalidTokens,
    errors,
  };
};

module.exports = {
  isExpoPushToken,
  sendPushNotifications,
};
