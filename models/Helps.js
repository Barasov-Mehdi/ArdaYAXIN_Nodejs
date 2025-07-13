const mongoose = require('mongoose');

const helpSchema = new mongoose.Schema({
    firstLname: {
        type: String,
        required: true,
    },
    phone: {
        type: String, // Changed to String to accommodate various phone number formats
        required: true,
    },
    email: {
        type: String,
        required: true,
    },
    helpText: {
        type: String,
        required: true,
    },
});

module.exports = mongoose.model('Helps', helpSchema);