const express = require('express');
const router = express.Router();
const TaxiRequest = require('../models/taxiRequest');
const Driver = require('../models/Driver');
const User = require('../models/User');
const { driverApp, customerApp } = require('../server');
const admin = require('firebase-admin');
const CanceledOrder = require('../models/CanceledOrder');
const ReassignedOrder = require('../models/ReassignedOrder');
const cron = require('node-cron');
const mongoose = require('mongoose');

function getTotalFiveStar(driver) {
  if (!driver || !driver.ratingCount) return 0;
  return Number(driver.ratingCount[5] || driver.ratingCount['5'] || 0);
}

function hasValidCoords(d) {
  const loc = d.location || {};
  return Number.isFinite(loc.lat) && Number.isFinite(loc.lon);
}

function deg2rad(deg) { return deg * (Math.PI / 180); }
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const a = 6378137; // WGS-84 major axis (metre)
  const b = 6356752.3142; // WGS-84 minor axis
  const f = 1 / 298.257223563; // Flattening

  const L = deg2rad(lon2 - lon1);
  const U1 = Math.atan((1 - f) * Math.tan(deg2rad(lat1)));
  const U2 = Math.atan((1 - f) * Math.tan(deg2rad(lat2)));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);

  let lambda = L, lambdaP, iterLimit = 100;
  let sinSigma, cosSigma, sigma, sinAlpha, cosSqAlpha, cos2SigmaM, C;

  do {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt(
      (cosU2 * sinLambda) ** 2 +
      (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2
    );
    if (sinSigma === 0) return 0; // aynı nokta
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;
    if (isNaN(cos2SigmaM)) cos2SigmaM = 0; // kutuplar
    C = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
    lambdaP = lambda;
    lambda = L + (1 - C) * f * sinAlpha *
      (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
  } while (Math.abs(lambda - lambdaP) > 1e-12 && --iterLimit > 0);

  if (iterLimit === 0) return NaN; // yakınsamadı

  const uSq = cosSqAlpha * ((a ** 2 - b ** 2) / (b ** 2));
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma = B * sinSigma * (cos2SigmaM + (B / 4) *
    (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
      (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));

  const s = b * A * (sigma - deltaSigma); // mesafe metre
  return s / 1000; // kilometre
}



// Sürücü Seçme
async function selectBestDriver({ price, orderLat, orderLon, candidateDrivers = null }) {
  let drivers = candidateDrivers;
  if (!drivers) {
    drivers = await Driver.find({
      atWork: true,
      onOrder: false,
      'location.lat': { $ne: null },
      'location.lon': { $ne: null }
    });
  }

  drivers = drivers.filter(hasValidCoords);
  if (!drivers.length) return null;

  if (price <= 2) {
    return drivers.reduce((best, d) => {
      const dist = getDistanceKm(orderLat, orderLon, d.location.lat, d.location.lon);
      return !best || dist < best.dist ? { driver: d, dist } : best;
    }, null).driver;
  }

  const maxFive = Math.max(...drivers.map(getTotalFiveStar));
  let pool = maxFive === 0 ? drivers : drivers.filter(d => getTotalFiveStar(d) === maxFive);

  return pool.reduce((best, d) => {
    const dist = getDistanceKm(orderLat, orderLon, d.location.lat, d.location.lon);
    return !best || dist < best.dist ? { driver: d, dist } : best;
  }, null).driver;
}

// Bildirim
async function sendOrderFCMToDriver(driver, order) {
  if (!driver?.fcmToken) return;
  const distanceKm = getDistanceKm(
    order.currentAddress.latitude,
    order.currentAddress.longitude,
    driver.location.lat,
    driver.location.lon
  );

  try {
    await driverApp.messaging().send({
      notification: {
        title: '📢 Yeni Sifariş Mövcuddur!',
        body: `1. ${order.currentAddress.text}\n\n2. ${order.destinationAddress.text}\n💰 ${order.price} ₼\n📞 ${order.tel}\n👤 ${order.name}\n📏 ${distanceKm.toFixed(1)} km`
      },
      data: {
        fromAddress: order.currentAddress.text,
        toAddress: order.destinationAddress.text,
        price: String(order.price),
        distanceKm: distanceKm.toFixed(2),
        notification_type: 'NEW_ORDER_ALERT',
        orderId: String(order._id)
      },
      token: driver.fcmToken,
    });
  } catch (err) {
    console.error('FCM error:', err);
  }
}

// Otomatik Yeniden Atama
async function autoReassignOrder(order) {
  if (order.isTaken || order.isFinished || order.status !== 'pending') return;

  const now = Date.now();
  const last = order.lastAssignedAt ? order.lastAssignedAt.getTime() : 0;
  if (now - last < 16_000) return; // 10 saniye dolmamışsa çık

  // Eski sürücüyü boşalt
  if (order.driverId) {
    await Driver.updateOne({ _id: order.driverId }, { $set: { onOrder: false } });
    if (!order.rejectedBy.includes(order.driverId)) {
      order.rejectedBy.push(order.driverId);
    }
  }

  // Yeni sürücü bul
  const orderLat = order.currentAddress.latitude;
  const orderLon = order.currentAddress.longitude;
  const excludeIds = [...order.rejectedBy.map(String), ...(order.assignedHistory || []).map(String)];

  let drivers = await Driver.find({
    _id: { $nin: excludeIds },
    atWork: true,
    onOrder: false,
    'location.lat': { $ne: null },
    'location.lon': { $ne: null }
  });

  drivers = drivers.filter(hasValidCoords);
  if (!drivers.length) {
    order.driverId = null;
    order.status = 'waiting-driver';
    order.lastAssignedAt = new Date();
    await order.save();
    return;
  }

  const nextDriver = await selectBestDriver({ price: order.price, orderLat, orderLon, candidateDrivers: drivers });

  order.driverId = nextDriver._id;
  order.visibility.push(nextDriver._id);
  order.assignmentCount += 1;
  order.assignedHistory.push(nextDriver._id);
  order.lastAssignedAt = new Date();
  await order.save();

  await Driver.updateOne(
    { _id: nextDriver._id, onOrder: false },
    { $set: { onOrder: true }, $push: { lastOrderIds: order._id } }
  );

  await sendOrderFCMToDriver(nextDriver, order);
}


// Sipariş oluştur
router.post('/request', async (req, res) => {
  try {
    const {
      currentAddress,
      destinationAddress,
      destination2,
      additionalInfo,
      additionalData,
      userId,
      price,
      atAddress
    } = req.body;

    // Zorunlu alanlar
    if (!currentAddress?.text || !destinationAddress?.text || !userId || price == null) {
      return res.status(400).json({ message: 'Gerekli alanlar eksik.' });
    }

    // Kullanıcı
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'Kullanıcı bulunamadı.' });
    if (!user.tel || !user.name) {
      return res.status(400).json({ message: 'Kullanıcının telefon veya adı kayıtlı değil.' });
    }

    // Koordinatlar
    const orderLat = currentAddress.latitude;
    const orderLon = currentAddress.longitude;
    if (!Number.isFinite(orderLat) || !Number.isFinite(orderLon)) {
      return res.status(400).json({ message: 'Koordinatlar geçersiz.' });
    }

    // Fiyat
    const numericPrice = typeof price === 'number'
      ? price
      : parseFloat(String(price).replace(/[^0-9.,-]/g, '').replace(',', '.'));
    if (!Number.isFinite(numericPrice)) {
      return res.status(400).json({ message: 'Geçersiz fiyat.' });
    }

    // Sürücü seç (opsiyonel)
    const driver = await selectBestDriver({ price: numericPrice, orderLat, orderLon });

    // Şoför durumuna göre başlangıç değerleri
    let driverId = null;
    let visibility = [];
    let assignmentCount = 0;
    let assignedHistory = [];
    let lastAssignedAt = new Date(0); // hemen denensin

    if (driver) {
      driverId = driver._id;
      visibility = [driver._id];
      assignmentCount = 1;
      assignedHistory = [driver._id];
      lastAssignedAt = new Date();
    }

    // Sipariş yarat
    const savedRequest = await TaxiRequest.create({
      currentAddress,
      destinationAddress,
      destination2,
      additionalInfo,
      additionalData: !!additionalData,
      userId,
      tel: user.tel,
      name: user.name,
      price: numericPrice,
      atAddress,
      driverId,
      visibility,
      isTaken: false,
      status: 'pending', // beklemede
      lastAssignedAt,
      assignmentCount,
      assignedHistory,
      rejectedBy: []
    });

    // Sürücü varsa meşgul işaretle ve FCM gönder
    if (driver) {
      await Driver.updateOne(
        { _id: driver._id },
        { $set: { onOrder: true }, $push: { lastOrderIds: savedRequest._id } }
      );
      await sendOrderFCMToDriver(driver, savedRequest);
    }

    return res.status(201).json({
      message: driver
        ? 'Sipariş kaydedildi ve sürücüye bildirildi.'
        : 'Sipariş kaydedildi, sürücü bekleniyor.',
      requestId: savedRequest._id,
      closestDriverId: driver ? driver._id : null
    });

  } catch (err) {
    console.error('❌ Sunucu hatası:', err);
    return res.status(500).json({ message: 'Sunucu hatası oluştu.' });
  }
});


