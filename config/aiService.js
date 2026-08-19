const { GoogleGenerativeAI } = require('@google/generative-ai');
const ApiUsage = require('../models/ApiUsage');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Daily free-tier limit (requests per day — adjust if your plan differs)
const DAILY_LIMIT = 20;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function prepareText(rawText, maxChars = 6000) {
  if (!rawText || typeof rawText !== 'string') return '';
  return rawText
    .replace(/\r\n/g, '\n')
    .replace(/[^\x20-\x7E\n]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .substring(0, maxChars);
}

async function callGemini(model, prompt, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      const isRateLimit =
        err.status === 429 ||
        (err.message && err.message.includes('429')) ||
        (err.message && err.message.toLowerCase().includes('quota'));
      if (isRateLimit && attempt < retries) {
        const waitMs = 5000 * Math.pow(2, attempt);
        console.warn(`Gemini rate limit hit. Retrying in ${waitMs / 1000}s…`);
        await new Promise((res) => setTimeout(res, waitMs));
        continue;
      }
      throw err;
    }
  }
}

function parseJsonArray(text) {
  let clean = text.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');
  const match = clean.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array found in AI response');
  return JSON.parse(match[0]);
}

/**
 * Log a Gemini API call to the ApiUsage collection.
 * Never throws — logging failures must not break the main flow.
 */
async function logUsage({ userId, operation, inputChars, outputChars, success, error, durationMs }) {
  try {
    await ApiUsage.create({
      triggeredBy: userId || null,
      operation,
      inputChars: inputChars || 0,
      outputChars: outputChars || 0,
      model: 'gemini-2.5-flash-lite',
      success,
      error: error || undefined,
      durationMs: durationMs || 0,
    });
  } catch (e) {
    console.error('ApiUsage log error (non-fatal):', e.message);
  }
}

/**
 * Get today's usage count for a user (or total if no userId).
 */
async function getTodayUsageCount(userId) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const query = { createdAt: { $gte: start }, success: true };
  if (userId) query.triggeredBy = userId;
  return ApiUsage.countDocuments(query);
}

// ─── Topic extraction ─────────────────────────────────────────────────────────

const extractTopicsAndSummaries = async (rawText, userId) => {
  const text = prepareText(rawText, 6000);
  if (!text || text.length < 30) {
    throw new Error('Not enough readable text to extract topics from.');
  }

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: { temperature: 0.4, topK: 40, topP: 0.9 },
  });

  // Prompt designed for application-oriented, example-rich learning content
  const prompt = `You are an expert instructional designer. Analyse the study material below and extract 5-10 distinct learning topics. For each topic produce rich, application-focused content that a student can immediately apply — not just theory.

Return ONLY a valid JSON array, no markdown fences:
[
  {
    "title": "Concise topic title (4-8 words)",
    "summary": "2 sentences explaining the core concept clearly.",
    "explanation": "3-4 sentences of deeper explanation. Use plain language. Connect the concept to how it actually works.",
    "realWorldExample": "One concrete real-world scenario showing this concept in action. Start with 'For example,' or 'Consider a case where...'",
    "keyPoints": ["Specific actionable insight 1", "Specific actionable insight 2", "Specific actionable insight 3"],
    "watchOut": "One common mistake or misconception students make about this topic.",
    "difficulty": "easy|normal|advanced"
  }
]

Difficulty guide: easy = definitions/basics, normal = application/understanding, advanced = analysis/synthesis.
Topics must be ordered logically (foundational first). All content must be specific to the material — no generic filler.

MATERIAL:
${text}`;

  const t0 = Date.now();
  let responseText;

  try {
    responseText = await callGemini(model, prompt);
    console.log('Gemini topic response (first 300 chars):', responseText.substring(0, 300));
  } catch (err) {
    await logUsage({ userId, operation: 'extract_topics', inputChars: text.length, outputChars: 0, success: false, error: err.message, durationMs: Date.now() - t0 });
    throw err;
  }

  await logUsage({
    userId,
    operation: 'extract_topics',
    inputChars: text.length,
    outputChars: responseText.length,
    success: true,
    durationMs: Date.now() - t0,
  });

  const topics = parseJsonArray(responseText);
  if (!Array.isArray(topics) || topics.length === 0) {
    throw new Error('AI returned an empty topics array');
  }

  return topics.map((t, i) => ({
    title: (t.title || `Topic ${i + 1}`).trim(),
    // Store the full rich content as JSON string in summary field (backward-compatible)
    summary: JSON.stringify({
      summary: (t.summary || '').trim(),
      explanation: (t.explanation || '').trim(),
      realWorldExample: (t.realWorldExample || '').trim(),
      keyPoints: Array.isArray(t.keyPoints) ? t.keyPoints.map(k => k.trim()).filter(Boolean) : [],
      watchOut: (t.watchOut || '').trim(),
    }),
    difficulty: ['easy', 'normal', 'advanced'].includes(t.difficulty) ? t.difficulty : 'normal',
  }));
};

