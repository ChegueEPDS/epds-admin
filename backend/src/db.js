const mongoose = require('mongoose');

async function connectDb() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI');

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log('[db] connected');
}

module.exports = { connectDb };