// Sipariş reddet
router.post('/orders/:orderId/reject', async (req, res) => {
  try {
    const { driverId } = req.body;
    const { orderId } = req.params;

    const order = await TaxiRequest.findById(orderId);
    if (!order) return res.status(404).json({ message: 'Sipariş bulunamadı.' });
    if (order.isTaken || order.isFinished) return res.status(400).json({ message: 'Sipariş zaten alınmış.' });

    order.rejectedBy = order.rejectedBy || [];
    if (!order.rejectedBy.includes(driverId)) order.rejectedBy.push(driverId);

    if (order.driverId?.toString() === driverId) order.driverId = null;

    order.lastAssignedAt = new Date(0);
    await order.save();

    await Driver.updateOne({ _id: driverId }, { $set: { onOrder: false } });

    await autoReassignOrder(order);

    return res.status(200).json({ message: 'Sipariş reddedildi, yeniden atama denendi.' });
  } catch (error) {
    console.error('Reddetme hatası:', error);
    return res.status(500).json({ message: 'Sunucu hatası oluştu.' });
  }
});

// Auto reassign CRON (her 10 saniyede bir)
cron.schedule('*/5 * * * * *', async () => {
  // Eğer yalnızca tek instance çalışsın istiyorsan:
  if (process.env.AUTO_ASSIGN_ENABLED !== 'true') return;

  const startedAt = new Date();
  console.log('[CRON] Auto-reassign taraması başladı:', startedAt.toISOString());

  try {
    const threshold = new Date(Date.now() - 16_000); // 10 sn önce
    const staleOrders = await TaxiRequest.find({
      isTaken: false,
      isFinished: { $ne: true },
      status: 'pending',
      lastAssignedAt: { $lte: threshold }
    }).limit(50); // Çok sayıda birikirse sisteme yük bindirmesin

    console.log(`[CRON] İncelenen stale order sayısı: ${staleOrders.length}`);

    for (const order of staleOrders) {
      try {
        await autoReassignOrder(order);
      } catch (innerErr) {
        console.error('[CRON] Tek sipariş yeniden atama hatası:', order._id, innerErr);
      }
    }
  } catch (err) {
    console.error('[CRON] Auto-reassign genel hata:', err);
  }
});


