const express = require('express');
const router = express.Router();
const Helps = require('../models/Helps');

// Help request route
router.post('/', async (req, res) => {  // Change this line
    const { firstLname, phone, email, helpText } = req.body;

    if (!firstLname || !phone || !email || !helpText) {
        return res.status(400).json({ msg: "All fields are required." });
    }

    try {
        const helps = new Helps({
            firstLname,
            phone,
            email,
            helpText
        });
        await helps.save();

        return res.status(201).json({ msg: "Help request submitted successfully", helps });

    } catch (err) {
        console.error(err.message);
        return res.status(500).json({ msg: "Server error", error: err.message });
    }
});

router.get('/', async (req, res) => { // Bu route /api/help'e GET isteği geldiğinde çalışacak
    try {
        // Veritabanındaki tüm Help belgelerini bul
        const helpRequests = await Helps.find().sort({ _id: -1 }); // En son eklenenleri üste almak için

        // helpMessages.ejs view dosyasını render et ve verileri gönder
        res.render('helpMessages', { helpRequests: helpRequests });

    } catch (err) {
        console.error(err.message);
        // Hata durumunda bir hata sayfası veya mesajı render et
        res.status(500).render('error', { message: 'Yardım talepleri alınırken bir hata oluştu.' });
    }
});
module.exports = router;