const express = require('express');
const router = express.Router();
const TaxiRequest = require('../models/taxiRequest');
const Driver = require('../models/Driver');
const User = require('../models/User');
const { driverApp, customerApp } = require('../server');
const admin = require('firebase-admin');
const CanceledOrder = require('../models/CanceledOrder');
const ReassignedOrder = require('../models/ReassignedOrder');

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
<<<<<<< HEAD

=======
>>>>>>> c55a2b4402a57f8440adf28bd68ab7bacb33b070
function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

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

    if (
      !currentAddress?.text || !destinationAddress?.text ||
      !userId || price == null
    ) {
      return res.status(400).json({ message: 'Gerekli alanlar eksik.' });
    }

    const user = await User.findById(userId);
    if (!user || !user.tel || !user.name) {
      return res.status(400).json({ message: 'Kullanıcı bilgileri eksik.' });
    }

    const orderLat = currentAddress.latitude;
    const orderLon = currentAddress.longitude;
    if (orderLat == null || orderLon == null) {
      return res.status(400).json({ message: 'Konum bilgileri eksik.' });
    }

    const drivers = await Driver.find({
      atWork: true,
      'location.lat': { $ne: null },
      'location.lan': { $ne: null } // senin şemanda lan olarak geçiyor
    });

    if (drivers.length === 0) {
      return res.status(201).json({
        message: 'Uygun sürücü bulunamadı.',
        requestSaved: false
      });
    }

    let closestDriver = null;
    let minDistance = Infinity;

    drivers.forEach(driver => {
      const { lat, lan } = driver.location; // DİKKAT: lan kullanıyorsun
      const distance = getDistanceFromLatLonInKm(orderLat, orderLon, lat, lan);
      if (distance < minDistance) {
        minDistance = distance;
        closestDriver = driver;
      }
    });

    const taxiRequest = new TaxiRequest({
      currentAddress,
      destinationAddress,
      destination2,
      additionalInfo,
      additionalData: !!additionalData,
      userId,
      tel: user.tel,
      name: user.name,
      price,
      atAddress,
      driverId: closestDriver?._id,
      driverDetails: closestDriver ? {
        id: closestDriver._id.toString(),
        firstName: closestDriver.firstName,
        carPlate: closestDriver.carPlate,
        carModel: closestDriver.carModel,
        carColor: closestDriver.carColor,
        phone: closestDriver.phone
      } : {},
      status: closestDriver ? 'assigned' : 'pending',
      assignedDriverId: closestDriver?._id || null,
      visibility: closestDriver ? [closestDriver._id] : []
    });

    const savedRequest = await taxiRequest.save();