router.get('/requests', async (req, res) => {
  try {
    // Sadece isTaken ve isFinished olmayan siparişleri çekin
    const requests = await TaxiRequest.find({ isTaken: false, isFinished: false }).sort({ createdAt: -1 });
    res.status(200).json(requests);
  } catch (error) {
    console.error('Taksi istekleri çekilirken hata:', error);
    res.status(500).json({ message: 'Hata oluştu' });
  }
});

router.get('/requests/waiting-driver/count', async (req, res) => {
  try {
    const count = await TaxiRequest.countDocuments({
      status: 'waiting-driver',
      isTaken: false,
      isFinished: false
    });
    res.json({ count });
  } catch (e) {
    console.error('[GET /requests/waiting-driver/count] Hata:', e);
    res.status(500).json({ message: 'Count hata', error: e.message });
  }
});


router.delete('/request', async (req, res) => {
  try {
    const { requestId } = req.body; // İstek gövdesinden sipariş ID'sini alırız
    if (!requestId) {
      return res.status(400).json({ message: 'Taksi isteği ID eksik.' });
    }

    const deletedRequest = await TaxiRequest.findByIdAndDelete(requestId);
    if (!deletedRequest) {
      return res.status(404).json({ message: 'Silinecek taksi isteği bulunamadı.' });
    }
    res.sendStatus(204); // Başarıyla silindi
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Taksi isteği silinirken bir hata oluştu.' });
  }
});

