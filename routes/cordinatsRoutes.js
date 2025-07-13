const express = require('express');
const router = express.Router();
const Coordinate = require('../models/cordinatsDb');

// ✔️ Tüm koordinatları getir
router.get('/', async (req, res) => {
    try {
        const coordinates = await Coordinate.find();
        res.json(coordinates);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ✔️ Belirli bir koordinatı getir (ID ile)
router.get('/:id', async (req, res) => {
    try {
        const coordinate = await Coordinate.findById(req.params.id);
        if (!coordinate) {
            return res.status(404).json({ message: 'Koordinat bulunamadı' });
        }
        res.json(coordinate);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ✔️ Yeni koordinat ekle
router.post('/', async (req, res) => {
    const { addressName, latitude, longitude } = req.body;
    try {
        const newCoord = new Coordinate({ addressName, latitude, longitude });
        await newCoord.save();

        // Eğer tarayıcıdan gelindiyse yönlendir:
        if (req.headers.accept.includes('text/html')) {
            return res.redirect('/add-coordinates'); // forma geri dön
        }

        // API kullanımı için JSON dön
        res.status(201).json({ message: 'Koordinat eklendi', data: newCoord });

    } catch (error) {
        if (req.headers.accept.includes('text/html')) {
            return res.status(400).send('Koordinat eklenirken hata oluştu.');
        }
        res.status(400).json({ error: error.message });
    }
});

// ✔️ Koordinat güncelle (ID ile)
router.put('/:id', async (req, res) => {
    const { addressName, latitude, longitude } = req.body;
    try {
        const updatedCoord = await Coordinate.findByIdAndUpdate(
            req.params.id,
            { addressName, latitude, longitude },
            { new: true, runValidators: true }
        );
        if (!updatedCoord) {
            return res.status(404).json({ message: 'Koordinat bulunamadı' });
        }
        res.json({ message: 'Koordinat güncellendi', data: updatedCoord });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ✔️ Koordinat sil (ID ile)
router.delete('/:id', async (req, res) => {
    try {
        const deletedCoord = await Coordinate.findByIdAndDelete(req.params.id);
        if (!deletedCoord) {
            return res.status(404).json({ message: 'Koordinat bulunamadı' });
        }
        res.json({ message: 'Koordinat silindi' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
