const express = require('express');
const router = express.Router();
const PriceTier = require('../models/PriceTier');

// Get all
router.get('/', async (req, res) => {
    try {
        const tiers = await PriceTier.find().sort('maxKm');
        res.json(tiers);
    } catch (err) {
        res.status(500).json({ msg: 'Sunucu hatası' });
    }
});

// Add new
router.post('/', async (req, res) => {
    const { maxKm, price } = req.body;
    try {
        const newTier = new PriceTier({ maxKm, price });
        await newTier.save();
        res.json(newTier);
    } catch (err) {
        res.status(500).json({ msg: 'Sunucu hatası' });
    }
});

// Update
router.put('/:id', async (req, res) => {
    const { maxKm, price } = req.body;
    try {
        const tier = await PriceTier.findById(req.params.id);
        if (!tier) return res.status(404).json({ msg: 'Fiyat katmanı bulunamadı' });
        tier.maxKm = maxKm;
        tier.price = price;
        await tier.save();
        res.json(tier);
    } catch (err) {
        res.status(500).json({ msg: 'Sunucu hatası' });
    }
});

// Delete
router.delete('/:id', async (req, res) => {
    try {
        const deleted = await PriceTier.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ msg: 'Fiyat katmanı bulunamadı' });
        res.json({ msg: 'Fiyat katmanı silindi' });
    } catch (err) {
        console.error('Silme hatası:', err);
        res.status(500).json({ msg: 'Sunucu hatası' });
    }
});

module.exports = router;