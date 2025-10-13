// routes/drivers.js
const express = require('express');
const router = express.Router();
const Drivers = require('../models/Driver');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const haversine = require('haversine');
const TaxiRequest = require('../models/taxiRequest');

router.put('/:driverId/update-stats', async (req, res) => {
    const { driverId } = req.params;
    const { limit, dailyOrderCount, dailyEarnings } = req.body;

    try {
        const driver = await Drivers.findById(driverId);
        if (!driver) {
            return res.status(404).json({ msg: 'Sürücü bulunamadı.' });
        }

        if (typeof limit !== 'undefined' && !isNaN(parseFloat(limit))) {
            driver.limit = parseFloat(limit);
        }
        if (typeof dailyOrderCount !== 'undefined' && !isNaN(parseInt(dailyOrderCount))) {
            driver.dailyOrderCount = parseInt(dailyOrderCount);
        }
        if (typeof dailyEarnings !== 'undefined' && !isNaN(parseFloat(dailyEarnings))) {
            driver.dailyEarnings = parseFloat(dailyEarnings);
        }

        await driver.save();

        res.json({
            msg: 'Sürücü bilgileri başarıyla güncellendi.',
            driver: {
                limit: driver.limit,
                dailyOrderCount: driver.dailyOrderCount,
                dailyEarnings: driver.dailyEarnings
            }
        });
    } catch (error) {
        console.error('Sürücü bilgilerini güncellerken hata oluştu:', error);
        res.status(500).json({ msg: 'Sunucu hatası', error: error.message });
    }
});

router.put('/reset-daily-stats', async (req, res) => {
    try {
        await Drivers.updateMany({}, { dailyOrderCount: 0, dailyEarnings: 0 });
        res.json({ msg: 'Bütün sürücülərin günlük qazanc və sifariş sayları uğurla sıfırlandı.' });
    } catch (error) {
        console.error('Günlük statistika sıfırlanarkən server xətası:', error);
        res.status(500).json({ msg: 'Server xətası: Günlük statistika sıfırlana bilmədi.', error: error.message });
    }
});

router.get('/get-drivers', async (req, res) => {
    try {
        const drivers = await Drivers.find().select('firstName lastName limit atWork dailyOrderCount dailyEarnings');
        res.json(drivers);
    } catch (error) {
        console.error('Hata:', error);
        res.status(500).json({ msg: 'Sunucu hatası' });
    }
});

router.get('/available-orders/:driverId', async (req, res) => {
    const { driverId } = req.params;

    try {
        const orders = await TaxiRequest.find({
            isTaken: false,
            visibility: driverId  // sadece bu sürücünün görebileceği siparişler
        });

        res.json(orders);
    } catch (error) {
        console.error('Error fetching visible orders:', error);
        res.status(500).json({ message: 'Siparişler alınırken bir hata oluştu.' });
    }
});

router.get('/:id/current-location', async (req, res) => {
    try {
        const request = await TaxiRequest.findOne({ driverId: req.params.id, isTaken: true }).select('coordinates'); // Assuming you store the driver's active request
        if (!request || !request.coordinates) {
            return res.status(404).json({ message: 'Sürücü koordinatları bulunamadı.' });
        }
        res.json(request.coordinates);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Konum alınırken bir hata oluştu.' });
    }
});

// ID ile eşleşen sürücüyü getir
// routes/drivers.js
router.get('/ideslesensofor/:id', async (req, res) => {
    const driverId = req.params.id;
    console.log(`[VERCEL DEBUG] 'ideslesensofor' rotasına istek geldi. ID: ${driverId}`); // 👈 BU SATIRI EKLEYİN

    try {
        // ... (diğer kodlar)
        const driver = await Drivers.findById(driverId).select('firstName lastName');

        console.log(`[VERCEL DEBUG] Sürücü veritabanından getirildi:`, driver); // 👈 BU SATIRI DA EKLEYİN

        if (!driver) {
            console.log(`[VERCEL DEBUG] ID ${driverId} için sürücü tapılmadı (404)`);
            return res.status(404).json({ message: 'Sürücü tapılmadı.' });
        }

        res.json(driver);
    } catch (error) {
        console.error('[VERCEL DEBUG] Sürücü gətirilərkən KRİTİK XƏTA:', error);
        res.status(500).json({ message: 'Sunucu xətası.' });
    }
});

