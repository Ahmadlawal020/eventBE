const Joi = require('joi');

const signupSchema = Joi.object({
  firstName: Joi.string().min(2).max(50).required(),
  surname: Joi.string().min(2).max(50).required(),
  email: Joi.string().trim().lowercase().email().required(),
  password: Joi.string().min(6).when('authProvider', { is: 'local', then: Joi.required(), otherwise: Joi.optional() }),
  dob: Joi.date().required(),
  authProvider: Joi.string().valid('local', 'google').default('local'),
  googleId: Joi.string().allow(null, ''),
  referralCode: Joi.string().trim().max(64).allow('').optional(),
  googleSignupToken: Joi.string().when('authProvider', {
    is: 'google', then: Joi.required(), otherwise: Joi.forbidden(),
  }),
});

const loginSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
  password: Joi.string().required()
});

const checkUserSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required()
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required()
});

const googleAuthSchema = Joi.object({
  idToken: Joi.string(),
  code: Joi.string(),
  codeVerifier: Joi.string(),
  redirectUri: Joi.string().optional().allow(null, ""),
}).xor('idToken', 'code').with('code', 'codeVerifier');

const otpRequestSchema = Joi.object({
  identifier: Joi.string().required(),
  type: Joi.string().valid('email', 'phone', 'password_change').required()
});

const otpVerifySchema = Joi.object({
  identifier: Joi.string().required(),
  code: Joi.string().length(6).required(),
  type: Joi.string().valid('email', 'phone', 'password_change').required()
});

const passwordChangeRequestSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required()
});

const updatePasswordSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
  code: Joi.string().length(6).required(),
  newPassword: Joi.string().min(6).required()
});

const sendMessageSchema = Joi.object({
  content: Joi.string().trim().min(1).max(2000).required(),
  conversationId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional().allow(null, ""),
  contextType: Joi.string().valid("Event", "EventCenter").when("conversationId", {
    is: Joi.string().pattern(/^[0-9a-fA-F]{24}$/),
    then: Joi.optional().allow(null, ""),
    otherwise: Joi.required(),
  }),
  contextId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).when("conversationId", {
    is: Joi.string().pattern(/^[0-9a-fA-F]{24}$/),
    then: Joi.optional().allow(null, ""),
    otherwise: Joi.required(),
  }),
});

const sendStaffMessageSchema = Joi.object({
  content: Joi.string().trim().min(1).max(2000).required(),
  conversationId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
  contextType: Joi.string().valid("Event", "EventCenter").optional().allow(null, ""),
  contextId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional().allow(null, ""),
});

module.exports = {
  signupSchema,
  loginSchema,
  checkUserSchema,
  refreshTokenSchema,
  googleAuthSchema,
  otpRequestSchema,
  otpVerifySchema,
  passwordChangeRequestSchema,
  updatePasswordSchema,
  sendMessageSchema,
  sendStaffMessageSchema,
};
