const crypto = require('crypto');
const Invitation = require('../models/invitation.model');
const User = require('../models/user.model');
const Role = require('../models/role.model');
const Organization = require('../models/organization.model');
const logger = require('../config/logger');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret';

/**
 * INVITE USER
 */
exports.inviteUser = asyncHandler(async (req, res) => {
  const { email, roleId } = req.body;

  // Check if role exists and belongs to organization
  const role = await Role.findOne({
    _id: roleId,
    organization: req.user.organization._id,
  });
  if (!role) {
    throw new AppError('Invalid role', 400);
  }

  // Check if invitation already exists
  const existingInvitation = await Invitation.findOne({
    email,
    organization: req.user.organization._id,
    status: 'pending',
  });
  if (existingInvitation) {
    throw new AppError('Invitation already sent', 400);
  }

  // Check if user already in organization
  const existingUser = await User.findOne({
    email,
    organization: req.user.organization._id,
  });
  if (existingUser) {
    throw new AppError('User already in organization', 400);
  }

  // Generate token
  const token = crypto.randomBytes(32).toString('hex');

  const invitation = new Invitation({
    email,
    organization: req.user.organization._id,
    role: roleId,
    invitedBy: req.user.id,
    token,
  });

  await invitation.save();

  // TODO: Send email with invitation link
  // For now, just return the token

  logger.info('User invited', {
    email,
    organizationId: req.user.organization._id,
    invitedBy: req.user.id,
  });

  res.status(201).json({
    success: true,
    data: {
      id: invitation._id,
      email: invitation.email,
      role: role.name,
      token: invitation.token, // In production, send via email
      expiresAt: invitation.expiresAt,
    },
  });
});

/**
 * ACCEPT INVITATION
 */
exports.acceptInvitation = asyncHandler(async (req, res) => {
  const { token, password, firstName, lastName } = req.body;

  const invitation = await Invitation.findOne({
    token,
    status: 'pending',
  }).populate('organization role');

  if (!invitation || invitation.expiresAt < new Date()) {
    throw new AppError('Invalid or expired invitation', 400);
  }

  // Check if user already exists
  const existingUser = await User.findOne({ email: invitation.email });
  if (existingUser) {
    throw new AppError('User already exists', 400);
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Create user
  const user = new User({
    email: invitation.email,
    password: hashedPassword,
    firstName,
    lastName,
    organization: invitation.organization._id,
    role: invitation.role._id,
  });

  await user.save();

  // Update invitation
  invitation.status = 'accepted';
  await invitation.save();

  // Generate token
  const accessToken = jwt.sign(
    {
      id: user._id,
      email: user.email,
      organization: user.organization,
      role: user.role,
      permissions: invitation.role.permissions,
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  logger.info('Invitation accepted', {
    email: invitation.email,
    organizationId: invitation.organization._id,
  });

  res.json({
    token: accessToken,
    expiresIn: 3600,
    user: {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      organization: {
        id: invitation.organization._id,
        name: invitation.organization.name,
      },
      role: {
        id: invitation.role._id,
        name: invitation.role.name,
        permissions: invitation.role.permissions,
      },
    },
  });
});

/**
 * GET INVITATIONS
 */
exports.getInvitations = asyncHandler(async (req, res) => {
  const invitations = await Invitation.find({
    organization: req.user.organization._id,
  })
    .populate('role', 'name')
    .populate('invitedBy', 'firstName lastName email')
    .sort({ createdAt: -1 });

  res.json({
    success: true,
    data: invitations,
  });
});

/**
 * CANCEL INVITATION
 */
exports.cancelInvitation = asyncHandler(async (req, res) => {
  const invitation = await Invitation.findOneAndUpdate(
    {
      _id: req.params.id,
      organization: req.user.organization._id,
      status: 'pending',
    },
    { status: 'cancelled' },
    { new: true }
  );

  if (!invitation) {
    throw new AppError('Invitation not found', 404);
  }

  res.json({
    success: true,
    data: invitation,
  });
});