const mongoose = require('mongoose');
// git hubdan sildin deye bunu bura yazdin 
const coordinateSchema = new mongoose.Schema({
    addressName: {
        type: String,
        required: true
    },
    latitude: {
        type: Number,
        required: true
    },
    longitude: {
        type: Number,
        required: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Coordinate', coordinateSchema);