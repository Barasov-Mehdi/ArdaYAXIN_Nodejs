const express = require('express');
const router = express.Router();

// Ana sayfa rotası
router.get('/', (req, res) => {
    res.render('index'); // index.ejs dosyasını render et
});

module.exports = router;