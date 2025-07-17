const express = require('express');
const router = express.Router();
const TaxiRequest = require('../models/taxiRequest');
const Driver = require('../models/Driver');
const User = require('../models/User');
const { driverApp, customerApp } = require('../server');
const admin = require('firebase-admin');
const CanceledOrder = require('../models/CanceledOrder');
const ReassignedOrder = require('../models/ReassignedOrder');


function getTotalFiveStar(driver) {
  if (!driver || !driver.ratingCount) return 0;
  // ratingCount alanı numeric olabilir; yoksa 0 döner
  return Number(driver.ratingCount[5] || driver.ratingCount['5'] || 0);
}

// Ortalamayı belki başka yerlerde kullanırsın; burada gerek yok ama tuttuk
function calcAvgRating(ratingCount = {}) {
  let total = 0, sum = 0;
  for (let s = 1; s <= 5; s++) {
    const c = Number(ratingCount[s] || ratingCount[String(s)] || 0);
    total += c;
    sum += s * c;
  }
  return total ? sum / total : 0;
}

// Geçerli koordinat kontrolü
function hasValidCoords(d) {
  const loc = d.location || {};
  const { lat, lan } = loc;       // NOTE: Mongo şeman bu şekilde; değiştirmezsen burada da lan kullanıyoruz
  return Number.isFinite(lat) && Number.isFinite(lan);
}

// Haversine
function deg2rad(deg) { return deg * (Math.PI / 180); }
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ------------------------------------------------------------
// ASIL SÜRÜCÜ SEÇİM FONKSİYONU (KURALLARINA GÖRE)
// ------------------------------------------------------------
async function selectBestDriver({ price, orderLat, orderLon }) {
  let drivers = await Driver.find({
    atWork: true,
    onOrder: false,
    'location.lat': { $ne: null },
    'location.lan': { $ne: null }
  });

  drivers = drivers.filter(hasValidCoords);
  if (!drivers.length) return null;

  if (price <= 2) {
    // PUAN YOK, SADECE MESAFEYE BAK
    let best = null;
    let minDist = Infinity;
    for (const d of drivers) {
      const dist = getDistanceKm(orderLat, orderLon, d.location.lat, d.location.lan);
      if (dist < minDist) {
        minDist = dist;
        best = d;
      }
    }
    return best;
  }

  // price > 2
  const maxFive = Math.max(...drivers.map(getTotalFiveStar));
  let pool = drivers.filter(d => getTotalFiveStar(d) === maxFive);

  if (maxFive === 0) {
    pool = drivers;
  }

  let best = null;
  let minDist = Infinity;
  for (const d of pool) {
    const dist = getDistanceKm(orderLat, orderLon, d.location.lat, d.location.lan);
    if (dist < minDist) {
      minDist = dist;
      best = d;
    }
  }
  return best;
}



