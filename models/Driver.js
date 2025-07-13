const mongoose = require('mongoose');

const DriversSchema = new mongoose.Schema({
    firstName: {
        type: String,
        required: true,
    },
    lastName: {
        type: String,
        required: true,
    },
    phone: {
        type: String,
        required: true,
    },
    carPlate: {
        type: String,
        required: true,
    },
    carModel: {
        type: String,
        required: true,
    },
    carColor: {
        type: String,
        required: true,
    },
    location: {
        lat: { type: Number, default: null },
        lan: { type: Number, default: null }  // Genellikle 'lng' kullanılır, sen 'lan' demişsin
    },
    email: {
        type: String,
        required: true,
    },
    password: {
        type: String,
        required: true,
    },
    dailyOrderCount: {
        type: Number,
        default: 0,
        required: false
    },
    lastOrderDate: {
        type: Date,
        default: null
    },
    limit: {
        type: Number,
        default: null,
        required: false,
    },
    ratingCount: {
        1: { type: Number, default: 0 },
        2: { type: Number, default: 0 },
        3: { type: Number, default: 0 },
        4: { type: Number, default: 0 },
        5: { type: Number, default: 0 }
    },
    dailyEarnings: {
        type: Number,
        default: 0
    },
    atWork: {
        type: Boolean,
        default: false,
    },
    onOrder: {
        type: Boolean,
        default: false,
    },
    lastOrderIds: {
        type: [mongoose.Schema.Types.ObjectId],
        default: [],
    },
    fcmToken: {
        type: String,
        unique: true, // Her token benzersiz olmalı
        sparse: true  // Token boş veya null olabilir
    },

}, { timestamps: true });

module.exports = mongoose.model('Drivers', DriversSchema);
