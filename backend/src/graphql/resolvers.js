const Trigger = require('../models/trigger.model');
const AppError = require('../utils/appError');
const { JSONResolver } = require('graphql-scalars');

const resolvers = {
    JSON: JSONResolver,
    Query: {
        triggers: async (_, __, { user }) => {
            if (!user) throw new AppError('Unauthorized', 401);

            return Trigger.find({
                organization: user.organization._id
            });
        },

        trigger: async (_, { id }, { user }) => {
            if (!user) throw new AppError('Unauthorized', 401);

            return Trigger.findOne({
                _id: id,
                organization: user.organization._id
            });
        }
    },

    Mutation: {
        createTrigger: async (_, { input }, { user }) => {
            if (!user) throw new AppError('Unauthorized', 401);

            const trigger = new Trigger({
                ...input,
                organization: user.organization._id,
                createdBy: user.id
            });

            await trigger.save();
            return trigger;
        },

        updateTrigger: async (_, { id, input }, { user }) => {
            if (!user) throw new AppError('Unauthorized', 401);

            const trigger = await Trigger.findOneAndUpdate(
                { _id: id, organization: user.organization._id },
                input,
                { new: true, runValidators: true }
            );

            if (!trigger) {
                throw new AppError('Trigger not found', 404);
            }

            return trigger;
        },

        deleteTrigger: async (_, { id }, { user }) => {
            if (!user) throw new AppError('Unauthorized', 401);

            const trigger = await Trigger.findOneAndDelete({
                _id: id,
                organization: user.organization._id
            });

            if (!trigger) {
                throw new AppError('Trigger not found', 404);
            }

            return true;
        }
    }
};

module.exports = resolvers;