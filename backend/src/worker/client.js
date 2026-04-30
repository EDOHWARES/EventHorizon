const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const PROTO_PATH = path.resolve(__dirname, './poller.proto');

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});

const pollerProto = grpc.loadPackageDefinition(packageDefinition).poller;

// Utilize environment variables for internal service discovery
const GRPC_TARGET = process.env.POLLER_GRPC_TARGET || 'localhost:50051';

// Note: Using insecure credentials is standard for communication within a protected internal VPC.
// Ensure you apply TLS credentials if this crosses public networks.
const client = new pollerProto.InternalPoller(
    GRPC_TARGET, 
    grpc.credentials.createInsecure()
);

/**
 * Dispatches a single event to the poller over gRPC.
 * @param {Object} eventData - Matches the EventMessage proto definition
 */
function sendEvent(eventData) {
    return new Promise((resolve, reject) => {
        client.PropagateEvent(eventData, (err, response) => {
            if (err) return reject(err);
            resolve(response);
        });
    });
}

// Exposing the raw client as well so the streaming API can be manually invoked if needed.
module.exports = { client, sendEvent };