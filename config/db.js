const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log(`MongoDB bağlandı: ${conn.connection.host}`);
  } catch (error) {
    console.error(`MongoDB bağlantı hatası: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