router.post('/updateLocation', async (req, res) => {
    try {
        const { driverId, coordinates } = req.body;

        const updatedRequest = await TaxiRequest.findOneAndUpdate(
            { driverId, isTaken: true }, // Alınan sipariş
            { coordinates }, // Yeni konum
            { new: true }
        );

        if (!updatedRequest) {
            return res.status(404).json({ message: 'Güncelleme yapılacak sipariş bulunamadı.' });
        }

        res.json({ message: 'Konum başarıyla güncellendi.', request: updatedRequest });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Konum güncellenirken bir hata oluştu.' });
    }
});

router.post('/register', async (req, res) => {
    const { firstName, lastName, phone, carPlate, carModel, carColor, email, password } = req.body;

    try {
        let driver = await Drivers.findOne({ email });
        if (driver) {
            return res.render('driverRegister', { error: "Driver already exists" });
        }

        driver = new Drivers({
            firstName,
            lastName,
            phone,
            carPlate,
            carModel,
            carColor,
            email,
            password,
            atWork: false,
            onOrder: false
        });

        const salt = await bcrypt.genSalt(10);
        driver.password = await bcrypt.hash(password, salt);

        await driver.save();

        return res.render('driverRegister', { success: "Registration successful!" });

    } catch (err) {
        console.error(err.message);
        return res.render('driverRegister', { error: "Server error. Please try again later." });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const driver = await Drivers.findById(req.params.id);
        if (!driver) {
            return res.status(404).json({ msg: 'Driver not found' });
        }

        const { atWork, onOrder, lastOrderId, lastOrderIds } = req.body;

        if (typeof atWork !== 'undefined') {
            driver.atWork = atWork;
        }
        if (typeof onOrder !== 'undefined') {
            driver.onOrder = onOrder;
        }
        if (lastOrderId) {
            driver.lastOrderId = lastOrderId;
        }
        if (lastOrderIds && lastOrderIds.length > 0) {
            driver.lastOrderIds.push(...lastOrderIds);
        }

        await driver.save();
        res.json(driver);
    } catch (error) {
        console.error("Error updating driver:", error);
        res.status(500).json({ msg: 'Server error', error: error.message });
    }
});

router.put('/:driverId/location', async (req, res) => {
    const { driverId } = req.params;
    const { lat, lon } = req.body;

    console.log(`[PUT] /drivers/${driverId}/location - body:`, req.body);
    if (
        typeof lat !== 'number' || typeof lon !== 'number' ||
        lat < -90 || lat > 90 ||
        lon < -180 || lon > 180
    ) {
        return res.status(400).json({ msg: 'Geçersiz koordinatlar.' });
    }

    try {
        const driver = await Drivers.findById(driverId);
        if (!driver) return res.status(404).json({ msg: 'Sürücü bulunamadı.' });

        driver.location = { lat, lon };
        await driver.save();

        res.json({ msg: 'Konum başarıyla güncellendi.', location: driver.location });
    } catch (error) {
        console.error('Konum güncellenirken hata:', error);
        res.status(500).json({ msg: 'Sunucu hatası', error: error.message });
    }
});

router.get('/on-order-status', async (req, res) => {
    try {
        const drivers = await Drivers.find({}, 'firstName lastName onOrder');
        res.render('driverOnOrderStatus', { drivers });
    } catch (error) {
        console.error('Sürücüleri getirirken hata oluştu:', error);
        res.status(500).json({ msg: 'Sunucu hatası', error: error.message });
    }
});

router.put('/:driverId/update-on-order', async (req, res) => {
    const { driverId } = req.params;
    const { onOrder } = req.body;

    // 'onOrder' değerinin boolean olduğundan emin olun
    if (typeof onOrder !== 'boolean') {
        return res.status(400).json({ msg: 'Geçersiz onOrder değeri. true veya false olmalı.' });
    }

    try {
        const driver = await Drivers.findById(driverId);
        if (!driver) {
            return res.status(404).json({ msg: 'Sürücü bulunamadı.' });
        }

        driver.onOrder = onOrder;
        await driver.save();

        res.json({ msg: 'Sürücünün onOrder durumu başarıyla güncellendi.', driver: { _id: driver._id, firstName: driver.firstName, lastName: driver.lastName, onOrder: driver.onOrder } });
    } catch (error) {
        console.error('Sürücünün onOrder durumunu güncellerken hata oluştu:', error);
        res.status(500).json({ msg: 'Sunucu hatası', error: error.message });
    }
});