// ─── Quiz generation ──────────────────────────────────────────────────────────

const generateQuizQuestions = async (topicTitle, topicSummary, count = 3, userId) => {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: { temperature: 0.5, topK: 40, topP: 0.9 },
  });

  const prompt = `Create ${count} multiple-choice questions for the topic below.

Topic: ${topicTitle}
Context: ${(topicSummary || '').substring(0, 300)}

Rules:
- Test understanding, not memorisation
- 4 options each, exactly 1 correct
- Distractors should reflect common misconceptions
- Mix question types: application, analysis, comprehension

Return ONLY a JSON array, no markdown:
[{"questionText":"Question?","options":["Correct","Wrong1","Wrong2","Wrong3"],"correctAnswer":"Correct","marks":1,"difficulty":"easy|normal|advanced","explanation":"One sentence why the answer is correct."}]`;

  const t0 = Date.now();
  let responseText;

  try {
    responseText = await callGemini(model, prompt);
    const questions = parseJsonArray(responseText);

    await logUsage({
      userId,
      operation: 'generate_quiz',
      inputChars: prompt.length,
      outputChars: responseText.length,
      success: true,
      durationMs: Date.now() - t0,
    });

    return questions.map((q, i) => {
      const options =
        Array.isArray(q.options) && q.options.length >= 2
          ? q.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 4)
          : ['Option A', 'Option B', 'Option C', 'Option D'];
      while (options.length < 4) options.push(`Option ${options.length + 1}`);
      const correctAnswer = q.correctAnswer?.trim() || options[0];
      return {
        questionText: (q.questionText || `Question ${i + 1} about ${topicTitle}`).trim(),
        options,
        correctAnswer: options.includes(correctAnswer) ? correctAnswer : options[0],
        marks: typeof q.marks === 'number' ? q.marks : 1,
        difficulty: ['easy', 'normal', 'advanced'].includes(q.difficulty) ? q.difficulty : 'normal',
        explanation: (q.explanation || '').trim(),
      };
    });
  } catch (error) {
    await logUsage({ userId, operation: 'generate_quiz', inputChars: prompt.length, outputChars: 0, success: false, error: error.message, durationMs: Date.now() - t0 });
    console.error('Gemini quiz generation error:', error.message);
    return generateFallbackQuestions(topicTitle, topicSummary, count);
  }
};

// ─── Fallback generators ──────────────────────────────────────────────────────

function generateFallbackTopics(rawText) {
  const paragraphs = (rawText || '')
    .split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 60).slice(0, 8);
  if (paragraphs.length === 0) {
    return [{ title: 'Introduction and Overview', summary: 'This section introduces the foundational concepts.', difficulty: 'easy' }];
  }
  const difficulties = ['easy', 'easy', 'normal', 'normal', 'normal', 'advanced', 'advanced', 'advanced'];
  return paragraphs.map((para, i) => {
    const sentences = para.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
    let title = (sentences[0] || `Key Concept ${i + 1}`).replace(/^(the|a|an)\s+/i, '').trim();
    if (title.length > 70) title = title.substring(0, 67) + '…';
    title = title.charAt(0).toUpperCase() + title.slice(1);
    return {
      title,
      summary: sentences.slice(0, 2).join('. ').substring(0, 280).trim() || 'This topic covers key concepts.',
      difficulty: difficulties[i % difficulties.length],
    };
  });
}

function generateFallbackQuestions(topicTitle, topicSummary, count) {
  const starters = ['What is the primary purpose of', 'Which statement best describes', 'How does', 'What would be the result of applying', 'Which approach is most effective for'];
  return Array.from({ length: count }, (_, i) => ({
    questionText: `${starters[i % starters.length]} ${topicTitle.toLowerCase()}?`,
    options: [`Applying the core principles of ${topicTitle}`, 'A common but incorrect interpretation', 'A partially correct but incomplete answer', 'An unrelated concept'],
    correctAnswer: `Applying the core principles of ${topicTitle}`,
    marks: 1,
    difficulty: i === 0 ? 'easy' : i === count - 1 ? 'advanced' : 'normal',
    explanation: `This question tests understanding of ${topicTitle}.`,
  }));
}

module.exports = { extractTopicsAndSummaries, generateQuizQuestions, getTodayUsageCount, DAILY_LIMIT };