router.get('/requests/:driverId', async (req, res) => {
  try {
    const requests = await TaxiRequest.find({ driverId: req.params.driverId });
    res.json(requests);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Siparişler alınırken bir hata oluştu.' });
  }
});

router.post('/updatePrice', async (req, res) => {
  try {
    const { requestId, price, driverId, time } = req.body;

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ message: 'Sürücü bulunamadı.' });
    }

    const updatedRequest = await TaxiRequest.findByIdAndUpdate(
      requestId,
      {
        price,
        driverId,
        time,
        driverDetails: {
          id: driver._id,
          firstName: driver.firstName,
          carColor: driver.carColor,
          carModel: driver.carModel,
          carPlate: driver.carPlate,
          phone: driver.phone,
        },

      },
      { new: true }
    );

    if (!updatedRequest) {
      return res.status(404).json({ message: 'Sipariş bulunamadı.' });
    }

    res.json({ message: 'Fiyat ve sürücü bilgileri başarıyla güncellendi.', request: updatedRequest });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Fiyat ve sürücü bilgileri güncellenirken bir hata oluştu.' });
  }
});

router.get('/updatePrice', async (req, res) => {
  try {
    const { requestId, price, driverId } = req.query;

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ message: 'Sürücü bulunamadı.' });
    }

    const updatedRequest = await TaxiRequest.findByIdAndUpdate(
      requestId,
      {
        price,
        driverId,
        driverDetails: {
          id: driver._id,
          firstName: driver.firstName,
          carColor: driver.carColor,
          carModel: driver.carModel,
          carPlate: driver.carPlate,
          phone: driver.phone,
        },
        time
      },
      { new: true }
    );

    if (!updatedRequest) {
      return res.status(404).json({ message: 'Sipariş bulunamadı.' });
    }

    res.json({ message: 'Fiyat ve sürücü bilgileri başarıyla güncellendi.', request: updatedRequest });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Fiyat ve sürücü bilgileri güncellenirken bir hata oluştu.' });
  }
});

router.get('/requests/visible/:driverId', async (req, res) => {
  try {
    const driverId = req.params.driverId;
    const orders = await TaxiRequest.find({
      visibility: driverId,
      isTaken: false,
      isFinished: false
    });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Sunucu hatası.' });
  }
});

router.post('/confirm', async (req, res) => {
  try {
    const { requestId } = req.body;

    if (!requestId) {
      return res.status(400).json({ message: 'Sipariş ID eksik.' });
    }

    const updatedRequest = await TaxiRequest.findByIdAndUpdate(
      requestId,
      {
        isConfirmed: true,
        handleConfirmOrder: true
      },
      { new: true }
    );

    if (!updatedRequest) {
      return res.status(404).json({ message: 'Sipariş bulunamadı.' });
    }

    res.json({ message: 'Sipariş onaylandı.', request: updatedRequest });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Sipariş onaylama sırasında bir hata oluştu.' });
  }
});

router.post('/updateConfirmStatus', async (req, res) => {
  try {
    const { requestId, isConfirmed } = req.body;
    if (!requestId) {
      return res.status(400).json({ message: 'Sipariş ID eksik.' });
    }

    const updatedRequest = await TaxiRequest.findByIdAndUpdate(
      requestId,
      { isConfirmed: isConfirmed },
      { new: true }
    );

    if (!updatedRequest) {
      return res.status(404).json({ message: 'Sipariş bulunamadı.' });
    }

    res.json({ message: 'Sipariş durumu güncellendi.', request: updatedRequest });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Bir hata meydana geldi.' });
  }
});

router.get('/order/:requestId', async (req, res) => {
  try {
    const requestId = req.params.requestId;

    const order = await TaxiRequest.findById(requestId);
    if (!order) {
      return res.status(404).json({ message: 'Sipariş bulunamadı.' });
    }

    res.json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Sipariş bilgileri alınırken bir hata oluştu.' });
  }
});

