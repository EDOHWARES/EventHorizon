const express = require('express');
const router = express.Router();
const ipWhitelistController = require('../controllers/ipWhitelist.controller');
const authMiddleware = require('../middleware/auth.middleware');
const permissionMiddleware = require('../middleware/permission.middleware');
const {
    validateBody,
    validationSchemas,
} = require('../middleware/validation.middleware');

/**
 * @openapi
 * /api/admin/ip-whitelist:
 *   get:
 *     summary: List webhook destination IP whitelist entries
 *     tags:
 *       - Admin
 *     responses:
 *       200:
 *         description: Whitelist entries for the current organization.
 */
router.get(
    '/',
    authMiddleware,
    permissionMiddleware('manage_organization'),
    ipWhitelistController.listEntries
);

/**
 * @openapi
 * /api/admin/ip-whitelist:
 *   post:
 *     summary: Add a webhook destination IP or CIDR whitelist entry
 *     tags:
 *       - Admin
 *     responses:
 *       201:
 *         description: Whitelist entry created.
 */
router.post(
    '/',
    authMiddleware,
    permissionMiddleware('manage_organization'),
    validateBody(validationSchemas.ipWhitelistEntry),
    ipWhitelistController.createEntry
);

router.patch(
    '/:id',
    authMiddleware,
    permissionMiddleware('manage_organization'),
    validateBody(validationSchemas.ipWhitelistEntryUpdate),
    ipWhitelistController.updateEntry
);

router.delete(
    '/:id',
    authMiddleware,
    permissionMiddleware('manage_organization'),
    ipWhitelistController.deleteEntry
);

module.exports = router;
