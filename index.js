require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const authRoutes = require('./routes/auth');
const fuelTypeRoutes = require('./routes/fuelTypes');
const unitRoutes = require('./routes/units');
const nozzleRoutes = require('./routes/nozzles');
const userRoutes = require('./routes/users');
const customerRoutes = require('./routes/customers');
const readingRoutes = require('./routes/readings');
const tankRoutes = require('./routes/tanks');
const cashbookRoutes = require('./routes/cashbook');
const densityRoutes = require('./routes/density');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'API is running' });
});

// On Vercel, this module is loaded fresh (or reused warm) per invocation
// rather than run once at boot, so the DB connection is established lazily
// and cached — reused across warm invocations instead of reconnecting
// every request, and never blocking route registration itself.
let dbConnection = null;
function connectDB() {
  if (!dbConnection) {
    dbConnection = mongoose.connect(process.env.MONGODB_URI).then((m) => {
      console.log('Connected to MongoDB Atlas');
      return m;
    });
    dbConnection.catch(() => {
      // Let the request that awaits this see the error; clear the cache so
      // the next request retries the connection instead of reusing a failure.
      dbConnection = null;
    });
  }
  return dbConnection;
}

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(500).json({ message: 'Database connection error', error: err.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/fuel-types', fuelTypeRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/nozzles', nozzleRoutes);
app.use('/api/users', userRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/readings', readingRoutes);
app.use('/api/tanks', tankRoutes);
app.use('/api/cashbook', cashbookRoutes);
app.use('/api/density', densityRoutes);

// Running directly (`node index.js` / `npm start` / `npm run dev`) starts a
// normal long-lived server. On Vercel, index.js is imported as a serverless
// function handler instead — app.listen() is never called there.
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  connectDB()
    .then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)))
    .catch((err) => {
      console.error('MongoDB connection error:', err.message);
      process.exit(1);
    });
}

module.exports = app;
