const mongoose = require('mongoose');

const AppVersionSchema = new mongoose.Schema({
  // Uygulamanın en son sürüm numarası (örneğin: "1.0.1")
  latestVersion: {
    type: String,
    required: true,
    unique: true // Sadece bir tane en son sürüm olmalı
  },
  // Zorunlu güncelleme için minimum sürüm (örneğin: "1.0.0")
  minRequiredVersion: {
    type: String,
    default: "1.0.0" // Varsayılan olarak 1.0.0
  },
  // Kullanıcıya gösterilecek güncelleme mesajı
  updateMessage: {
    type: String,
    default: "Uygulamanın yeni bir versiyonu mevcut. Lütfen güncelleyin!"
  },
  // Android uygulama mağazası URL'si
  androidStoreUrl: {
    type: String,
    required: true
  },
  // iOS uygulama mağazası URL'si
  iosStoreUrl: {
    type: String,
    required: true
  },
  // Kaydın oluşturulma/güncellenme zamanı
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Her güncellemede 'updatedAt' alanını otomatik olarak ayarla
AppVersionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('AppVersion', AppVersionSchema);