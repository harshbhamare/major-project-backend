require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const fs        = require('fs');
const connectDB = require('./config/db');

const app = express();

// ── Trust Vercel's proxy (required for express-rate-limit and req.ip) ─────────
app.set('trust proxy', 1);

// ── Connect DB (cached — safe for serverless) ─────────────────────────────────
connectDB().catch(err => console.error('DB connect failed:', err.message));

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push('http://localhost:3000');
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (Postman, mobile, server-to-server)
    if (!origin) return callback(null, true);
    // If no allowed origins configured, permit everything (open during initial setup)
    if (allowedOrigins.length === 0) return callback(null, true);
    // Check against whitelist — never throw, just deny with null
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false); // deny silently — browser shows CORS error, not 500
  },
  credentials: true,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Note: uses in-memory store — resets per serverless instance (acceptable for free tier)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please try again in 15 minutes.' },
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
});

app.use('/api/auth', authLimiter);
app.use('/api', generalLimiter);

// ── Static uploads (local dev only — use cloud storage in production) ─────────
// Vercel's filesystem is read-only; skip directory creation on serverless
if (process.env.NODE_ENV !== 'production') {
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  app.use('/uploads', express.static(uploadsDir));
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',    require('./routes/authRoutes'));
app.use('/api/content', require('./routes/contentRoutes'));
app.use('/api/topics',  require('./routes/topicRoutes'));
app.use('/api/modules', require('./routes/moduleRoutes'));
app.use('/api/quizzes', require('./routes/quizRoutes'));
app.use('/api/results', require('./routes/resultRoutes'));
app.use('/api/rooms',   require('./routes/roomRoutes'));
app.use('/api/admin',   require('./routes/adminRoutes'));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', env: process.env.NODE_ENV, timestamp: new Date().toISOString() })
);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ message: 'Resource not found.' }));

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const isDev = process.env.NODE_ENV !== 'production';
  console.error(`[${new Date().toISOString()}] ${err.message}`);

  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(413).json({ message: 'File too large. Maximum size is 100 MB.' });
  if (err.message?.startsWith('Only PDF'))
    return res.status(400).json({ message: err.message });

  res.status(err.status || 500).json({
    message: isDev ? err.message : 'An unexpected error occurred.',
    ...(isDev && { stack: err.stack }),
  });
});

// ── Local dev server ──────────────────────────────────────────────────────────
// On Vercel this file is imported as a module — do NOT call listen().
// Vercel detects the export and handles HTTP itself.
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () =>
    console.log(`Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`)
  );
}

// Export for Vercel serverless
module.exports = app;
