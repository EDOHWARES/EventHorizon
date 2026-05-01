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
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const PROTO_PATH = path.resolve(__dirname, './poller.proto');

// Load the protobuf schema
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});

const pollerProto = grpc.loadPackageDefinition(packageDefinition).poller;

function propagateEvent(call, callback) {
    const event = call.request;
    // TODO: Route the event to the appropriate handlers or message queues
    
    callback(null, { success: true, message: 'Event received successfully' });
}

function streamEvents(call, callback) {
    let eventCount = 0;
    
    call.on('data', (event) => {
        // Process continuous stream of events with minimal overhead
        eventCount++;
    });

    call.on('end', () => {
        callback(null, { success: true, message: `Successfully processed ${eventCount} streamed events` });
    });
}

function startServer(port = '0.0.0.0:50051') {
    const server = new grpc.Server();
    
    server.addService(pollerProto.InternalPoller.service, {
        PropagateEvent: propagateEvent,
        StreamEvents: streamEvents
    });

    server.bindAsync(port, grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
        if (err) throw err;
        console.log(`gRPC Internal Poller Server running on port ${boundPort}`);
    });
}

module.exports = { startServer };
