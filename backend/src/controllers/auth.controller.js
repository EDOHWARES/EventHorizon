const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const Organization = require('../models/organization.model');
const Role = require('../models/role.model');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret';
const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'refresh-secret';

const ACCESS_EXPIRES = '1h';
const REFRESH_EXPIRES = '7d';

/**
 * REGISTER
 */
exports.register = async (req, res) => {
  try {
    const { email, password, firstName, lastName, organizationName } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Create organization
    const organization = new Organization({
      name: organizationName,
      createdBy: null, // Will set after user creation
    });
    await organization.save();

    // Create default roles
    const ownerRole = new Role({
      name: 'Owner',
      description: 'Full access to organization',
      permissions: ['create_trigger', 'read_trigger', 'update_trigger', 'delete_trigger', 'manage_users', 'manage_organization', 'view_audit_logs'],
      organization: organization._id,
      isSystem: true,
    });
    await ownerRole.save();

    const memberRole = new Role({
      name: 'Member',
      description: 'Can manage triggers',
      permissions: ['create_trigger', 'read_trigger', 'update_trigger', 'delete_trigger'],
      organization: organization._id,
      isSystem: true,
    });
    await memberRole.save();

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      organization: organization._id,
      role: ownerRole._id,
    });
    await user.save();

    // Update organization createdBy
    organization.createdBy = user._id;
    await organization.save();

    // Generate token
    const accessToken = jwt.sign(
      {
        id: user._id,
        email: user.email,
        organization: user.organization,
        role: user.role,
        permissions: ownerRole.permissions
      },
      JWT_SECRET,
      { expiresIn: ACCESS_EXPIRES }
    );

    const refreshToken = jwt.sign(
      { id: user._id },
      JWT_REFRESH_SECRET,
      { expiresIn: REFRESH_EXPIRES }
    );

    res.status(201).json({
      token: accessToken,
      refreshToken,
      expiresIn: 3600,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        organization: {
          id: organization._id,
          name: organization.name,
        },
        role: {
          id: ownerRole._id,
          name: ownerRole.name,
          permissions: ownerRole.permissions,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * LOGIN
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).populate('organization role');

    if (!user || !user.isActive)
      return res.status(401).json({ error: 'Invalid credentials' });

    const validPassword = await bcrypt.compare(
      password,
      user.password
    );

    if (!validPassword)
      return res.status(401).json({ error: 'Invalid credentials' });

    const accessToken = jwt.sign(
      {
        id: user._id,
        email: user.email,
        organization: user.organization._id,
        role: user.role._id,
        permissions: user.role.permissions
      },
      JWT_SECRET,
      { expiresIn: ACCESS_EXPIRES }
    );

    const refreshToken = jwt.sign(
      { id: user._id },
      JWT_REFRESH_SECRET,
      { expiresIn: REFRESH_EXPIRES }
    );

    res.json({
      token: accessToken,
      refreshToken,
      expiresIn: 3600,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        organization: {
          id: user.organization._id,
          name: user.organization.name,
        },
        role: {
          id: user.role._id,
          name: user.role.name,
          permissions: user.role.permissions,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * REFRESH TOKEN
 */
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken)
      return res.status(401).json({ error: 'Missing refresh token' });

    const decoded = jwt.verify(
      refreshToken,
      JWT_REFRESH_SECRET
    );

    const user = await User.findById(decoded.id).populate('organization role');
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    const accessToken = jwt.sign(
      {
        id: user._id,
        email: user.email,
        organization: user.organization._id,
        role: user.role._id,
        permissions: user.role.permissions
      },
      JWT_SECRET,
      { expiresIn: ACCESS_EXPIRES }
    );

    res.json({
      token: accessToken,
      expiresIn: 3600,
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
};