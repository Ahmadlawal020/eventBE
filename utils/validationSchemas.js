const Joi = require('joi');

const signupSchema = Joi.object({
  firstName: Joi.string().min(2).max(50).required(),
  surname: Joi.string().min(2).max(50).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).when('authProvider', { is: 'local', then: Joi.required(), otherwise: Joi.optional() }),
  dob: Joi.date().required(),
  authProvider: Joi.string().valid('local', 'google').default('local'),
  googleId: Joi.string().allow(null, '')
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const checkUserSchema = Joi.object({
  email: Joi.string().email().required()
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required()
});

const googleAuthSchema = Joi.object({
  code: Joi.string().required(),
  codeVerifier: Joi.string().required()
});

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
  email: Joi.string().email().required()
});

const updatePasswordSchema = Joi.object({
  email: Joi.string().email().required(),
  code: Joi.string().length(6).required(),
  newPassword: Joi.string().min(6).required()
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
  updatePasswordSchema
};
