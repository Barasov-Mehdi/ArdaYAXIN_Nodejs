const mongoose = require('mongoose');

const CanceledOrderSchema = new mongoose.Schema({
  originalOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
    // unique: true kaldırıldı
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
  driverDetails: {
    type: new mongoose.Schema({
      driverId: { type: String },
      firstName: { type: String },
      lastName: { type: String },
      carPlate: { type: String }
    }, { _id: false }),
    default: null
  },
  reason: {
    type: String,
    default: 'User Canceled'
  },
  canceledAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('CanceledOrder', CanceledOrderSchema);
