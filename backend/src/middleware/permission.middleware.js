module.exports = function(permission) {
  return function(req, res, next) {
    if (!req.user || !req.user.permissions) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.user.permissions.includes(permission)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};