const mongoose = require('mongoose');

const ReassignedOrderSchema = new mongoose.Schema({
    originalOrderId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
    },
    currentAddress: {
        text: { type: String, required: true },
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true }
    },
    destinationAddress: {
        text: { type: String, required: true },
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true }
    },
    destination2: {
        text: { type: String },
        latitude: { type: Number },
        longitude: { type: Number }
    },
    price: { type: Number, required: true },
    userId: { type: String, required: true },
    tel: { type: String, required: true },
    additionalInfo: { type: String },
    // **CRITICAL CHANGE FOR ReassignedOrderSchema**
    previousDriverDetails: {
        type: new mongoose.Schema({ // Define the nested object as its own schema type
            driverId: { type: String },
            firstName: { type: String },
            lastName: { type: String },
            carPlate: { type: String }
        }, { _id: false }), // _id: false to prevent Mongoose from adding an _id to the subdocument
        default: null // This makes the entire previousDriverDetails sub-document optional and allows it to be null
    },
    reassignedAt: {
        type: Date,
        default: Date.now
    }
});
module.exports = mongoose.model('ReassignedOrder', ReassignedOrderSchema);