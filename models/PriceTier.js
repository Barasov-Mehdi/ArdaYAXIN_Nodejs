// models/PriceTier.js
const mongoose = require('mongoose');

const PriceTierSchema = new mongoose.Schema({
  maxKm: {
    type: Number,
    required: true
  },
  price: {
    type: Number,
    required: true
  }
});

module.exports = mongoose.model('PriceTier', PriceTierSchema);