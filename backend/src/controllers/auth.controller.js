const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/user.model');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret';
const JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'refresh-secret';

const ACCESS_EXPIRES = '1h';
const REFRESH_EXPIRES = '7d';

/**
 * LOGIN
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user)
      return res.status(401).json({ error: 'Invalid credentials' });

    const validPassword = await bcrypt.compare(
      password,
      user.password
    );

    if (!validPassword)
      return res.status(401).json({ error: 'Invalid credentials' });

    const accessToken = jwt.sign(
      { id: user._id, email: user.email },
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

    const accessToken = jwt.sign(
      { id: decoded.id },
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