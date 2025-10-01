const express = require('express');
const connectDB = require('./config/db');
const cors = require('cors');
const app = express();
const path = require('path');
require('dotenv').config();
const admin = require('firebase-admin');
const fs = require('fs');

// Vercel'de sürekli çalışan bir görev başlatılamaz.
// Eğer cron'u kullanmanız gerekiyorsa, bunu Vercel'in kendi Cron Jobs özelliği veya harici bir servis ile yapmalısınız.
// const cron = require('node-cron'); // Devre dışı bırakıldı/Kaldırıldı

const Drivers = require('./models/Driver');
const CanceledOrder = require('./models/CanceledOrder');
const ReassignedOrder = require('./models/ReassignedOrder');


// --- Firebase Uygulamalarını Başlatma ---
// Vercel ortamında yalnızca Ortam Değişkeni (Environment Variable) üzerinden yüklemeye odaklanın.
let driverServiceAccount;
let customerServiceAccount;

// Sürücü Hesabı Kimlik Bilgileri
if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
        // Vercel'de JSON string olarak gelen anahtarı kullan
        driverServiceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    } catch (e) {
        console.error("Hata: GOOGLE_SERVICE_ACCOUNT_KEY JSON formatında değil.");
    }
} else {
    // Lokal dosya okuma, sadece yerel geliştirme için korunur. Vercel'de bu kısım çalışmayacaktır.
    const localPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (localPath && fs.existsSync(localPath)) {
         driverServiceAccount = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    } else if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'production') {
        console.error("Sürücü Firebase kimlik bilgileri Ortam Değişkenlerinde bulunamadı. Lütfen Vercel'deki GOOGLE_SERVICE_ACCOUNT_KEY ayarını kontrol edin.");
    }
}

// Müşteri Hesabı Kimlik Bilgileri
if (process.env.CUSTOMER_GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
        // Vercel'de JSON string olarak gelen anahtarı kullan
        customerServiceAccount = JSON.parse(process.env.CUSTOMER_GOOGLE_SERVICE_ACCOUNT_KEY);
    } catch (e) {
        console.error("Hata: CUSTOMER_GOOGLE_SERVICE_ACCOUNT_KEY JSON formatında değil.");
    }
} else {
    // Lokal dosya okuma, sadece yerel geliştirme için korunur. Vercel'de bu kısım çalışmayacaktır.
    const localPath = process.env.CUSTOMER_GOOGLE_APPLICATION_CREDENTIALS;
    if (localPath && fs.existsSync(localPath)) {
        customerServiceAccount = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    } else if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'production') {
        console.error("Müşteri Firebase kimlik bilgileri Ortam Değişkenlerinde bulunamadı. Lütfen Vercel'deki CUSTOMER_GOOGLE_SERVICE_ACCOUNT_KEY ayarını kontrol edin.");
    }
}

// Firebase Admin SDK'yı her iki proje için de başlatın (Sadece başlatılmadıysa)
let driverApp, customerApp;

if (driverServiceAccount) {
    try {
        driverApp = admin.app('driverApp'); // Zaten başlatıldıysa mevcut uygulamayı al
    } catch (e) {
        // Başlatılmadıysa başlat
        driverApp = admin.initializeApp({
            credential: admin.credential.cert(driverServiceAccount)
        }, 'driverApp');
        console.log("Sürücü Firebase Admin SDK başarıyla başlatıldı.");
    }
} else {
    console.error("Sürücü Firebase Admin SDK başlatılamadı. Kimlik bilgilerinizi kontrol edin.");
}

if (customerServiceAccount) {
    try {
        customerApp = admin.app('customerApp'); // Zaten başlatıldıysa mevcut uygulamayı al
    } catch (e) {
        // Başlatılmadıysa başlat
        customerApp = admin.initializeApp({
            credential: admin.credential.cert(customerServiceAccount)
        }, 'customerApp');
        console.log("Müşteri Firebase Admin SDK başarıyla başlatıldı.");
    }
} else {
    console.error("Müşteri Firebase Admin SDK başlatılamadı. Kimlik bilgilerinizi kontrol edin.");
}