<<<<<<< HEAD
    const drivers = await Driver.find({ atWork: true, 'location.lat': { $exists: true }, 'location.lan': { $exists: true } });

    if (drivers.length === 0) {
      return res.status(201).json({
        message: 'Taksi isteği kaydedildi, ancak aktif sürücü bulunamadı.',
        requestId: savedRequest._id
      });
    }

    const orderLat = currentAddress.latitude;
    const orderLon = currentAddress.longitude;

    if (orderLat == null || orderLon == null) {
      return res.status(201).json({ message: 'Koordinatlar eksik.', requestId: savedRequest._id });
    }

    let closestDriver = null;
    let minDistance = Infinity;

    drivers.forEach(driver => {
      const { lat, lan } = driver.location;
      const distance = getDistanceFromLatLonInKm(orderLat, orderLon, lat, lan);
      if (distance < minDistance) {
        minDistance = distance;
        closestDriver = driver;
      }
    });

    if (!closestDriver || !closestDriver.fcmToken) {
      return res.status(201).json({
        message: 'Uygun sürücü bulunamadı.',
        requestId: savedRequest._id
      });
    }

    // 🔥 EN ÖNEMLİ KISIM: Siparişe en yakın sürücüyü kaydet
    savedRequest.driverId = closestDriver._id;
    await savedRequest.save();

    const message = {
      notification: {
        title: 'AloArda',
        body: `Yeni Sifariş: ${currentAddress.text} Qiymət: ${price} ₼`,
      },
      android: {
        notification: {
          channel_id: 'default_channel_id',
          sound: 'zil_sesi',
          priority: 'high',
          visibility: 'public',
=======
    if (closestDriver?.fcmToken) {
      const message = {
        notification: {
          title: 'AloArda',
          body: `Yeni Sifariş: ${currentAddress.text} Qiymət: ${price} ₼`,
>>>>>>> c55a2b4402a57f8440adf28bd68ab7bacb33b070
        },
        data: {
          requestId: savedRequest._id.toString(),
          fromAddress: currentAddress.text,
          toAddress: destinationAddress.text,
          price: price.toString(),
          userId: userId.toString(),
          notification_type: 'NEW_ORDER_ALERT'
        },
        token: closestDriver.fcmToken,
        android: {
          notification: {
            channel_id: 'default_channel_id',
            sound: 'zil_sesi',
            priority: 'high',
            visibility: 'public',
          }
        }
      };

<<<<<<< HEAD
    try {
      const response = await driverApp.messaging().send(message);
      console.log('Bildirim gönderildi:', response);
    } catch (error) {
      console.error('Bildirim hatası:', error);
    }

    res.status(201).json({
      message: 'Sipariş kaydedildi ve en yakın sürücüye bildirildi.',
=======
      try {
        await driverApp.messaging().send(message);
        console.log('📩 Bildirim gönderildi');
      } catch (error) {
        console.error('🚫 Bildirim hatası:', error.message);
      }
    }

    return res.status(201).json({
      message: 'Sipariş oluşturuldu ve sürücüye atandı.',
>>>>>>> c55a2b4402a57f8440adf28bd68ab7bacb33b070
      requestId: savedRequest._id,
      driverId: closestDriver?._id || null,
      distanceKm: minDistance.toFixed(2)
    });

<<<<<<< HEAD
  } catch (error) {
    console.error('Sunucu hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası oluştu' });
=======
  } catch (err) {
    console.error('❌ Sipariş oluşturulamadı:', err.message);
    return res.status(500).json({ message: 'Sunucu hatası.' });
>>>>>>> c55a2b4402a57f8440adf28bd68ab7bacb33b070
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
    const { requestId, tel, name, driverId } = req.body;

    if (!requestId || !driverId) {
      return res.status(400).json({ message: 'Sipariş ID veya Sürücü ID eksik.' });
    }

    const taxiRequest = await TaxiRequest.findById(requestId);
    if (!taxiRequest) {
      return res.status(404).json({ message: 'Sipariş bulunamadı.' });
    }

    if (taxiRequest.isTaken) {
      return res.status(409).json({ message: 'Bu sipariş zaten alınmış.' });
    }

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ message: 'Sürücü bulunamadı.' });
    }

    // Sürücünün mevcut konumunu kontrol et
    if (!driver.location || typeof driver.location.lat !== 'number' || typeof driver.location.lan !== 'number') {
      return res.status(400).json({ message: 'Sürücünün konum bilgisi eksik veya hatalı.' });
    }

    // Siparişin başlangıç konumunu kontrol et
    if (!taxiRequest.currentAddress || typeof taxiRequest.currentAddress.latitude !== 'number' || typeof taxiRequest.currentAddress.longitude !== 'number') {
      return res.status(400).json({ message: 'Siparişin başlangıç konum bilgisi eksik veya hatalı.' });
    }

    // *** YENİ EKLENECEK KISIM: Mesafe Kontrolü ***
    const driverLat = driver.location.lat;
    const driverLon = driver.location.lan;
    const orderLat = taxiRequest.currentAddress.latitude;
    const orderLon = taxiRequest.currentAddress.longitude;

    const distance = getDistanceFromLatLonInKm(driverLat, driverLon, orderLat, orderLon);
    const maxAllowedDistance = 45; 

    if (distance > maxAllowedDistance) {
      console.log(`Sürücü ID: ${driverId} sipariş ID: ${requestId} için çok uzakta. Mesafe: ${distance.toFixed(2)} km`);
      return res.status(403).json({ message: `Sipariş çok uzakta (${distance.toFixed(2)} km). Sadece ${maxAllowedDistance * 1000} metre yakınındaki siparişleri alabilirsiniz.` });
    }
    // *** YENİ EKLENECEK KISIM SONU ***

    taxiRequest.isTaken = true;
    taxiRequest.driverId = driverId;
    await taxiRequest.save();

    // Müşteriye bildirim gönderme (eğer Firebase admin SDK'yı burada kullanıyorsanız)
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
          await customerApp.messaging().send(message); // customerApp'in tanımlı olduğundan emin olun
          console.log('Müşteriye siparişin alındığı bildirimi gönderildi.');
        } catch (error) {
          console.error('Müşteriye bildirim gönderilirken hata:', error);
        }
      }
    }

    res.status(200).json({ message: 'Sipariş başarıyla alındı.', taxiRequest });

  } catch (error) {
    console.error('Sipariş alınırken hata:', error);
    res.status(500).json({ message: 'Sunucu hatası oluştu.' });
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
      typeof orderToCancel.driverDetails === 'object' &&
      Object.keys(orderToCancel.driverDetails.toObject ? orderToCancel.driverDetails.toObject() : orderToCancel.driverDetails).length > 0
    ) {
      canceledOrderData.driverDetails = orderToCancel.driverDetails;
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