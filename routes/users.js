const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');
// routes/users.js

router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// routes/users.js
router.post('/register', async (req, res) => {
  const { name, email, tel } = req.body;

  try {
    const existingUser = await User.findOne({
      $or: [{ email: email }, { tel: tel }]
    });

    if (existingUser) {
      return res.status(400).json({ msg: 'Bu email veya telefon numarası zaten kullanılıyor.' });
    }

    const newUser = new User({
      name,
      email,
      tel
    });

    await newUser.save();

    res.status(201).json({ msg: 'Kayıt başarılı', user: newUser });
  } catch (err) {
    console.error('Kayıt sırasında hata:', err);
    res.status(500).json({ msg: 'Sunucu hatası' });
  }
});

// Login User
router.post('/login', async (req, res) => {
  const { email, tel } = req.body;

  try {
    // Check if user exists
    let user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ msg: 'Email tapılmadı' });
    }

    // Check if tel matches
    if (user.tel !== tel) {
      return res.status(400).json({ msg: 'Yanlış telefon nömrəsi' });
    }

    // Return JWT
    const payload = {
      user: {
        id: user.id
      }
    };

    jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: 360000 },
      (err, token) => {
        if (err) throw err;
        res.json({ token });
      }
    );
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// if not, you might want to add that or define how you get the user location
router.get('/current-location', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('coordinates'); // Adjust based on your model
    if (!user || !user.coordinates) {
      return res.status(404).json({ msg: 'Kullanıcı koordinatları bulunamadı.' });
    }
    res.json(user.coordinates); // Sending back the coordinates
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

router.get('/by-name', async (req, res) => {
  const { name } = req.query;
  if (!name) {
    return res.status(400).json({ message: 'User name is required for search.' });
  }
  try {
    // Case-insensitive search for users by name
    const users = await User.find({ name: { $regex: new RegExp(name, 'i') } });
    if (users.length === 0) {
      return res.status(404).json({ message: 'No users found with that name.' });
    }
    res.json(users);
  } catch (error) {
    console.error('Error searching users by name:', error);
    res.status(500).json({ message: 'Server error while searching users.' });
  }
});

// GET kullanıcının bilgilerini getir
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ msg: 'Kullanıcı bulunamadı' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ msg: 'Sunucu hatası' });
  }
});

// PUT kullanıcının bilgilerini güncelle
router.put('/:id', async (req, res) => {
  const { name, email, tel } = req.body;
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name, email, tel },
      { new: true }
    );
    res.json({ msg: 'Güncelleme başarılı', user });
  } catch (err) {
    res.status(500).json({ msg: 'Güncelleme başarısız' });
  }
});

// DELETE kullanıcının hesabını sil
router.delete('/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ msg: 'Kullanıcı silindi' });
  } catch (err) {
    res.status(500).json({ msg: 'Sunucu hatası' });
  }
});

// routes/users.js dosyasında yeni bir rota ekleyin
router.post('/update-fcm-token', async (req, res) => {
  const { userId, fcmToken } = req.body;
  try {
  
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Kullanıcı bulunamadı.' });
    }
    user.fcmToken = fcmToken; // Kullanıcının FCM token'ını güncelle
    await user.save();
    res.status(200).json({ message: 'FCM Token başarıyla güncellendi.' });
  } catch (error) {
    console.error('FCM Token güncellenirken hata:', error);
    res.status(500).json({ message: 'FCM Token güncellenirken sunucu hatası.' });
  }
});

module.exports = router;
