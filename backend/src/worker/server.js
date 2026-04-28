const { ApolloServer } = require('@apollo/server');
const { ApolloServerPluginDrainHttpServer } = require('@apollo/server/plugin/drainHttpServer');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { WebSocketServer } = require('ws');
const { useServer } = require('graphql-ws/lib/use/ws');
const jwt = require('jsonwebtoken');
const typeDefs = require('./typeDefs');
const resolvers = require('./resolvers');
const logger = require('../config/logger');

/**
 * Configures the Apollo Server with WebSocket Subscriptions support.
 * 
 * @param {Object} httpServer HTTP server instance from Express
 * @returns {ApolloServer} the configured Apollo server instance
 */
async function configureGraphQLServer(httpServer) {
    const schema = makeExecutableSchema({ typeDefs, resolvers });

    // Creating the WebSocket server for subscriptions
    const wsServer = new WebSocketServer({
        server: httpServer,
        path: '/graphql',
    });

    // Connect WebSocket server with GraphQL
    const serverCleanup = useServer({ 
        schema,
        onConnect: async (ctx) => {
            // Secure auth over WebSocket connections
            const token = ctx.connectionParams?.authToken || ctx.connectionParams?.Authorization;
            if (!token) {
                logger.warn('WebSocket connection attempted without auth token');
                throw new Error('Authentication token is required');
            }
            
            try {
                const decoded = jwt.verify(token.replace('Bearer ', ''), process.env.JWT_SECRET || 'secret');
                return { user: decoded }; // Pass user info into context
            } catch (error) {
                logger.error('WebSocket authentication failed', { error: error.message });
                throw new Error('Authentication token is invalid');
            }
        }
    }, wsServer);

    const server = new ApolloServer({
        schema,
        plugins: [
            ApolloServerPluginDrainHttpServer({ httpServer }),
            {
                async serverWillStart() {
                    return {
                        async drainServer() {
                            await serverCleanup.dispose();
                        },
                    };
                },
            },
        ],
    });

    await server.start();
    
    logger.info('Apollo GraphQL Subscriptions server initialized');
    return server;
}

module.exports = configureGraphQLServer;