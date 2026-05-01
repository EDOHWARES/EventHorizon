const { withFilter } = require('graphql-subscriptions');
const pubsub = require('./pubsub');

const resolvers = {
    Subscription: {
        executionLog: {
            subscribe: withFilter(
                () => pubsub.asyncIterator(['EXECUTION_LOG']),
                (payload, variables) => {
                    if (!variables.triggerId) return true;
                    return payload.executionLog.triggerId === variables.triggerId;
                }
            )
        }
    }
};

module.exports = resolvers;