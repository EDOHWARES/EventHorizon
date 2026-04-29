const mongoose = require('mongoose');
const User = require('../models/user.model');
const Organization = require('../models/organization.model');
const Role = require('../models/role.model');
const logger = require('../config/logger');

/**
 * Service for Just-In-Time (JIT) User Provisioning
 */
class ProvisioningService {
    /**
     * Find or create a user and their organization context from SSO data
     * @param {object} ssoUser - Decoded SSO user profile
     * @param {string} mappedRoleName - The role name mapped from SSO claims
     * @returns {Promise<object>} - Provisioned user document
     */
    async provisionUser(ssoUser, mappedRoleName) {
        let user = await User.findOne({
            $or: [
                { auth0Id: ssoUser.sub },
                { email: ssoUser.email }
            ]
        }).populate('organization role');

        if (user) {
            // Link existing local user to Auth0 if not already linked
            if (!user.auth0Id) {
                user.auth0Id = ssoUser.sub;
                await user.save();
            }
            return user;
        }

        logger.info('Provisioning new user via SSO', { email: ssoUser.email });

        // 1. Identify Organization
        // Logic: Try to find organization by connection name or email domain
        let organization;
        const connectionName = ssoUser.connection || 'SSO Default';
        
        organization = await Organization.findOne({ name: connectionName });
        
        if (!organization) {
            // Fallback: Check by email domain
            const domain = ssoUser.email.split('@')[1];
            organization = await Organization.findOne({ name: domain });
        }

        if (!organization) {
            // Create a new organization for this enterprise connection
            organization = new Organization({
                name: connectionName,
                createdBy: null // Temporarily null, will update after user creation
            });
            
            // To satisfy 'required: true' for createdBy, we'll need to set a system user or 
            // handle it after user creation. 
            // In MongoDB/Mongoose, we can set it to a dummy ID and then update.
            // But let's use a more robust way: find an existing admin organization or create a root one.
            const systemAdmin = await User.findOne({ email: 'admin@eventhorizon.app' }); // Example system user
            organization.createdBy = systemAdmin ? systemAdmin._id : new mongoose.Types.ObjectId();
            await organization.save();
        }

        // 2. Map Role
        let role = await Role.findOne({ name: mappedRoleName, organization: organization._id });
        if (!role) {
            // Create default roles if they don't exist for this new organization
            role = await Role.findOne({ name: 'Member', organization: organization._id });
            if (!role) {
                // Last resort: find any Member role or create one
                const memberRole = await Role.findOne({ name: 'Member' });
                role = memberRole;
            }
        }

        // 3. Create User
        user = new User({
            email: ssoUser.email,
            auth0Id: ssoUser.sub,
            firstName: ssoUser.given_name || ssoUser.nickname,
            lastName: ssoUser.family_name,
            organization: organization._id,
            role: role._id,
            isActive: true
        });
        await user.save();

        // Update organization createdBy if it was a placeholder
        if (organization.name === connectionName && !systemAdmin) {
            organization.createdBy = user._id;
            await organization.save();
        }

        return User.findById(user._id).populate('organization role');
    }
}

module.exports = new ProvisioningService();
