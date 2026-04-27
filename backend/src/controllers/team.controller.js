const User = require('../models/user.model');
const Role = require('../models/role.model');
const Organization = require('../models/organization.model');
const logger = require('../config/logger');
const AppError = require('../utils/appError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * GET TEAM MEMBERS
 */
exports.getTeamMembers = asyncHandler(async (req, res) => {
  const users = await User.find({
    organization: req.user.organization._id,
    isActive: true,
  })
    .populate('role', 'name permissions')
    .select('firstName lastName email role createdAt')
    .sort({ createdAt: -1 });

  res.json({
    success: true,
    data: users,
  });
});

/**
 * UPDATE USER ROLE
 */
exports.updateUserRole = asyncHandler(async (req, res) => {
  const { userId, roleId } = req.body;

  // Check if target user exists in organization
  const user = await User.findOne({
    _id: userId,
    organization: req.user.organization._id,
    isActive: true,
  });
  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Check if role exists in organization
  const role = await Role.findOne({
    _id: roleId,
    organization: req.user.organization._id,
  });
  if (!role) {
    throw new AppError('Role not found', 404);
  }

  // Cannot change own role if not owner
  if (userId === req.user.id && req.user.role.name !== 'Owner') {
    throw new AppError('Cannot change your own role', 403);
  }

  user.role = roleId;
  await user.save();

  await user.populate('role', 'name permissions');

  logger.info('User role updated', {
    userId,
    newRole: role.name,
    updatedBy: req.user.id,
  });

  res.json({
    success: true,
    data: user,
  });
});

/**
 * REMOVE USER FROM ORGANIZATION
 */
exports.removeUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const user = await User.findOne({
    _id: userId,
    organization: req.user.organization._id,
    isActive: true,
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Cannot remove yourself
  if (userId === req.user.id) {
    throw new AppError('Cannot remove yourself', 403);
  }

  // Cannot remove owner
  if (user.role.name === 'Owner') {
    throw new AppError('Cannot remove owner', 403);
  }

  user.isActive = false;
  await user.save();

  logger.info('User removed from organization', {
    userId,
    removedBy: req.user.id,
  });

  res.json({
    success: true,
    message: 'User removed successfully',
  });
});

/**
 * GET ROLES
 */
exports.getRoles = asyncHandler(async (req, res) => {
  const roles = await Role.find({
    organization: req.user.organization._id,
  }).select('name description permissions isSystem');

  res.json({
    success: true,
    data: roles,
  });
});

/**
 * CREATE ROLE
 */
exports.createRole = asyncHandler(async (req, res) => {
  const { name, description, permissions } = req.body;

  const role = new Role({
    name,
    description,
    permissions,
    organization: req.user.organization._id,
  });

  await role.save();

  logger.info('Role created', {
    roleId: role._id,
    name,
    createdBy: req.user.id,
  });

  res.status(201).json({
    success: true,
    data: role,
  });
});

/**
 * UPDATE ROLE
 */
exports.updateRole = asyncHandler(async (req, res) => {
  const { name, description, permissions } = req.body;

  const role = await Role.findOne({
    _id: req.params.id,
    organization: req.user.organization._id,
    isSystem: false, // Cannot modify system roles
  });

  if (!role) {
    throw new AppError('Role not found or cannot be modified', 404);
  }

  role.name = name;
  role.description = description;
  role.permissions = permissions;

  await role.save();

  logger.info('Role updated', {
    roleId: role._id,
    name,
    updatedBy: req.user.id,
  });

  res.json({
    success: true,
    data: role,
  });
});

/**
 * DELETE ROLE
 */
exports.deleteRole = asyncHandler(async (req, res) => {
  const role = await Role.findOne({
    _id: req.params.id,
    organization: req.user.organization._id,
    isSystem: false,
  });

  if (!role) {
    throw new AppError('Role not found or cannot be deleted', 404);
  }

  // Check if any users have this role
  const usersWithRole = await User.countDocuments({
    role: role._id,
    isActive: true,
  });

  if (usersWithRole > 0) {
    throw new AppError('Cannot delete role with active users', 400);
  }

  await Role.deleteOne({ _id: role._id });

  logger.info('Role deleted', {
    roleId: role._id,
    deletedBy: req.user.id,
  });

  res.status(204).send();
});