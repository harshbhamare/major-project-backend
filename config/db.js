const mongoose = require('mongoose');

let cachedPromise = null;

const connectDB = async () => {
  // 1 = connected
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  // Reset cached promise if connection is disconnected (readyState === 0)
  if (mongoose.connection.readyState === 0) {
    cachedPromise = null;
  }

  // 2 = connecting (wait for in-flight connection)
  if (mongoose.connection.readyState === 2 && cachedPromise) {
    return cachedPromise;
  }

  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI environment variable is not defined.');
  }

  try {
    cachedPromise = mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    const conn = await cachedPromise;
    console.log(`MongoDB connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    cachedPromise = null;
    console.error(`MongoDB connection error: ${error.message}`);
    throw error;
  }
};

module.exports = connectDB;

