const mongoose = require('mongoose');
require('dotenv').config();
const app = require('./app');
const PORT = process.env.PORT || 5000;

// Database Connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log('✅ Connected to MongoDB');
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    })
    .catch(err => {
        console.error('❌ MongoDB connection error:', err);
    });

// TODO: Initialize Workers
// const eventPoller = require('./worker/poller');
// eventPoller.start();
