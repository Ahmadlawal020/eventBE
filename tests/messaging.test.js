const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const User = require("../models/user/user.schema");
const Event = require("../models/user/event.schema");
const Conversation = require("../models/user/conversation.schema");
const Message = require("../models/user/message.schema");
const Notification = require("../models/user/notification.schema");
const { generateAuthToken } = require("./setup");

describe("Messaging & Real-time Communications API (/api/messages & /api/notifications)", () => {
  let hostUser;
  let guestUser;
  let hostToken;
  let guestToken;
  let eventDoc;

  beforeEach(async () => {
    // 1. Create Host User & Token
    hostUser = await User.create({
      firstName: "Host",
      surname: "Organiser",
      email: `host_${Date.now()}@example.com`,
      password: "Password123!",
      phoneNumber: "+2348000000001",
      dob: new Date("1990-01-01"),
      role: "user",
      emailVerified: true,
      authProvider: "local",
    });
    hostToken = generateAuthToken(hostUser);

    // 2. Create Guest User & Token
    guestUser = await User.create({
      firstName: "Guest",
      surname: "Attendee",
      email: `guest_${Date.now()}@example.com`,
      password: "Password123!",
      phoneNumber: "+2348000000002",
      dob: new Date("1995-05-15"),
      role: "user",
      emailVerified: true,
      authProvider: "local",
    });
    guestToken = generateAuthToken(guestUser);

    // 3. Create Event owned by Host
    eventDoc = await Event.create({
      createdBy: hostUser._id,
      title: "Tech Festival 2026",
      eventType: "MUSIC_CONCERTS",
      status: "LISTED",
      location: {
        addressString: "123 Innovation Way",
        city: "Lagos",
        state: "Lagos",
        country: "Nigeria",
      },
      schedule: {
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000),
      },
    });
  });

  it("should allow guest to send a message to event host and create conversation", async () => {
    const res = await request(app)
      .post("/api/messages/send")
      .set("Authorization", `Bearer ${guestToken}`)
      .send({
        contextType: "Event",
        contextId: String(eventDoc._id),
        content: "Hi, will parking be available at the venue?",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.content).toBe("Hi, will parking be available at the venue?");
    expect(res.body.data.sender._id.toString()).toBe(guestUser._id.toString());
    expect(res.body.data.receiver._id.toString()).toBe(hostUser._id.toString());

    // Verify conversation was created
    const conv = await Conversation.findOne({
      participants: { $all: [guestUser._id, hostUser._id] },
      contextId: eventDoc._id,
    });
    expect(conv).not.toBeNull();
    expect(conv.lastMessage).toBeDefined();

    // Verify in-app notification was dispatched to host
    const notif = await Notification.findOne({ recipient: hostUser._id });
    expect(notif).not.toBeNull();
    expect(notif.type).toBe("MESSAGE_RECEIVED");
  });

  it("should prevent host from initiating a conversation with their own listing", async () => {
    const res = await request(app)
      .post("/api/messages/send")
      .set("Authorization", `Bearer ${hostToken}`)
      .send({
        contextType: "Event",
        contextId: String(eventDoc._id),
        content: "Can I talk to myself?",
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain("cannot start conversations with their own listings");
  });

  it("should allow host to reply to an existing guest conversation", async () => {
    // 1. Guest sends first message
    const guestMsgRes = await request(app)
      .post("/api/messages/send")
      .set("Authorization", `Bearer ${guestToken}`)
      .send({
        contextType: "Event",
        contextId: String(eventDoc._id),
        content: "Is there a VIP entrance?",
      });

    expect(guestMsgRes.status).toBe(201);
    const conversationId = guestMsgRes.body.data.conversationId;

    // 2. Host replies using conversationId
    const replyRes = await request(app)
      .post("/api/messages/send")
      .set("Authorization", `Bearer ${hostToken}`)
      .send({
        conversationId,
        content: "Yes, Gate 2 is reserved for VIP ticket holders.",
      });

    expect(replyRes.status).toBe(201);
    expect(replyRes.body.success).toBe(true);
    expect(replyRes.body.data.content).toBe("Yes, Gate 2 is reserved for VIP ticket holders.");
    expect(replyRes.body.data.sender._id.toString()).toBe(hostUser._id.toString());
    expect(replyRes.body.data.receiver._id.toString()).toBe(guestUser._id.toString());
  });

  it("should list conversations for both host and guest with role filtering", async () => {
    // Create initial message
    await request(app)
      .post("/api/messages/send")
      .set("Authorization", `Bearer ${guestToken}`)
      .send({
        contextType: "Event",
        contextId: String(eventDoc._id),
        content: "Hello from guest!",
      });

    // 1. Fetch conversations as organiser
    const hostConvRes = await request(app)
      .get("/api/messages/conversations?role=organiser")
      .set("Authorization", `Bearer ${hostToken}`);

    expect(hostConvRes.status).toBe(200);
    expect(hostConvRes.body.success).toBe(true);
    expect(hostConvRes.body.data.length).toBe(1);
    expect(hostConvRes.body.data[0].lastMessage.content).toBe("Hello from guest!");

    // 2. Fetch conversations as user (guest)
    const guestConvRes = await request(app)
      .get("/api/messages/conversations?role=user")
      .set("Authorization", `Bearer ${guestToken}`);

    expect(guestConvRes.status).toBe(200);
    expect(guestConvRes.body.success).toBe(true);
    expect(guestConvRes.body.data.length).toBe(1);
  });

  it("should fetch messages within conversation and mark messages as read", async () => {
    // 1. Guest sends message
    const msgRes = await request(app)
      .post("/api/messages/send")
      .set("Authorization", `Bearer ${guestToken}`)
      .send({
        contextType: "Event",
        contextId: String(eventDoc._id),
        content: "Message 1 for read verification",
      });

    const conversationId = msgRes.body.data.conversationId;

    // 2. Host fetches messages (should mark incoming guest messages as read)
    const fetchRes = await request(app)
      .get(`/api/messages/conversations/${conversationId}/messages`)
      .set("Authorization", `Bearer ${hostToken}`);

    expect(fetchRes.status).toBe(200);
    expect(fetchRes.body.success).toBe(true);
    expect(fetchRes.body.data.length).toBe(1);
    expect(fetchRes.body.data[0].content).toBe("Message 1 for read verification");

    // 3. Verify message was marked as read in database
    const dbMsg = await Message.findById(msgRes.body.data._id);
    expect(dbMsg.read).toBe(true);
  });

  it("should manage user notification preferences and unread counts", async () => {
    // 1. Create a notification
    await Notification.create({
      recipient: guestUser._id,
      sender: hostUser._id,
      type: "EVENT_REMINDER_24H",
      title: "Schedule Updated",
      message: "The event will start at 10 AM.",
      channels: ["in_app"],
      isRead: false,
    });

    // 2. Get unread count
    const unreadRes = await request(app)
      .get("/api/notifications/unread-count")
      .set("Authorization", `Bearer ${guestToken}`);

    expect(unreadRes.status).toBe(200);
    expect(unreadRes.body.data.unreadCount).toBeGreaterThanOrEqual(1);

    // 3. Mark all as read
    const markRes = await request(app)
      .patch("/api/notifications/read-all")
      .set("Authorization", `Bearer ${guestToken}`);

    expect(markRes.status).toBe(200);
    expect(markRes.body.success).toBe(true);

    // 4. Verify unread count is 0
    const unreadResAfter = await request(app)
      .get("/api/notifications/unread-count")
      .set("Authorization", `Bearer ${guestToken}`);

    expect(unreadResAfter.body.data.unreadCount).toBe(0);
  });
});