// Firebase uygulamalarını modül dışına aktar
module.exports.driverApp = driverApp;
module.exports.customerApp = customerApp;

// MongoDB bağlantısı (Her istek geldiğinde çağrılmaz, ilk fonksiyon başlatıldığında çalışır)
connectDB(); 

// Express Ayarları ve Middleware'ler
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(cors());
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
});

// Route Tanımlamaları
const indexRouter = require('./routes/index');
app.use('/', indexRouter);

app.get('/pricetiers', async (req, res) => {
    try {
        const PriceTier = require('./models/PriceTier');
        const tiers = await PriceTier.find().sort('maxKm');
        res.render('pricetiers', { tiers });
    } catch (err) {
        res.status(500).send('Sunucu hatası');
    }
});
app.get('/register/user', (req, res) => {
    res.render('userRegister');
});
app.get('/register/driver', (req, res) => {
    res.render('driverRegister');
});
app.get('/order/taxi', (req, res) => {
    res.render('taxiOrder');
});
app.get('/add-coordinates', (req, res) => {
    res.render('addCoordinates');
});
app.get('/admin/delete-drivers', (req, res) => {
    res.render('deleteDrivers');
});

app.get('/admin/drivers', async (req, res) => {
    try {
        const Drivers = require('./models/Driver');
        const drivers = await Drivers.find().select('firstName lastName limit dailyOrderCount dailyEarnings atWork');
        res.render('suruculer', { drivers });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server xətası');
    }
});

app.get('/manage-coordinates', async (req, res) => {
    try {
        const Coordinate = require('./models/cordinatsDb');
        const coordinates = await Coordinate.find().sort({ addressName: 1 });
        res.render('manageCoordinates', { coordinates });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server xətası');
    }
});

app.get('/map-coordinates', async (req, res) => {
    try {
        res.render('mapCoordinates');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server xətası');
    }
});

app.get('/find-user-orders', (req, res) => {
    res.render('findUserOrders');
});

app.get('/aloarda-privacy-policy', (req, res) => {
    const appData = {
        appName: "AloArda",
        lastUpdated: "June 9, 2025",
        contactEmail: "support@aloarda.com",
        contactPageUrl: "https://www.aloarda.com/contact",
        minAge: 13,
        companyAddress: "Azerbaijan, City, Country"
    };
    res.render('aloarda-privacy-policy', { data: appData });
});

app.get('/admin/app-version', async (req, res) => {
    try {
        res.render('appversion');
    } catch (err) {
        console.error(err);
        res.status(500).send('Server xətası');
    }
});

app.get('/orders', async (req, res) => {
    try {
        const canceledOrders = await CanceledOrder.find().populate('userId').lean();
        const reassignedOrders = await ReassignedOrder.find().populate('userId').lean();

        res.render('orders', { canceledOrders, reassignedOrders });
    } catch (error) {
        console.error('[Server] Siparişler getirilirken hata:', error);
        res.status(500).send('Sunucu hatası oluştu.');
    }
});

app.get('/drivers-on-order', (req, res) => {
    res.redirect('/api/drivers/on-order-status'); // Redirect to the actual route
});


app.use('/api/users', require('./routes/users'));
app.use('/api/taxis', require('./routes/taxis')); // Burası güncellenecek route'ları içeriyor
app.use('/api/drivers', require('./routes/drivers'));
app.use('/api/help', require('./routes/helps'));
app.use('/api/coordinates', require('./routes/cordinatsRoutes'));
app.use('/api/pricetiers', require('./routes/pricetiers'));
app.use('/api/app-version', require('./routes/appVersionRoutes'));

// 🛑 KRİTİK DÜZELTME: app.listen() kaldırıldı ve Express uygulaması dışa aktarıldı.
// Vercel bu dışa aktarılmış 'app' objesini kullanarak gelen istekleri işler.
module.exports = app;