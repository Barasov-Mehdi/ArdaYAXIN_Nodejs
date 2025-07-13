const express = require('express');
const router = express.Router();
const AppVersion = require('../models/AppVersion');

// @route   GET /api/app-version
// @desc    Uygulamanın en son sürüm bilgilerini getirir
// @access  Public (React Native uygulaması tarafından kullanılacak)
router.get('/', async (req, res) => {
  try {
    // Veritabanındaki tek AppVersion kaydını bul ve geri döndür.
    // Varsayılan olarak her zaman tek bir AppVersion kaydı olmalıdır.
    const appVersion = await AppVersion.findOne();

    if (!appVersion) {
      // Eğer henüz bir AppVersion kaydı yoksa, varsayılan bir tane oluşturabiliriz.
      // Ancak genellikle bu kaydı manuel olarak bir kez oluşturmanız önerilir.
      return res.status(404).json({ msg: 'Uygulama sürüm bilgisi bulunamadı. Lütfen önce bir kayıt oluşturun.' });
    }
    res.json(appVersion);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu hatası');
  }
});

// @route   POST /api/app-version
// @desc    Uygulamanın sürüm bilgilerini oluşturur veya günceller
// @access  Private (Yönetici erişimi gerektirmeli, bu örnekte kimlik doğrulama yok)
// Not: Bu rota, admin yetkilendirmesi ile korunmalıdır. Bu örnekte basitleştirilmiştir.
router.post('/', async (req, res) => {
  const { latestVersion, minRequiredVersion, updateMessage, androidStoreUrl, iosStoreUrl } = req.body;

  try {
    let appVersion = await AppVersion.findOne();

    if (appVersion) {
      // Eğer kayıt varsa güncelle
      appVersion.latestVersion = latestVersion || appVersion.latestVersion;
      appVersion.minRequiredVersion = minRequiredVersion || appVersion.minRequiredVersion;
      appVersion.updateMessage = updateMessage || appVersion.updateMessage;
      appVersion.androidStoreUrl = androidStoreUrl || appVersion.androidStoreUrl;
      appVersion.iosStoreUrl = iosStoreUrl || appVersion.iosStoreUrl;
      await appVersion.save();
      return res.json(appVersion);
    } else {
      // Eğer kayıt yoksa yeni oluştur
      appVersion = new AppVersion({
        latestVersion,
        minRequiredVersion,
        updateMessage,
        androidStoreUrl,
        iosStoreUrl
      });
      await appVersion.save();
      return res.status(201).json(appVersion);
    }
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Sunucu hatası');
  }
});

module.exports = router;