router.post('/takeOrder', async (req, res) => {
  try {
    const { requestId, driverId } = req.body;

    if (!requestId || !driverId) {
      return res.status(400).json({ message: 'Sipariş ID veya Sürücü ID eksik.' });
    }

    // Sipariş var mı?
    const taxiRequest = await TaxiRequest.findById(requestId);
    if (!taxiRequest) {
      return res.status(404).json({ message: 'Sipariş bulunamadı.' });
    }

    // Sipariş zaten alınmış mı?
    if (taxiRequest.isTaken) {
      return res.status(409).json({ message: 'Bu sipariş zaten alınmış.' });
    }

    // Sürücü var mı?
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ message: 'Sürücü bulunamadı.' });
    }

    // *** Burada onOrder kontrolü yapmıyoruz! ***
    // Çünkü zaten /request aşamasında onOrder:true yapılmış durumda.

    // Sadece siparişi "alındı" olarak işaretle
    taxiRequest.isTaken = true;
    taxiRequest.driverId = driverId;
    await taxiRequest.save();

    // Müşteriye FCM bildirimi (opsiyonel)
    if (taxiRequest.userId) {
      const user = await User.findById(taxiRequest.userId);
      if (user && user.fcmToken) {
        const message = {
          notification: {
            title: 'AloArda',
            body: `Siparişiniz sürücü tarafından alındı!`,
          },
          data: {
            requestId: taxiRequest._id.toString(),
            driverId: driverId.toString(),
            notification_type: 'ORDER_TAKEN'
          },
          token: user.fcmToken,
        };
        try {
          await customerApp.messaging().send(message);
          console.log('Müşteriye sipariş alındı bildirimi gönderildi.');
        } catch (error) {
          console.error('Müşteriye bildirim gönderilirken hata:', error);
        }
      }
    }

    return res.status(200).json({
      message: 'Sipariş başarıyla kabul edildi.',
      taxiRequest
    });

  } catch (error) {
    console.error('Sipariş alınırken hata:', error);
    return res.status(500).json({ message: 'Sunucu hatası oluştu.' });
  }
});

router.get('/userRequests/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const requests = await TaxiRequest.find({ userId });

    console.log(`Kullanıcı ID: ${userId}, Sipariş Sayısı: ${requests.length}`);

    if (requests.length === 0) {
      return res.status(404).json({ message: 'Bu kullanıcıya ait sipariş bulunamadı.' });
    }

    res.json(requests);
  } catch (error) {
    console.error('Hata:', error);
    res.status(500).json({ message: 'Siparişler alınırken bir hata oluştu.' });
  }
});

router.get('/my-requests/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: 'Kullanıcı ID eksik.' });
    }
    const userRequests = await TaxiRequest.find({ userId });
    res.status(200).json(userRequests);
  } catch (error) {
    console.error('Kullanıcı siparişleri alınırken hata:', error);
    res.status(500).json({ message: 'Kullanıcı siparişleri alınırken bir hata oluştu.' });
  }
});

router.post('/addOrderToUser', async (req, res) => {
  const { userId, requestId } = req.body;
  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'Kullanıcı bulunamadı' });

    user.orders.push({ orderId: requestId });
    await user.save();
    res.json({ message: 'Sipariş kullanıcıya eklendi' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Hata oluştu' });
  }
});