router.get('/:driverId/location', async (req, res) => {
    try {
        const driver = await Drivers.findById(req.params.driverId).select('location');
        if (!driver) return res.status(404).json({ msg: 'Sürücü bulunamadı.' });

        res.json({ location: driver.location });
    } catch (error) {
        console.error('Konum alınırken hata:', error);
        res.status(500).json({ msg: 'Sunucu hatası', error: error.message });
    }
});

router.get('/:id/onOrderStatus', async (req, res) => {
    try {
        const driver = await Drivers.findById(req.params.id);
        if (!driver) {
            return res.status(404).json({ msg: 'Driver not found' });
        }

        res.json({ onOrder: driver.onOrder });
    } catch (error) {
        console.error("Error fetching driver:", error);
        res.status(500).json({ msg: 'Server error', error: error.message });
    }
});

router.get('/my-orders/:driverId', async (req, res) => {
    try {
        const requests = await TaxiRequest.find({ driverId: req.params.driverId, isTaken: true });
        if (requests.length === 0) {
            return res.status(404).json({ message: 'Bu sürücü tarafından alınmış sipariş bulunamadı.' });
        }
        res.json(requests);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Siparişler alınırken bir hata oluştu.' });
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        let driver = await Drivers.findOne({ email });
        if (!driver) {
            return res.status(400).json({ msg: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, driver.password);
        if (!isMatch) {
            return res.status(400).json({ msg: 'Invalid credentials' });
        }

        const payload = {
            driver: {
                id: driver.id
            }
        };

        jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: 360000 },
            (err, token) => {
                if (err) throw err;
                res.json({
                    token,
                    driver: {
                        id: driver.id,
                        firstName: driver.firstName,
                        lastName: driver.lastName,
                        email: driver.email,
                    }
                });
            }
        );

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

router.get('/profile/:id', async (req, res) => {
    try {
        const driver = await Drivers.findById(req.params.id).select('-password');
        if (!driver) return res.status(404).json({ msg: 'Driver not found' });
        res.json(driver);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

router.put('/:id/updateOrderCount', async (req, res) => {
    try {
        const driver = await Drivers.findById(req.params.id);
        if (!driver) return res.status(404).json({ msg: 'Driver not found' });

        driver.dailyOrderCount += 1;
        await driver.save();
        res.json({ msg: 'Sürücü sipariş sayısı güncellendi', dailyOrderCount: driver.dailyOrderCount });
    } catch (error) {
        console.error("Güncelleme hatası: ", error.message); // Hata konsola yazdır
        res.status(500).json({ msg: 'Server error', error: error.message });
    }
});

router.put('/:id/updateLimit', async (req, res) => {
    let { limit } = req.body; // Limit değeri isteğin gövdesinden alın

    try {
        limit = parseFloat(limit);

        if (isNaN(limit)) {
            return res.status(400).json({ msg: 'Geçersiz limit değeri. Lütfen bir sayı girin.' });
        }

        const driver = await Drivers.findById(req.params.id);
        if (!driver) return res.status(404).json({ msg: 'Sürücü bulunamadı.' });

        driver.limit = limit;
        await driver.save();

        res.json({ msg: 'Limit başarıyla güncellendi.', limit: driver.limit });
    } catch (error) {
        console.error('Hata:', error);
        res.status(500).json({ msg: 'Sunucu hatası', error: error.message });
    }
});

router.get('/:id/limit', async (req, res) => {
    try {
        const { id } = req.params;
        console.log('Gelen id:', id);  // Burada id'yi kontrol ediyoruz

        if (!id || id === 'null') {
            return res.status(400).json({ msg: 'Geçersiz ID' });
        }

        const driver = await Drivers.findById(id).select('limit');
        if (!driver) return res.status(404).json({ msg: 'Sürücü bulunamadı.' });

        res.json({ limit: driver.limit });
    } catch (error) {
        console.error('Hata:', error);
        res.status(500).json({ msg: 'Sunucu hatası' });
    }
});

router.post('/:driverId/rate', async (req, res) => {
    const { driverId } = req.params;
    const { rating } = req.body;

    if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({
            message: 'Yanlış veri gönderildi. (1-5 arası puan vermeniz gerekiyor.)'
        });
    }

    try {
        const driver = await Drivers.findById(driverId);
        if (!driver) {
            return res.status(404).json({ message: 'Sürücü bulunamadı.' });
        }

        driver.ratingCount[rating] += 1;

        await driver.save();

        res.status(200).json({ message: 'Puan başarıyla kaydedildi!' });
    } catch (error) {
        console.error('Hata:', error);
        res.status(500).json({ message: 'Puan kaydedilirken bir hata oluştu.' });
    }
});

router.get('/:driverId/rate', async (req, res) => {
    const { driverId } = req.params;

    try {
        const driver = await Drivers.findById(driverId);
        if (!driver) {
            return res.status(404).json({ message: 'Sürücü bulunamadı.' });
        }

        const ratingCount = driver.ratingCount;  // ratingCount, her bir puanın kaç kez verildiğini tutuyor
        const totalRatings = Object.values(ratingCount).reduce((acc, count) => acc + count, 0); // Toplam puan sayısı
        const weightedSum = Object.keys(ratingCount).reduce((acc, rating) => acc + (rating * ratingCount[rating]), 0); // Ağırlıklı toplam

        const averageRating = totalRatings > 0 ? (weightedSum / totalRatings).toFixed(2) : 0;

        res.status(200).json({
            averageRating,
            ratingCount
        });
    } catch (error) {
        console.error('Hata:', error);
        res.status(500).json({ message: 'Puanlar alınırken bir hata oluştu.' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const driver = await Drivers.findById(req.params.id);
        if (!driver) {
            return res.status(404).json({ message: 'Sürücü bulunamadı' });
        }
        res.status(200).json(driver);
    } catch (err) {
        res.status(500).json({ message: 'Sunucu hatası', error: err.message });
    }
});

router.put('/:id/updateDailyEarnings', async (req, res) => {
    const { earnings } = req.body;

    try {
        const driver = await Drivers.findById(req.params.id);
        if (!driver) return res.status(404).json({ msg: 'Driver not found' });

        driver.dailyEarnings += earnings; // Increment by the order price
        await driver.save();

        res.json({ msg: 'Daily earnings updated.', dailyEarnings: driver.dailyEarnings });
    } catch (error) {
        console.error('Error updating daily earnings:', error);
        res.status(500).json({ msg: 'Server error', error: error.message });
    }
});

router.get('/:id/dailyEarnings', async (req, res) => {
    try {
        const driver = await Drivers.findById(req.params.id);
        if (!driver) return res.status(404).json({ msg: 'Driver not found' });

        res.json({ dailyEarnings: driver.dailyEarnings }); // Return the daily earnings
    } catch (error) {
        console.error('Error fetching daily earnings:', error);
        res.status(500).json({ msg: 'Server error', error: error.message });
    }
});

router.get('/:driverId/last-order-id', async (req, res) => {
    try {
        const lastOrder = await TaxiRequest.findOne({
            driverId: req.params.driverId,
            status: { $ne: 'canceled' },
            price: { $gt: 0 }  // Fiyatı 0'dan büyük olan siparişler
        })
            .sort({ _id: -1 }) // En son siparişi almak için _id'ye göre azalan sırada
            .select('_id'); // Sadece ID'yi seçelim

        console.log(`Fetched Last Order ID for Driver ID ${req.params.driverId}:`, lastOrder);

        if (!lastOrder) {
            return res.status(404).json({ message: 'Bu sürücü için geçerli sipariş bulunamadı.' });
        }

        res.json({ orderId: lastOrder._id });  // Son siparişin ID'sini döndür
    } catch (error) {
        console.error('Error fetching last order ID:', error);
        res.status(500).json({ message: 'Son sipariş ID\'sini getirirken bir hata oluştu.', error: error.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const driver = await Drivers.findByIdAndDelete(req.params.id);
        if (!driver) {
            return res.status(404).json({ msg: 'Driver not found' });
        }
        res.json({ msg: 'Driver removed' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

router.post('/update-fcm-token', async (req, res) => {
    try {
        const { driverId, fcmToken } = req.body;

        if (!driverId || !fcmToken) {
            return res.status(400).json({ message: 'Sürücü ID ve FCM Token gerekli.' });
        }

        const driver = await Drivers.findById(driverId);
        if (!driver) {
            return res.status(404).json({ message: 'Sürücü bulunamadı.' });
        }

        driver.fcmToken = fcmToken;
        await driver.save();

        res.status(200).json({ message: 'FCM Token başarıyla güncellendi.' });

    } catch (error) {
        console.error('FCM Token güncellenirken hata oluştu:', error);
        res.status(500).json({ message: 'Sunucu hatası: FCM Token güncellenemedi.' });
    }
});

router.put('/profile/:id', async (req, res) => {
    const { firstName, lastName, phone, carPlate, carModel, carColor, email } = req.body;
    const { id } = req.params;

    try {
        let driver = await Drivers.findById(id);

        if (!driver) {
            return res.status(404).json({ msg: 'Sürücü bulunamadı.' });
        }

        if (firstName) driver.firstName = firstName;
        if (lastName) driver.lastName = lastName;
        if (phone) driver.phone = phone;
        if (carPlate) driver.carPlate = carPlate;
        if (carModel) driver.carModel = carModel;
        if (carColor) driver.carColor = carColor;
        if (email) driver.email = email;

        await driver.save();

        res.json({ msg: 'Sürücü bilgileri başarıyla güncellendi.', driver });

    } catch (err) {
        console.error(err.message);
        if (err.code === 11000) {
            return res.status(400).json({ msg: 'Bu email adresi zaten kullanımda.' });
        }
        res.status(500).send('Sunucu hatası');
    }
});

router.post('/finish-order', async (req, res) => {
    const { requestId, price } = req.body;

    console.log('Received finish-order request (Backend):', { requestId, price }); // Debugging log

    if (!requestId || typeof price === 'undefined' || isNaN(parseFloat(price))) {
        console.error('Invalid input for finish-order (Backend):', { requestId, price }); // Debugging log
        return res.status(400).json({ message: 'Sifariş ID-si və ya qiymət düzgün daxil edilməyib.' });
    }

    try {
        const taxiRequest = await TaxiRequest.findById(requestId);

        if (!taxiRequest) {
            console.error('Taxi request not found for ID (Backend):', requestId); // Debugging log
            return res.status(404).json({ message: 'Sifariş tapılmadı.' });
        }

        if (taxiRequest.isFinished) {
            return res.status(400).json({ message: 'Sifariş artıq tamamlanıb.' });
        }

        taxiRequest.isFinished = true;
        taxiRequest.isTaken = false; // BURAYA EKLEDİK
        taxiRequest.finishedAt = new Date(); // Tamamlanma zamanını kaydet
        await taxiRequest.save();

        await taxiRequest.save();
        console.log('Taxi request marked as finished (Backend):', taxiRequest); // Debugging log

        if (taxiRequest.driverId) {
            const driver = await Drivers.findById(taxiRequest.driverId);

            if (driver) {
                const deductionAmount = parseFloat(price) * 0.15; // Sipariş fiyatının %15'ini hesapla

                driver.limit = (driver.limit || 0) - deductionAmount;
                driver.dailyOrderCount = (driver.dailyOrderCount || 0) + 1; // Günlük sipariş sayısını artır
                driver.dailyEarnings = (driver.dailyEarnings || 0) + parseFloat(price); // Günlük kazanca tam fiyatı ekle
                driver.onOrder = false; // ✅ Sürücü artık siparişte değil
                await driver.save();
                console.log(`Driver ${driver._id} limit updated. New limit: ${driver.limit}, Daily Orders: ${driver.dailyOrderCount}, Daily Earnings: ${driver.dailyEarnings} (Backend)`); // Debugging log
            } else {
                console.warn(`Sürücü tapılmadı: ${taxiRequest.driverId} (Sifariş ${requestId} üçün). Limit çıxıla bilmədi. (Backend)`); // Debugging log
            }
        } else {
            console.warn(`Sifarişə sürücü təyin olunmayıb: ${requestId}. Limit çıxıla bilmədi. (Backend)`); // Debugging log
        }

        res.status(200).json({ message: 'Sifariş uğurla tamamlandı və sürücünün limiti güncəlləndi.' });

    } catch (error) {
        console.error('Sifarişi tamamlama xətası (Backend):', error); // Debugging log
        res.status(500).json({ message: 'Sunucu xətası. Sifariş tamamlanarkən problem yarandı.', error: error.message });
    }
});
module.exports = router;