# 🚀 Learneo — Backend API & Adaptive Engine

> Robust Node.js / Express backend powering **Learneo** — an AI-driven personalized adaptive learning and assessment platform.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.18-blue.svg)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose%208-brightgreen.svg)](https://www.mongodb.com/)
[![Gemini AI](https://img.shields.io/badge/Google%20Gemini-2.5%20Flash-orange.svg)](https://aistudio.google.com/)
[![Vercel Ready](https://img.shields.io/badge/Deployment-Vercel%20Serverless-black.svg)](https://vercel.com/)

---

## 🌟 Key Capabilities

1. **Adaptive Learning Loop**:
   - Progressive curriculum laddering (ensures students master fundamental micro-concepts sequentially).
   - Real-time Exponential Moving Average (EMA) topic mastery calculation ($M_{new} = \alpha \cdot S + (1-\alpha) \cdot M_{old}$).
   - Dynamic remediation strategies: worked examples, simplified analogies, and misconception corrections.

2. **6 Unified Assessment Formats**:
   - **MCQ**: Knowledge verification with randomized distractors.
   - **Short Answer**: Conceptual check with keyword and semantic scoring.
   - **Code Completion**: Fill-in-the-blank code logic.
   - **Code Tracing**: Output prediction given exact code snippets.
   - **Debugging**: Locating bugs and formulating targeted fixes.
   - **Scenario-Based**: Practical real-world problem-solving.

3. **Live Classrooms & Faculty Tools**:
   - Instant room codes & shareable QR codes.
   - Atomic roster enrollment (`$addToSet` to prevent duplicate members).
   - Real-time student struggle detection (`needs_intervention`, `developing`, `mastered`).
   - One-click Excel/CSV export of classroom attendance and cohort diagnostics.

4. **Vercel Serverless Optimized**:
   - Cached MongoDB connection pooling prevents lambda cold-start timeout.
   - Zero-config serverless handler via `api/index.js`.
   - Dynamic CORS matching for local development and all `*.vercel.app` deployments.

---

## 📁 Project Architecture

```
backend/
├── api/
│   └── index.js              # Vercel serverless function entrypoint
├── config/
│   ├── db.js                 # Cached MongoDB singleton connection
│   └── aiService.js          # Google Gemini AI prompts & robust fallbacks
├── controllers/
│   ├── adaptiveActivityController.js # Step-by-step adaptive session lifecycle
│   ├── authController.js     # User registration, login & JWT auth
│   ├── contentController.js  # Syllabus/document upload & topic extraction
│   ├── moduleController.js   # Module builder & curriculum sequencing
│   ├── quizController.js     # Multi-format quiz builder
│   ├── resultController.js   # Cohort analytics, score buckets, weak topics
│   └── roomController.js     # Live classroom sessions & roster management
├── middleware/
│   └── authMiddleware.js     # JWT token verification & role authorization
├── models/                   # Mongoose schemas (User, Module, Topic, Quiz, etc.)
├── routes/                   # RESTful API route definitions
├── services/                 # Adaptive learning policies & assessment evaluators
├── validators/               # Schema & format validation
├── server.js                 # Express server configuration
└── vercel.json               # Vercel serverless deployment routing
```

---

## ⚙️ Environment Variables

Create a `.env` file in the `backend/` directory (see `.env.example`):

| Variable | Description | Example |
| :--- | :--- | :--- |
| `PORT` | Local server port | `5000` |
| `NODE_ENV` | Environment mode | `development` or `production` |
| `MONGO_URI` | MongoDB connection URI (Atlas or local) | `mongodb+srv://user:pass@cluster.mongodb.net/learneo` |
| `JWT_SECRET` | Secret key for JWT auth (>= 32 chars) | `your_secure_random_jwt_secret_here` |
| `GEMINI_API_KEY` | Google Gemini AI API Key | `AIzaSy...` |
| `GEMINI_MODEL` | Gemini Model identifier | `gemini-2.5-flash-lite` |
| `ALLOWED_ORIGINS` | Permitted frontend origins (comma-separated) | `http://localhost:3000,https://your-frontend.vercel.app` |
| `FRONTEND_URL` | Base URL used for Room QR codes | `http://localhost:3000` |

---

## 💻 Local Development

```bash
# 1. Install dependencies
npm install

# 2. Start development server with nodemon
npm run dev

# 3. Or start production server
npm start
```

### Health Check Endpoint
```bash
curl http://localhost:5000/api/health
```

---

## 🧪 Testing

Run comprehensive validation suites:

```bash
# Test all 6 assessment formats, schema validators, rubrics & security
node test_assessment_formats.js

# Test adaptive learning loops, EMA calculation & fallback generation
node test_adaptive_loop.js
```

---

## 🚀 Deployment to Vercel

1. Push your backend code to GitHub.
2. Log in to [Vercel](https://vercel.com) and click **"Add New Project"**.
3. Import your `major-project-backend` repository.
4. Framework Preset: **Other** (Root directory: `./`).
5. In **Environment Variables**, add:
   - `MONGO_URI`: Your MongoDB Atlas connection string (ensure IP Access List in Atlas allows `0.0.0.0/0`).
   - `JWT_SECRET`: A secure string >= 32 characters.
   - `GEMINI_API_KEY`: Your Gemini API key from AI Studio.
   - `GEMINI_MODEL`: `gemini-2.5-flash-lite`
   - `NODE_ENV`: `production`
6. Click **Deploy**. Vercel will automatically provision the serverless function.
