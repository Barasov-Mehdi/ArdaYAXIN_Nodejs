const express = require('express');
const connectDB = require('./config/db');
const cors = require('cors');
const app = express();
const path = require('path');
require('dotenv').config();
const admin = require('firebase-admin');
const fs = require('fs'); // fs modülünü ekleyin
const cron = require('node-cron');
const Drivers = require('./models/Driver');
const CanceledOrder = require('./models/CanceledOrder');
const ReassignedOrder = require('./models/ReassignedOrder');


// --- Firebase Uygulamalarını Başlatma ---
let driverServiceAccount;
let customerServiceAccount;

// Sürücü projesi için servis hesabı anahtarını yükle
// Ortam değişkeni GOOGLE_APPLICATION_CREDENTIALS olarak belirtilmiş
if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) { // Heroku gibi ortamlar için
    driverServiceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) { // Lokal ortam için
    try {
        const filePath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        if (fs.existsSync(filePath)) {
            driverServiceAccount = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } else {
            console.error(`Hata: Sürücü serviceAccountKey.json dosyası bulunamadı: ${filePath}. Lütfen .env'deki GOOGLE_APPLICATION_CREDENTIALS yolunu kontrol edin.`);
        }
    } catch (error) {
        console.error("GOOGLE_APPLICATION_CREDENTIALS'dan sürücü anahtarı yüklenirken hata oluştu:", error);
    }
} else {
    console.error("Sürücü Firebase kimlik bilgileri ortam değişkenlerinde bulunamadı. GOOGLE_SERVICE_ACCOUNT_KEY veya GOOGLE_APPLICATION_CREDENTIALS ayarını kontrol edin.");
}

// Müşteri projesi için servis hesabı anahtarını yükle
// Ortam değişkeni CUSTOMER_GOOGLE_APPLICATION_CREDENTIALS olarak belirtilmiş
if (process.env.CUSTOMER_GOOGLE_SERVICE_ACCOUNT_KEY) { // Heroku gibi ortamlar için
    customerServiceAccount = JSON.parse(process.env.CUSTOMER_GOOGLE_SERVICE_ACCOUNT_KEY);
} else if (process.env.CUSTOMER_GOOGLE_APPLICATION_CREDENTIALS) { // Lokal ortam için
    try {
        const filePath = process.env.CUSTOMER_GOOGLE_APPLICATION_CREDENTIALS;
        if (fs.existsSync(filePath)) {
            customerServiceAccount = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } else {
            console.error(`Hata: Müşteri customer_serviceAccountKey.json dosyası bulunamadı: ${filePath}. Lütfen .env'deki CUSTOMER_GOOGLE_APPLICATION_CREDENTIALS yolunu kontrol edin.`);
        }
    } catch (error) {
        console.error("CUSTOMER_GOOGLE_APPLICATION_CREDENTIALS'dan müşteri anahtarı yüklenirken hata oluştu:", error);
    }
} else {
    console.error("Müşteri Firebase kimlik bilgileri ortam değişkenlerinde bulunamadı. CUSTOMER_GOOGLE_SERVICE_ACCOUNT_KEY veya CUSTOMER_GOOGLE_APPLICATION_CREDENTIALS ayarını kontrol edin.");
}

// Firebase Admin SDK'yı her iki proje için de başlatın
let driverApp, customerApp;

if (driverServiceAccount) {
    driverApp = admin.initializeApp({
        credential: admin.credential.cert(driverServiceAccount)
        // Diğer Firebase yapılandırmalarınız buraya gelebilir (örn. databaseURL)
    }, 'driverApp'); // Sürücü uygulaması için benzersiz isim
    console.log("Sürücü Firebase Admin SDK başarıyla başlatıldı.");
} else {
    console.error("Sürücü Firebase Admin SDK başlatılamadı. Kimlik bilgilerinizi kontrol edin.");
}

if (customerServiceAccount) {
    customerApp = admin.initializeApp({
        credential: admin.credential.cert(customerServiceAccount)
        // Diğer Firebase yapılandırmalarınız buraya gelebilir (örn. databaseURL)
    }, 'customerApp'); // Müşteri uygulaması için benzersiz isim
    console.log("Müşteri Firebase Admin SDK başarıyla başlatıldı.");
} else {
    console.error("Müşteri Firebase Admin SDK başlatılamadı. Kimlik bilgilerinizi kontrol edin.");
}

// driverApp ve customerApp'i diğer router dosyaları tarafından erişilebilir hale getirin
// Bu, routes/taxis.js dosyasında bunları kullanmak için önemlidir.
module.exports.driverApp = driverApp;
module.exports.customerApp = customerApp;

// --- Firebase Uygulamaları Başlatma Sonu ---

// connectDB, app.set, app.use ve tüm router tanımlamaları (app.get, app.use) burada devam eder.
// ... (geri kalan server.js kodunuz aynı kalır) ...

connectDB();
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));