// ------------------------------------------------------------
// ROUTE: SİPARİŞ OLUŞTUR
// ------------------------------------------------------------
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

    // --- ZORUNLU ALANLAR ---
    if (!currentAddress || !currentAddress.text ||
        !destinationAddress || !destinationAddress.text ||
        !userId || price == null) {
      return res.status(400).json({ message: 'Gerekli alanlar eksik.' });
    }

    // --- USER ---
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Kullanıcı bulunamadı.' });
    }
    if (!user.tel || !user.name) {
      return res.status(400).json({ message: 'Kullanıcının telefon veya adı kayıtlı değil.' });
    }

    // --- KOORDİNATLAR ---
    const orderLat = currentAddress.latitude;
    const orderLon = currentAddress.longitude;
    if (!Number.isFinite(orderLat) || !Number.isFinite(orderLon)) {
      return res.status(400).json({ message: 'Koordinatlar eksik veya geçersiz.' });
    }

    // --- FİYAT NUMERIC ---
    let numericPrice;
    if (typeof price === 'number') {
      numericPrice = price;
    } else {
      // içinde harf varsa temizle (₼ vs)
      numericPrice = parseFloat(String(price).replace(/[^0-9.,-]/g, '').replace(',', '.'));
    }
    if (!Number.isFinite(numericPrice)) {
      return res.status(400).json({ message: 'Geçersiz fiyat.' });
    }

    // --- SÜRÜCÜ SEÇ ---
    const driver = await selectBestDriver({ price: numericPrice, orderLat, orderLon });

    if (!driver) {
      // senin isteğin: sürücü yoksa SİPARİŞ VERİLMEYECEK
      return res.status(400).json({ message: 'Müsait sürücü yok. Sipariş oluşturulmadı.' });
    }

    // --- MESAFE ---
    const distanceKm = getDistanceKm(orderLat, orderLon, driver.location.lat, driver.location.lan);

    // --- SİPARİŞ KAYDET ---
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
      driverId: driver._id,
      visibility: [driver._id],
      isTaken: false,
      status: 'pending'
    });

    // --- SÜRÜCÜYÜ MEŞGUL İŞARETLE (atomic) ---
    const upd = await Driver.updateOne(
      { _id: driver._id, onOrder: false },
      {
        $set: { onOrder: true },
        $push: { lastOrderIds: savedRequest._id }
      }
    );
    if (!upd.modifiedCount) {
      console.warn(`⚠️ Sürücü ${driver._id} onOrder:true yapılamadı (yarış durumu?).`);
    }

    // --- BİLDİRİM ---
    if (driver.fcmToken) {
      try {
        await driverApp.messaging().send({
          notification: {
            title: '📢 Yeni Sifariş Mövcuddur!',
            body: `1. ${currentAddress.text}\n\n2. ${destinationAddress.text}\n💰 ${numericPrice} ₼\n📞 ${user.tel}\n👤 ${user.name}\n📏 ${distanceKm.toFixed(1)} km`
          },
          data: {
            fromAddress: currentAddress.text,
            toAddress: destinationAddress.text,
            price: String(numericPrice),
            distanceKm: distanceKm.toFixed(2),
            notification_type: 'NEW_ORDER_ALERT'
          },
          token: driver.fcmToken,
        });
      } catch (err) {
        console.error('FCM error:', err);
      }
    } else {
      console.warn(`⚠️ Sürücü ${driver._id} için FCM token yok.`);
    }

    // --- RESPONSE ---
    return res.status(201).json({
      message: 'Sipariş kaydedildi ve seçilen sürücüye bildirildi.',
      requestId: savedRequest._id,
      closestDriverId: driver._id,
      distanceKm: distanceKm.toFixed(2)
    });

  } catch (err) {
    console.error('❌ Sunucu hatası:', err);
    return res.status(500).json({ message: 'Sunucu hatası oluştu' });
  }
});

