// Express app entry — bootstraps the HTTP server, DB connection and routes.
// All business routes live under the /api prefix so they can be reverse-proxied
// through the platform's Kubernetes ingress.
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { connectDb } = require('./config/db');
const router = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/error');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

app.use('/api', router);
app.use('/api', notFoundHandler);
app.use(errorHandler);

const PORT = Number(process.env.NODE_PORT || 5001);

async function start() {
  await connectDb();
  app.listen(PORT, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`[rappi-agent] Node backend listening on 0.0.0.0:${PORT}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[rappi-agent] fatal boot error:', err);
    process.exit(1);
  });
}

module.exports = { app, start };
