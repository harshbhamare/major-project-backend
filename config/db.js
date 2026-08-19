const mongoose = require('mongoose');

// Cache the connection across serverless invocations
let isConnected = false;

const connectDB = async () => {
  if (isConnected) return;

  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    isConnected = true;
    console.log(`MongoDB connected`);
  } catch (error) {
    console.error(`MongoDB connection error: ${error.message}`);
    // Do NOT call process.exit() — it crashes Vercel serverless functions.
    // Let the request fail gracefully instead.
    throw error;
  }
};

module.exports = connectDB;
