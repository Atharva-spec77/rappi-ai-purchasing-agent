const mongoose = require("mongoose");

async function connectDb(uri) {
  const url = uri || process.env.MONGO_URL;
  const dbName = process.env.DB_NAME || "rappi_purchasing_agent";
  if (!url) throw new Error("MONGO_URL env variable is required");
  await mongoose.connect(url, { dbName });
  // eslint-disable-next-line no-console
  console.log(`[rappi-agent] connected to MongoDB db=${dbName}`);
  return mongoose.connection;
}

async function disconnectDb() {
  await mongoose.disconnect();
}

module.exports = { connectDb, disconnectDb };