router.put('/order/:orderId/complete', async (req, res) => {
  try {
    const orderId = req.params.orderId;

    console.log(`Completing order with ID: ${orderId}`);

    const completedOrder = await TaxiRequest.findByIdAndUpdate(
      orderId,
      { isTaken: false, isFinished: true },
      { new: true }
    );

    if (!completedOrder) {
      console.log(`Order not found with ID: ${orderId}`);
      return res.status(404).json({ message: 'Sipariş bulunamadı.' });
    }

    console.log('Order successfully completed:', completedOrder);
    res.status(200).json(completedOrder);

  } catch (error) {
    console.error('Error completing order on backend:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

router.get('/delete-user-orders-page', (req, res) => {
  res.render('deleteUserOrders');
});

router.post('/delete-user-orders', async (req, res) => {
  const { userId } = req.body;

  try {
    const userOrders = await TaxiRequest.find({ userId });
    if (!userOrders || userOrders.length === 0) {
      return res.send('Bu kullanıcıya ait sipariş bulunamadı.');
    }

    await Promise.all(userOrders.map(async (order) => {
      order.isTaken = false;
      order.isFinished = false;
      await order.save();
    }));

    res.send('Tüm siparişler güncellendi: isTaken=false, isFinished=false.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Hata oluştu.');
  }
});

router.get('/get-user-orders', async (req, res) => {
  const { userId } = req.query;
  try {
    const orders = await TaxiRequest.find({ userId });
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Hata oluştu' });
  }
});

router.post('/updateOrderStatus', async (req, res) => {
  const { requestId, isTaken, isFinished, isConfirmed } = req.body;
  try {
    const updatedOrder = await TaxiRequest.findByIdAndUpdate(
      requestId,
      { isTaken, isFinished, isConfirmed },
      { new: true }
    );
    if (!updatedOrder) {
      return res.status(404).json({ message: 'Sipariş bulunamadı' });
    }
    res.json({ message: 'Durum güncellendi', order: updatedOrder });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Güncelleme hatası' });
  }
});

router.put('/order/:orderId/isTaken', async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const { isTaken, isConfirmed, isFinished } = req.body;

    const updatedOrder = await TaxiRequest.findByIdAndUpdate(
      orderId,
      {
        isTaken: isTaken,
        isConfirmed: isConfirmed,
        isFinished: isFinished
      },
      { new: true }
    );

    if (!updatedOrder) {
      return res.status(404).json({ message: 'Sipariş bulunamadı' });
    }

    res.status(200).json(updatedOrder);
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

router.put('/order/:orderId/setAtAddress', async (req, res) => {
  const { atAddress } = req.body;
  const { orderId } = req.params;

  try {
    const updatedOrder = await TaxiRequest.findByIdAndUpdate(
      orderId,
      { atAddress: atAddress },
      { new: true }
    );

    if (!updatedOrder) {
      return res.status(404).json({ message: 'Sipariş bulunamadı.' });
    }

    if (atAddress === true) {
      const user = await User.findById(updatedOrder.userId);

      if (user && user.fcmToken) {
        const message = {
          notification: {
            title: `AloArda - ${updatedOrder.driverDetails ? updatedOrder.driverDetails.carPlate : 'ünvanda'}`,
            body: `Dəyərli sərnişinimiz, sürücünüz "${updatedOrder.driverDetails ? updatedOrder.driverDetails.firstName : ''}" ünvanda sizi gözləyir.`,
          },
          android: {
            notification: {
              channel_id: 'default_channel_id',
              sound: 'tak_tak_tak',
              priority: 'high',
              visibility: 'public',
            },
          },
          data: {
            requestId: updatedOrder._id.toString(),
            notification_type: 'DRIVER_AT_ADDRESS',
            driverName: updatedOrder.driverDetails ? updatedOrder.driverDetails.firstName : 'Sürücü',
            carModel: updatedOrder.driverDetails ? updatedOrder.driverDetails.carModel : '',
            carPlate: updatedOrder.driverDetails ? updatedOrder.driverDetails.carPlate : '',
            atAddress: 'true'
          },
          token: user.fcmToken,
        };

        try {
          await customerApp.messaging().send(message); // DEĞİŞİKLİK BURADA
          console.log(`Müşteriye (${user.name}) 'Sürücü Ünvandadır' bildirimi gönderildi.`);
        } catch (notificationError) {
          console.error('Müşteriye bildirim gönderilirken hata oluştu:', notificationError);
        }
      } else {
        console.log('Siparişin kullanıcısı bulunamadı veya FCM tokenı yok. Müşteriye bildirim gönderilemedi.');
      }
    }
    res.json(updatedOrder);
  } catch (error) {
    console.error('Güncellenirken hata oluştu:', error);
    res.status(500).json({ message: 'Güncellenirken hata oluştu.' });
  }
});

router.post('/customerAccepted', async (req, res) => {
  try {
    const { requestId } = req.body;

    if (!requestId) {
      return res.status(400).json({ message: 'Sipariş ID eksik.' });
    }

    const updatedRequest = await TaxiRequest.findByIdAndUpdate(
      requestId,
      { takenCustomer: true },
      { new: true }
    );

    if (!updatedRequest) {
      return res.status(404).json({ message: 'Sipariş bulunamadı.' });
    }

    res.status(200).json({
      message: 'Siparişin müşteri kabul durumu başarıyla güncellendi.',
      request: updatedRequest
    });
  } catch (error) {
    console.error('Müşteri kabul durumu güncellenirken hata oluştu:', error);
    res.status(500).json({ message: 'Sunucu hatası.' });
  }
});

router.delete('/delete-all-requests', async (req, res) => {
  try {
    const result = await TaxiRequest.deleteMany({});
    res.json({ msg: `Bütün ${result.deletedCount} sifariş uğurla silindi.` });
  } catch (error) {
    console.error('Bütün sifarişlər silinərkən server xətası:', error);
    res.status(500).json({ msg: 'Server xətası: Bütün sifarişlər silinə bilmədi.', error: error.message });
  }
});

router.get('/get-driver-orders', async (req, res) => {
  const { driverId } = req.query;

  if (!driverId) {
    return res.status(400).json({ message: 'Sürücü ID eksik.' });
  }

  try {
    const orders = await TaxiRequest.find({ driverId: driverId });

    console.log(`Driver ID: ${driverId}, Sipariş Sayısı: ${orders.length}`);

    if (orders.length === 0) {
      return res.status(404).json({ message: 'Bu sürücüyə aid sifariş tapılmadı.' });
    }

    res.json(orders);
  } catch (err) {
    console.error('Sürücü siparişleri alınırken hata:', err);
    res.status(500).json({ message: 'Siparişlər alınarkən bir xəta baş verdi.' });
  }
});

router.get('/orders', async (req, res) => {
  try {
    const canceledOrders = await CanceledOrder.find().populate('userId').lean();
    const reassignedOrders = await ReassignedOrder.find().populate('userId').lean();

    res.render('orders', {
      canceledOrders,
      reassignedOrders
    });
  } catch (error) {
    console.error('[Server] Siparişler getirilirken hata:', error);
    res.status(500).send('Sunucu hatası oldu.');
  }
});

router.post('/cancel-order', async (req, res) => {
  const { requestId } = req.body;
  console.log(`[Server] Ləğv Et istəyi alındı. Sifariş ID: ${requestId}`);

  try {
    const orderToCancel = await TaxiRequest.findById(requestId);
    if (!orderToCancel) {
      console.warn(`[Server] Ləğv ediləcək sifariş tapılmadı. ID: ${requestId}`);
      return res.status(404).json({ message: 'Sifariş tapılmadı.' });
    }

    // --- SÜRÜCÜ AZAD ETMƏ ---
    // Prioritet: order.driverId -> sonra order.driverDetails.id
    let driverId = orderToCancel.driverId;
    if (!driverId && orderToCancel.driverDetails && orderToCancel.driverDetails.id) {
      driverId = orderToCancel.driverDetails.id; // string
    }

    let updatedDriver = null;
    if (driverId) {
      console.log(`[Server] Sifariş ləğv edilir, sürücü azad edilir: ${driverId}`);
      updatedDriver = await Driver.findByIdAndUpdate(
        driverId,
        { onOrder: false },
        { new: true, runValidators: false }
      );
      if (!updatedDriver) {
        console.warn(`[Server] Driver tapılmadı və ya update olunmadı: ${driverId}`);
      } else {
        console.log(`[Server] Driver onOrder -> ${updatedDriver.onOrder}`);
      }
    } else {
      console.log('[Server] Bu sifariş üçün driverId tapılmadı, sürücü azad edilmədi.');
    }

    // --- LƏĞV EDİLƏNLƏR ARXİVİ ---
    const canceledOrderData = {
      originalOrderId: orderToCancel._id,
      currentAddress: orderToCancel.currentAddress,
      destinationAddress: orderToCancel.destinationAddress,
      price: orderToCancel.price,
      userId: orderToCancel.userId,
      tel: orderToCancel.tel,
      additionalInfo: orderToCancel.additionalInfo || '',
      reason: 'User Canceled',
    };

    if (orderToCancel.destination2 && orderToCancel.destination2.text) {
      canceledOrderData.destination2 = orderToCancel.destination2;
    }

    // Sadəcə məlumat üçün saxlayırıq (populate etməsək belə)
    if (orderToCancel.driverDetails) {
      canceledOrderData.driverDetails = orderToCancel.driverDetails;
    } else if (driverId) {
      // Əlavə: əgər driverDetails yoxdursa, driver-ı qısa məlumatla doldura bilərik
      const d = await Driver.findById(driverId).lean();
      if (d) {
        canceledOrderData.driverDetails = {
          id: d._id,
          firstName: d.firstName,
          carPlate: d.carPlate,
          phone: d.phone,
        };
      }
    }

    await new CanceledOrder(canceledOrderData).save();

    // --- Əsas sifarişi sil ---
    await TaxiRequest.findByIdAndDelete(requestId);

    return res.status(200).json({
      message: 'Sifariş ləğv edildi.',
      driverReleased: !!updatedDriver,
      driverOnOrder: updatedDriver ? updatedDriver.onOrder : undefined,
    });

  } catch (error) {
    console.error('[Server] Sifariş ləğv edilərkən xəta:', error);
    return res.status(500).json({
      message: 'Sifariş ləğv edilərkən bir xəta baş verdi.',
      error: error.message,
    });
  }
});

router.post('/reassign-order', async (req, res) => {
  const { requestId } = req.body;
  console.log(`[Server] Yenile isteği alındı. Sipariş ID: ${requestId}`);

  try {
    const order = await TaxiRequest.findById(requestId);
    if (!order) {
      return res.status(404).json({ message: 'Sipariş bulunamadı.' });
    }

    // Önceki sürücüyü serbest bırak
    if (order.driverId) {
      await Driver.findByIdAndUpdate(order.driverId, { onOrder: false });
      console.log(`[Server] Eski sürücü serbest bırakıldı: ${order.driverId}`);
    }

    // Siparişi boşa düşür
    order.isTaken = false;
    order.driverId = null;           // Önce sıfırla, sonra yeni sürücü atayacağız
    order.driverDetails = null;
    order.time = null;
    order.atAddress = false;
    order.takenCustomer = false;
    order.isConfirmed = false;

    await order.save();

    // Yeni sürücü seçmek için uygun sürücüleri bul
    const availableDrivers = await Driver.find({
      onOrder: false,
      atWork: true,
      'location.lat': { $exists: true },
      'location.lon': { $exists: true }
    });

    if (availableDrivers.length === 0) {
      console.log('[Server] Uygun sürücü bulunamadı, sipariş boşa düştü.');
      return res.status(200).json({ message: 'Sipariş boşa düştü, uygun sürücü yok.' });
    }

    // Sipariş konumunu al
    const orderLat = order.currentAddress.latitude;
    const orderLon = order.currentAddress.longitude;

    // En yakın sürücüyü bulmak için mesafe fonksiyonu
    function getDistanceSq(lat1, lon1, lat2, lon2) {
      const dLat = lat1 - lat2;
      const dLon = lon1 - lon2;
      return dLat * dLat + dLon * dLon;
    }

    let nearestDriver = null;
    let nearestDistance = Infinity;

    for (const driver of availableDrivers) {
      if (!driver.location || typeof driver.location.lat !== 'number' || typeof driver.location.lon !== 'number') continue;
      const dist = getDistanceSq(driver.location.lat, driver.location.lon, orderLat, orderLon);
      if (dist < nearestDistance) {
        nearestDistance = dist;
        nearestDriver = driver;
      }
    }

    if (!nearestDriver) {
      console.log('[Server] Uygun lokasyona sahip sürücü bulunamadı.');
      return res.status(200).json({ message: 'Uygun sürücü bulunamadı.' });
    }

    // Yeni sürücüye ata
    order.driverId = nearestDriver._id;
    order.driverDetails = {
      firstName: nearestDriver.firstName,
      carPlate: nearestDriver.carPlate
    };
    order.isTaken = false;  // Sipariş hala serbest (yenileme mantığıyla)
    await order.save();

    // Yeni sürücüyü siparişli olarak işaretle
    nearestDriver.onOrder = true;
    await nearestDriver.save();

    console.log(`[Server] Sipariş yeni sürücüye atandı: ${nearestDriver._id}`);

    return res.status(200).json({ message: 'Sipariş başarıyla yeniden atandı.', driverId: nearestDriver._id });

  } catch (error) {
    console.error('[Server] Sipariş yeniden atama hatası:', error);
    return res.status(500).json({ message: 'Sunucu hatası oluştu.', error: error.message });
  }
});



module.exports = router;