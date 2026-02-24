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

module.exports = {
  signupSchema,
  loginSchema,
  checkUserSchema,
  refreshTokenSchema,
  googleAuthSchema
};
