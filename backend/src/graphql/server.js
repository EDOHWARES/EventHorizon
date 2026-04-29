const { createYoga } = require('graphql-yoga');
const schema = require('./schema');
const resolvers = require('./resolvers');

const yoga = createYoga({
    schema,
    context: ({ request }) => {
        return {
            user: request.user
        };
    }
});

module.exports = yoga;