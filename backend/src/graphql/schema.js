const { createSchema } = require('graphql-yoga');
const resolvers = require('./resolvers');

const typeDefs = /* GraphQL */ `
    scalar JSON

    type Trigger {
        id: ID!
        contractId: String!
        eventName: String!
        actionType: String!
        actionUrl: String
        batchingConfig: BatchingConfig
        isActive: Boolean
        createdAt: String!
    }

    input CreateTriggerInput {
        contractId: String!
        eventName: String!
        actionType: String!
        actionUrl: String
    }

    input UpdateTriggerInput {
        contractId: String
        eventName: String
        actionType: String
        actionUrl: String
        isActive: Boolean
    }

    type BatchingConfig {
        enabled: Boolean!
        windowMs: Int
        maxBatchSize: Int
        continueOnError: Boolean
    }

    type Health {
        queueStats: JSON
        activeBatches: Int
        uptime: Float
    }

    type Execution {
        id: ID!
        triggerId: ID!
        status: String!
        payload: JSON
        createdAt: String!
    }

    type Subscription {
        triggerCreated: Trigger!
        executionAdded(triggerId: ID!): Execution!
    }

    type Query {
        triggers: [Trigger!]!
        trigger(id: ID!): Trigger
        #executions(triggerId: ID!): [Execution!]!
        #health: Health!
    }

    type Mutation {
        createTrigger(input: CreateTriggerInput!): Trigger!
        updateTrigger(id: ID!, input: UpdateTriggerInput!): Trigger!
        deleteTrigger(id: ID!): Boolean!
    }

`;

const schema = createSchema({
    typeDefs,
    resolvers
});

module.exports = schema;