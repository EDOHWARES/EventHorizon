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