router.post('/orders/:orderId/reject', async (req, res) => {
  try {
    const { driverId } = req.body;
    const { orderId } = req.params;

    const order = await TaxiRequest.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Sipariş bulunamadı.' });
    }

    if (order.isTaken || order.isFinished) {
      return res.status(400).json({ message: 'Sipariş zaten alınmış veya tamamlanmış.' });
    }

    order.rejectedBy = order.rejectedBy || [];
    if (!order.rejectedBy.includes(driverId)) {
      order.rejectedBy.push(driverId);
    }

    if (order.driverId?.toString() === driverId) {
      order.driverId = null;
    }

    await order.save();

    await Driver.findByIdAndUpdate(driverId, { onOrder: false });

    const availableDrivers = await Driver.find({
      _id: { $nin: order.rejectedBy },
      onOrder: false,
      atWork: true,
      'location.lat': { $exists: true },
      'location.lan': { $exists: true }
    });

    const orderLat = order.currentAddress.latitude;
    const orderLon = order.currentAddress.longitude;

    let nearestDriver = null;
    let nearestDistance = Infinity;

    for (const driver of availableDrivers) {
      if (!driver.location || typeof driver.location.lat !== 'number' || typeof driver.location.lan !== 'number') continue;
      const distance = getDistanceKm(driver.location.lat, driver.location.lan, orderLat, orderLon);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestDriver = driver;
      }
    }

    if (nearestDriver) {
      order.driverId = nearestDriver._id;
      await Driver.findByIdAndUpdate(nearestDriver._id, { onOrder: true });
      await order.save();

      // Bildirim gönderimi eklenebilir
    }

    return res.status(200).json({ message: 'Sipariş reddedildi, başka sürücüye atandı.' });

  } catch (error) {
    console.error('Reddetme hatası:', error);
    return res.status(500).json({ message: 'Sunucu hatası oluştu.' });
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
      console.warn(`[Server] Ləğv ediləcək sifariş tapılmadı. Sifariş ID: ${requestId}`);
      return res.status(404).json({ message: 'Sifariş tapılmadı.' });
    }

    const canceledOrderData = {
      originalOrderId: orderToCancel._id,
      currentAddress: orderToCancel.currentAddress,
      destinationAddress: orderToCancel.destinationAddress,
      price: orderToCancel.price,
      userId: orderToCancel.userId,
      tel: orderToCancel.tel,
      additionalInfo: orderToCancel.additionalInfo || '',
      reason: 'User Canceled'
    };

    if (orderToCancel.destination2 && orderToCancel.destination2.text) {
      canceledOrderData.destination2 = orderToCancel.destination2;
    }

    if (
      orderToCancel.driverDetails &&
      typeof orderToCancel.driverDetails.toObject === 'function'
    ) {
      const driverObj = orderToCancel.driverDetails.toObject();
      if (driverObj && Object.keys(driverObj).length > 0) {
        canceledOrderData.driverDetails = driverObj;
      }
    }

    const canceledOrder = new CanceledOrder(canceledOrderData);
    await canceledOrder.save();

    await TaxiRequest.findByIdAndDelete(requestId);

    res.status(200).json({ message: 'Sifariş uğurla ləğv edildi və qeydə alındı.' });
  } catch (error) {
    console.error('[Server] Sifariş ləğv edilərkən xəta baş verdi:', error);
    res.status(500).json({ message: 'Sifariş ləğv edilərkən bir xəta baş verdi.', error: error.message });
  }
});


router.post('/reassign-order', async (req, res) => {
  const { requestId } = req.body;
  console.log(`[Server] Obşiyə At istəyi alındı. Sifariş ID: ${requestId}`);

  try {
    const orderToReassign = await TaxiRequest.findById(requestId);
    if (!orderToReassign) {
      return res.status(404).json({ message: 'Sifariş tapılmadı.' });
    }

    const reassignedOrderData = {
      originalOrderId: orderToReassign._id,
      currentAddress: orderToReassign.currentAddress,
      destinationAddress: orderToReassign.destinationAddress,
      price: orderToReassign.price,
      userId: orderToReassign.userId,
      tel: orderToReassign.tel,
      additionalInfo: orderToReassign.additionalInfo || ''
    };

    if (orderToReassign.destination2 && orderToReassign.destination2.text) {
      reassignedOrderData.destination2 = orderToReassign.destination2;
    }

    if (orderToReassign.driverDetails) {
      reassignedOrderData.previousDriverDetails = orderToReassign.driverDetails;
    }

    const reassignedOrder = new ReassignedOrder(reassignedOrderData);
    await reassignedOrder.save();

    orderToReassign.isTaken = false;
    orderToReassign.driverId = null;
    orderToReassign.driverDetails = null;
    orderToReassign.time = null;
    orderToReassign.atAddress = false;
    orderToReassign.takenCustomer = false;
    orderToReassign.isConfirmed = false;
    await orderToReassign.save();

    res.status(200).json({ message: 'Sifariş uğurla obşiyə atıldı və qeydə alındı.' });
  } catch (error) {
    console.error('[Server] Sifariş obşiyə atılarkən xəta baş verdi:', error);
    res.status(500).json({ message: 'Sifariş obşiyə atılarkən bir xəta baş verdi.', error: error.message });
  }
});
module.exports = router;