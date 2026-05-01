c.onst typeDefs = `#graphql
    type ExecutionLog {
        jobId: ID!
        triggerId: String!
        actionType: String!
        status: String!
        error: String
        timestamp: String!
    }

    type Subscription {
        executionLog(triggerId: String): ExecutionLog!
    }
`;

module.exports = typeDefs;