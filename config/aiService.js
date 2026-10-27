const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');
const ApiUsage = require('../models/ApiUsage');
const { validateAssessment } = require('../validators/assessmentValidator');
const { evaluateAssessment } = require('../services/assessmentEvaluator');
const { getAdaptiveFallbackQuestion } = require('./adaptiveFallbackBank');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ── Configuration — all tunable via .env ──────────────────────────────────────
// GEMINI_MODEL: which model to use (change in .env to switch models)
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

// GEMINI_DAILY_LIMIT: free-tier call budget. Change in .env without redeploying.
const DAILY_LIMIT = parseInt(process.env.GEMINI_DAILY_LIMIT || '20', 10);

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

let geminiCooldownUntil = 0;

async function callGemini(model, prompt, retries = 1) {
  if (Date.now() < geminiCooldownUntil) {
    throw new Error('Gemini quota limit active. Using immediate fallback.');
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      const isRateLimit =
        err.status === 429 ||
        (err.message && err.message.includes('429')) ||
        (err.message && err.message.toLowerCase().includes('quota')) ||
        (err.message && err.message.toLowerCase().includes('retry in'));

      if (isRateLimit) {
        // Daily quota exhausted or severe rate limit — avoid long blocking sleeps
        geminiCooldownUntil = Date.now() + 60000; // 60s cooldown
        console.warn('Gemini quota limit reached; activating immediate fallback mode.');
        throw err;
      }

      if (attempt < retries) {
        const waitMs = 1500 * (attempt + 1);
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
    if (mongoose.connection.readyState !== 1) return;
    await ApiUsage.create({
      triggeredBy: userId || null,
      operation,
      inputChars: inputChars || 0,
      outputChars: outputChars || 0,
      model: GEMINI_MODEL,
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
    model: GEMINI_MODEL,
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
    model: GEMINI_MODEL,
    generationConfig: { temperature: 0.5, topK: 40, topP: 0.9 },
  });

  const prompt = `You are a supportive, expert computer science educator creating diagnostic quiz questions for students.
Create ${count} high-quality multiple-choice questions for the topic below.

Topic: ${topicTitle}
Context / Summary: ${(topicSummary || '').substring(0, 400)}

Pedagogical Guidelines:
1. Focus on practical understanding, application, and real code reasoning — avoid trivial trivia or syntax memorization.
2. Provide exactly 4 realistic options (1 correct answer and 3 plausible distractors).
3. Distractors must target genuine student misconceptions and explainable mistakes.
4. Explanations must be educational for students: explain why the correct choice works, why the main distractor is a trap, and a quick student pro-tip.
5. Difficulty should be balanced: easy (conceptual foundations), normal (standard application), advanced (edge cases/analysis).

Return ONLY a valid JSON array, no markdown fences:
[
  {
    "questionText": "Clear, engaging question ending with ?",
    "options": ["Correct answer", "Plausible distractor 1", "Plausible distractor 2", "Plausible distractor 3"],
    "correctAnswer": "Correct answer",
    "marks": 1,
    "difficulty": "easy|normal|advanced",
    "explanation": "Correct because [clear reason]. Common mistake: [why distractor is tempting but incorrect]. Pro-tip: [practical takeaway for students]."
  }
]`;

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

// ─── Adaptive content generation (spec §12) ──────────────────────────────────

/**
 * Generate targeted learning content for a specific knowledge gap.
 * Input is a structured adaptation plan from adaptationService.
 *
 * Architecture: adaptationService decides WHAT; aiService decides HOW.
 *
 * @param {object} plan — from adaptationService.getNextLearningAction()
 * @param {string} topicSummary — existing topic summary for context
 * @param {string} userId
 */
/**
 * Helper: Build rich fallback animation steps for any programming topic.
 * Ensures the student always receives an interactive visual walkthrough.
 */
function buildDefaultAnimation(topicTitle = '', isBeginner = true) {
  const t = topicTitle.toLowerCase();

  if (/loop|range|iteration|for\b|while\b/i.test(t)) {
    return {
      type: 'iteration_loop',
      conceptTitle: `Looping through Steps in ${topicTitle}`,
      description: 'See how the computer repeats an action step-by-step until the condition is met.',
      steps: [
        {
          step: 1,
          title: 'Start the Counter',
          description: 'We initialize our counter variable i at 0. The loop checks: is i < 3? Yes (0 < 3)!',
          codeLine: 'for (let i = 0; i < 3; i++)',
          visualState: { counter: 0, condition: '0 < 3 (TRUE)', action: 'Entering loop body', itemsProcessed: [] },
        },
        {
          step: 2,
          title: 'First Lap: Process Item',
          description: 'The code inside runs for item 0. Then i increases from 0 to 1.',
          codeLine: '  console.log("Processed: " + i);',
          visualState: { counter: 1, condition: '1 < 3 (TRUE)', action: 'Printed item 0, incremented i to 1', itemsProcessed: ['Item 0'] },
        },
        {
          step: 3,
          title: 'Second Lap: Repeat',
          description: 'The loop repeats for item 1. It checks 1 < 3 (True), runs, and increments i to 2.',
          codeLine: '  console.log("Processed: " + i);',
          visualState: { counter: 2, condition: '2 < 3 (TRUE)', action: 'Printed item 1, incremented i to 2', itemsProcessed: ['Item 0', 'Item 1'] },
        },
        {
          step: 4,
          title: 'Final Lap & Exit',
          description: 'The loop runs for item 2. Then i becomes 3. 3 < 3 is FALSE, so the loop gracefully finishes!',
          codeLine: '// Loop ends when condition is false',
          visualState: { counter: 3, condition: '3 < 3 (FALSE)', action: 'Loop finished successfully!', itemsProcessed: ['Item 0', 'Item 1', 'Item 2'] },
        },
      ],
    };
  }

  if (/if|else|condition|when|switch|logic|branch/i.test(t)) {
    return {
      type: 'flow_diagram',
      conceptTitle: `Decision Making in ${topicTitle}`,
      description: 'See how the computer tests a condition and chooses which road to take.',
      steps: [
        {
          step: 1,
          title: 'Inspect the Input',
          description: 'We have a variable: let score = 85. The program arrives at the decision gate.',
          codeLine: 'let score = 85;',
          visualState: { inputVal: 'score = 85', gate: 'Is score >= 50?', activePath: 'evaluating' },
        },
        {
          step: 2,
          title: 'Evaluate the Question',
          description: 'Computer checks: Is 85 greater than or equal to 50? Yes! The answer is TRUE.',
          codeLine: 'if (score >= 50) {',
          visualState: { inputVal: 'score = 85', gate: '85 >= 50 -> TRUE', activePath: 'true_branch' },
        },
        {
          step: 3,
          title: 'Take the TRUE Road',
          description: 'The program enters the if-block and runs the success action, skipping the else-block entirely!',
          codeLine: '  console.log("Passed!");\n}',
          visualState: { inputVal: 'score = 85', gate: 'TRUE Branch Taken', activePath: 'output', output: '"Passed!"' },
        },
      ],
    };
  }

  if (/function|method|call|execution|structure|entry/i.test(t)) {
    return {
      type: 'code_execution',
      conceptTitle: `Function & Execution Flow: ${topicTitle}`,
      description: 'Watch how inputs flow into a function and return an output.',
      steps: [
        {
          step: 1,
          title: 'Define the Blueprint',
          description: 'A function is like a recipe card waiting to be used with specific inputs.',
          codeLine: 'function greet(name) {',
          visualState: { stage: 'Function Defined', stack: ['main()'], input: 'name parameter' },
        },
        {
          step: 2,
          title: 'Call the Function with Data',
          description: 'We call greet("Alex"). The value "Alex" flows into the "name" slot.',
          codeLine: 'greet("Alex");',
          visualState: { stage: 'Calling greet("Alex")', stack: ['main()', 'greet("Alex")'], input: 'name = "Alex"' },
        },
        {
          step: 3,
          title: 'Produce the Result',
          description: 'The function builds the greeting message and hands it back to the caller.',
          codeLine: '  return "Hello, " + name + "!";',
          visualState: { stage: 'Returning Result', stack: ['main()'], output: '"Hello, Alex!"' },
        },
      ],
    };
  }

  // Default: Memory & Variable Box Animation
  return {
    type: 'box_memory',
    conceptTitle: `Storage & State: ${topicTitle}`,
    description: 'Watch how the computer creates labeled storage and stores data inside.',
    steps: [
      {
        step: 1,
        title: 'Create the Storage Box',
        description: 'The computer reserves a memory slot and labels it with our variable name.',
        codeLine: 'let userScore;',
        visualState: { boxLabel: 'userScore', boxValue: '(empty)', action: 'Box created in memory' },
      },
      {
        step: 2,
        title: 'Drop Value Inside (= Assignment)',
        description: 'The = symbol acts as the delivery worker, placing the value 100 into the box.',
        codeLine: 'userScore = 100;',
        visualState: { boxLabel: 'userScore', boxValue: '100', action: 'Value 100 placed inside box' },
      },
      {
        step: 3,
        title: 'Read / Update the Box',
        description: 'Anytime we use userScore, the computer opens the box and reads the number 100.',
        codeLine: 'console.log(userScore + 20); // prints 120',
        visualState: { boxLabel: 'userScore', boxValue: '100', action: 'Read 100 + 20 = 120' },
      },
    ],
  };
}

/**
 * generateAdaptiveContent(plan, topicSummary, userId)
 *
 * Generates clear, beginner-friendly, jargon-free teaching content with
 * everyday real-world analogies and animated visual steps.
 *
 * @param {object} plan
 * @param {string} topicSummary
 * @param {string} userId
 */
const generateAdaptiveContent = async (plan, topicSummary, userId) => {
  const {
    topicTitle, mastery, contentStrategy, difficulty, bloomLevel, trend,
  } = plan;

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { temperature: 0.35, topK: 40, topP: 0.9 },
  });

  const isBeginner = (difficulty === 'easy' || mastery < 0.60);

  const prompt = `You are a warm, engaging, world-class programming tutor teaching a student who finds technical jargon intimidating.
Your goal is to explain this specific concept in CRYSTAL CLEAR, SIMPLE, EVERYDAY WORDS with an interactive animated visual breakdown.

CRITICAL PEDAGOGY RULES:
1. BAN JARGON: Do NOT use heavy academic words or enterprise buzzwords (e.g. no "distributed systems", "polymorphic invariants", "latency SLAs", "encapsulation patterns"). Use plain, friendly English.
2. EVERYDAY ANALOGY: Compare the concept to something familiar (a labeled kitchen jar, a toy train, a playlist, a recipe card, a checklist).
3. LASER-FOCUSED ON MINUTE TOPIC: Focus strictly on "${topicTitle}". Start from the absolute simplest building blocks.
4. ANIMATION STEPS: Provide 3 to 4 sequential visual animation steps that explain what happens inside the computer step-by-step.

STUDENT CONTEXT:
- Concept: ${topicTitle}
${topicSummary ? `- Course Reference Material: ${topicSummary.slice(0, 1500)}` : ''}
- Learner Stage: ${isBeginner ? 'Foundational (teach clearly with gentle steps)' : 'Reinforcement (practical clarity)'}
- Focus: Practical understanding, real intuition, and zero confusing jargon

Return ONLY a valid JSON object without markdown fences:
{
  "headline": "Friendly headline (max 7 words, e.g. Understanding Variables in Simple Steps)",
  "analogy": "A memorable 1-2 sentence real-world analogy (e.g. Think of a variable like a labeled storage box...)",
  "explanation": "Clear, friendly explanation in 2-3 short, calm sentences that build natural intuition.",
  "animation": {
    "type": "${/loop/i.test(topicTitle) ? 'iteration_loop' : /if|condition/i.test(topicTitle) ? 'flow_diagram' : /function/i.test(topicTitle) ? 'code_execution' : 'box_memory'}",
    "conceptTitle": "${topicTitle}",
    "description": "Short 1-sentence summary of what this animation demonstrates.",
    "steps": [
      {
        "step": 1,
        "title": "Short title of step 1",
        "description": "Plain English description of what happens at this step.",
        "codeLine": "1 line of simple code",
        "visualState": {
          "boxLabel": "name",
          "boxValue": "value",
          "action": "action taking place"
        }
      },
      {
        "step": 2,
        "title": "Short title of step 2",
        "description": "Plain English description of what happens at this step.",
        "codeLine": "1 line of simple code",
        "visualState": {
          "boxLabel": "name",
          "boxValue": "updated value",
          "action": "action taking place"
        }
      },
      {
        "step": 3,
        "title": "Short title of step 3",
        "description": "Plain English description of the final result.",
        "codeLine": "1 line of simple code",
        "visualState": {
          "boxLabel": "name",
          "boxValue": "final result",
          "action": "action taking place"
        }
      }
    ]
  },
  "workedExample": "Clean, simple 2-4 line code walkthrough with beginner-friendly comments.",
  "keyInsight": "One golden rule the student will always remember (1 short sentence).",
  "misconceptionAddressed": "One common beginner trap and how to easily avoid it."
}`;

  const t0 = Date.now();
  try {
    const responseText = await callGemini(model, prompt);
    await logUsage({ userId, operation: 'generate_quiz', inputChars: prompt.length, outputChars: responseText.length, success: true, durationMs: Date.now() - t0 });

    let clean = responseText.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object in adaptive content response');
    const parsed = JSON.parse(match[0]);

    const toStr = (v) => {
      if (!v || v === null) return null;
      if (typeof v === 'string') return v.trim() || null;
      if (typeof v === 'object') {
        return Object.entries(v)
          .map(([k, val]) => Array.isArray(val) ? `${k}:\n${val.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}` : `${k}: ${val}`)
          .join('\n');
      }
      return String(v).trim() || null;
    };

    const anim = (parsed.animation && typeof parsed.animation === 'object' && Array.isArray(parsed.animation.steps) && parsed.animation.steps.length > 0)
      ? parsed.animation
      : buildDefaultAnimation(topicTitle, isBeginner);

    return {
      headline:               toStr(parsed.headline) || `Mastering ${topicTitle}`,
      analogy:                toStr(parsed.analogy) || `Think of ${topicTitle} like a clear, step-by-step set of instructions.`,
      explanation:            toStr(parsed.explanation),
      animation:              anim,
      workedExample:          toStr(parsed.workedExample),
      practicePrompt:         toStr(parsed.practicePrompt),
      keyInsight:             toStr(parsed.keyInsight),
      misconceptionAddressed: toStr(parsed.misconceptionAddressed),
    };
  } catch (err) {
    await logUsage({ userId, operation: 'generate_quiz', inputChars: prompt.length, outputChars: 0, success: false, error: err.message, durationMs: Date.now() - t0 });
    console.error('generateAdaptiveContent error (falling back to structured beginner guide):', err.message);

    const defaultAnim = buildDefaultAnimation(topicTitle, isBeginner);

    return {
      headline:                `Easy Guide: Understanding ${topicTitle}`,
      analogy:                 `Think of ${topicTitle} like a labeled storage container on your desk — you give it a clear name so you can put something inside and find it easily later.`,
      explanation:             `In programming, ${topicTitle} gives your computer clear instructions. Instead of memorizing complicated rules, focus on what the code is doing: setting up data, changing it, or checking a condition.`,
      animation:               defaultAnim,
      workedExample:           `// Simple step-by-step example:\nlet item = "Learning";\nconsole.log(item); // prints "Learning"`,
      practicePrompt:          `Can you describe in your own words what happens when this step runs?`,
      keyInsight:              `Keep it simple: variables hold data, and functions do actions with that data.`,
      misconceptionAddressed:  `Don't worry about memorizing syntax — focus on the step-by-step mental picture!`,
    };
  }
};

// ─── Adaptive assessment generation (spec §14, §21, handoff §4) ──────────────

/**
 * Format-specific task descriptions.
 * Each entry tells the LLM exactly what type of question to produce
 * and what the response structure must look like.
 *
 * The LLM is explicitly prohibited from changing difficulty, bloomLevel,
 * or assessmentFormat from the specification — server-side validation
 * enforces this after generation.
 */
const FORMAT_SPECS = {
  mcq: {
    taskDescription: `Write one multiple-choice question.
The student selects one correct answer from four options.
Distractors must reflect common misconceptions, not random wrong answers.
Include a helpful non-spoiling "hint" in payload to help a student who is stuck.
Produce structured "payload" with options and hint, and "evaluationData" with correctAnswer.`,
    responseShape: `{
  "questionText": "The question ending with ?",
  "assessmentFormat": "mcq",
  "payload": {
    "options": ["Correct answer", "Distractor based on misconception 1", "Distractor 2", "Distractor 3"],
    "hint": "Gentle clue directing the student toward the key concept without giving away the answer."
  },
  "evaluationData": {
    "correctAnswer": "Correct answer"
  },
  "explanation": "Why the correct answer is right, why the distractors are incorrect, and a practical student pro-tip."
}`,
  },

  short_answer: {
    taskDescription: `Write one short-answer question.
The student must produce a concise written response (1–3 sentences).
Do NOT provide multiple-choice options.
Include a helpful non-spoiling "hint" in payload.
Produce structured "payload" with placeholder/context/hint and "evaluationData" with modelAnswer and key concept keywords.`,
    responseShape: `{
  "questionText": "The question ending with ?",
  "assessmentFormat": "short_answer",
  "payload": {
    "placeholder": "Write your concise answer here (1-3 sentences)...",
    "suggestedLength": "1-3 sentences",
    "context": "Contextual background if relevant",
    "hint": "Gentle clue about which core mechanism or principle to describe."
  },
  "evaluationData": {
    "modelAnswer": "Model answer in 1-3 sentences that would earn full marks.",
    "keywords": ["key concept 1", "key concept 2"]
  },
  "explanation": "Key concepts the student's answer must include and why they are essential."
}`,
  },

  code_completion: {
    taskDescription: `Write one code-completion question.
Provide a code snippet with ONE clearly marked blank (use ___ or /* COMPLETE HERE */).
The student must fill in the missing part to make the code correct.
The blank must test the specific learning objective, not trivial syntax.
Include a helpful non-spoiling "hint" in payload.
Produce structured "payload" with codeSnippet/hint and "evaluationData" with correctCompletion.`,
    responseShape: `{
  "questionText": "Complete the following code to [specific goal]:",
  "assessmentFormat": "code_completion",
  "payload": {
    "codeSnippet": "function execute(data) {\\n  /* COMPLETE HERE */\\n}",
    "language": "javascript",
    "placeholder": "Enter completion code here...",
    "hint": "Check the function parameters and what type of value needs to be returned."
  },
  "evaluationData": {
    "correctCompletion": "return data.map(item => item.id);",
    "acceptedSolutions": ["return data.map(item => item.id);"]
  },
  "explanation": "Why this completion is correct, how it works, and a practical pro-tip."
}`,
  },

  code_tracing: {
    taskDescription: `Write one code-tracing question.
Provide a short, complete code snippet (max 10 lines).
Ask the student to predict the output, the value of a variable, or the execution state at a specific point.
Include a helpful non-spoiling "hint" in payload.
Produce structured "payload" with codeSnippet/options/hint, and "evaluationData" with expectedOutput.`,
    responseShape: `{
  "questionText": "Trace the following code and state the final output:",
  "assessmentFormat": "code_tracing",
  "payload": {
    "codeSnippet": "let state = 2;\\nfor (let i = 0; i < 3; i++) { state += i; }\\nconsole.log(state);",
    "language": "javascript",
    "options": ["5", "6", "8", "2"],
    "hint": "Step through each iteration: write down how the variable changes at each loop step."
  },
  "evaluationData": {
    "expectedOutput": "5"
  },
  "explanation": "Step-by-step trace showing how the correct answer is reached and the rule to remember."
}`,
  },

  debugging: {
    taskDescription: `Write one debugging question.
Provide a short code snippet (max 12 lines) that contains EXACTLY ONE deliberate bug.
The bug must be directly related to the learning objective.
Include a helpful non-spoiling "hint" in payload.
Produce structured "payload" with buggyCode/errorDescription/hint, and "evaluationData" with identifiedBug and fixedCode.`,
    responseShape: `{
  "questionText": "The following code contains a bug. Identify the bug and describe the fix:",
  "assessmentFormat": "debugging",
  "payload": {
    "buggyCode": "function calculate(items) {\\n  let sum;\\n  for (let i = 0; i < items.length; i++) { sum += items[i]; }\\n  return sum;\\n}",
    "language": "javascript",
    "errorDescription": "Calling calculate([1, 2, 3]) results in NaN.",
    "hint": "Look at variable initialization or boundary conditions before the loop runs."
  },
  "evaluationData": {
    "identifiedBug": "Line 2: sum is uninitialized (undefined), causing += to return NaN.",
    "fixedCode": "Initialize sum = 0;"
  },
  "explanation": "Why this is a bug, what symptom it causes, and how the fix resolves it."
}`,
  },

  scenario_based: {
    taskDescription: `Write one student-friendly scenario-based question.
Describe a simple, realistic, concrete situation (such as a student grade tracker, a game character score, or a simple shopping cart) where the student must choose the best way to apply the concept.
Keep sentences short, clear, and free of enterprise jargon.
Include a helpful non-spoiling "hint" in payload.
Produce structured "payload" with scenario/options/hint, and "evaluationData" with bestChoice and tradeoffs.`,
    responseShape: `{
  "questionText": "Which approach is best in this situation?",
  "assessmentFormat": "scenario_based",
  "payload": {
    "scenario": "You are writing a simple game where a player earns stars by finishing levels. You need to keep track of the total star count as they play.",
    "options": ["Store the star count in an updatable variable so it can increase with each level", "Hardcode a fixed number that never changes", "Create a new unconnected variable for every single star", "Store the stars as plain text without counting"],
    "hint": "Think about whether the star count needs to change and update as the player finishes levels."
  },
  "evaluationData": {
    "bestChoice": "Store the star count in an updatable variable so it can increase with each level",
    "tradeoffs": "An updatable variable allows the total to grow dynamically as the player makes progress."
  },
  "explanation": "Using an updatable variable is the ideal way to keep a running total that changes over time."
}`,
  },
};

/**
 * Retrieve format specification tailored to learner level.
 * For beginners in code completion, prompts Gemini to start from scratch
 * (variables and assignment) with simple 1-3 line snippets.
 */
function getAdaptiveFormatSpec(assessmentFormat, spec = {}) {
  const { difficulty = 'normal', mastery = 0.5 } = spec;
  const isBeginner = (difficulty === 'easy' || mastery < 0.60);

  if (assessmentFormat === 'code_completion') {
    if (isBeginner) {
      return {
        taskDescription: `Write one BEGINNER-LEVEL code-completion question.
CRITICAL PEDAGOGY — START FROM SCRATCH:
1. The student is a beginner learning programming fundamentals. Start from the very beginning: test assigning a variable or basic variable declaration.
2. DO NOT write functions, callbacks, loops, arrays, complex objects, or advanced JavaScript.
3. Provide a simple, clear code snippet of 1 to 3 lines maximum.
4. Mark ONE clear blank using "___" (three underscores).
5. The blank must test assigning a variable (e.g. assigning a number like 10, assigning a string like "Alex", or the assignment operator / keyword like let or const).
6. Provide a helpful, beginner-friendly hint explaining how variable assignment works (e.g. remember the '=' operator).
7. correctCompletion must be the exact value or token to fill in the blank (e.g. "10" or "'Hello'"). Also list accepted variations in acceptedSolutions.`,
        responseShape: `{
  "questionText": "Complete the code to assign the value 25 to the variable age:",
  "assessmentFormat": "code_completion",
  "payload": {
    "codeSnippet": "// Assign the number 25 to the variable age\\nlet age = ___;\\nconsole.log(age);",
    "language": "javascript",
    "placeholder": "25",
    "hint": "In JavaScript, use the '=' operator followed by the value you want to assign (e.g. 25)."
  },
  "evaluationData": {
    "correctCompletion": "25",
    "acceptedSolutions": ["25", "25;"]
  },
  "explanation": "Core Reasoning: In programming, '=' is the assignment operator that stores the value on its right into the variable on its left.\\nMisconception Avoided: Confusing assignment '=' with mathematical equality '=='.\\nStudent Pro-Tip: The variable name is on the left, and the value you want to assign is on the right."
}`,
      };
    }

    if (difficulty === 'normal') {
      return {
        taskDescription: `Write one INTERMEDIATE code-completion question.
Focus on using variables in simple arithmetic expressions, updating a variable value, or simple string combination.
Keep the snippet short (2-4 lines). Mark ONE clear blank using "___".
Include a helpful non-spoiling hint in payload.
Provide correctCompletion and acceptedSolutions in evaluationData.`,
        responseShape: `{
  "questionText": "Complete the code to calculate the total price including tax:",
  "assessmentFormat": "code_completion",
  "payload": {
    "codeSnippet": "let price = 100;\\nlet tax = 15;\\nlet total = price + ___;",
    "language": "javascript",
    "placeholder": "tax",
    "hint": "Add the tax variable to the price."
  },
  "evaluationData": {
    "correctCompletion": "tax",
    "acceptedSolutions": ["tax", "tax;"]
  },
  "explanation": "Core Reasoning: Variables store values that can be combined with operators like '+'."
}`,
      };
    }

    return FORMAT_SPECS.code_completion;
  }

  return FORMAT_SPECS[assessmentFormat] || FORMAT_SPECS.mcq;
}

/**
 * Server-side validation of the generated assessment.
 * Enforces the adaptive contract: the LLM must not silently change
 * difficulty, bloomLevel, or assessmentFormat from the specification.
 *
 * Normalizes into a Common Assessment Entity with structured payload and evaluationData.
 * Returns the validated and normalised question object, or throws.
 */
function validateAndNormaliseQuestion(raw, spec) {
  if (!raw || typeof raw !== 'object') throw new Error('AI returned non-object response');

  const { difficulty, bloomLevel, assessmentFormat, topic, learningObjective } = spec;

  // Extract or build payload and evaluationData
  const rawPayload = (raw.payload && typeof raw.payload === 'object') ? raw.payload : {};
  const rawEval = (raw.evaluationData && typeof raw.evaluationData === 'object') ? raw.evaluationData : {};

  const payload = { ...rawPayload };
  const evaluationData = { ...rawEval };

  if (rawPayload.hint) {
    payload.hint = String(rawPayload.hint).trim();
  } else if (raw.hint) {
    payload.hint = String(raw.hint).trim();
  }

  // Common metadata
  const questionText = (raw.questionText || raw.prompt || spec.topic || 'Assessment Question').toString().trim();
  const marks = typeof raw.marks === 'number' ? raw.marks : 1;
  const explanation = (raw.explanation || '').toString().trim();
  const lo = (raw.learningObjective || learningObjective || '').toString().trim();

  // Normalize format-specific payload and evaluationData
  switch (assessmentFormat) {
    case 'mcq': {
      let options = Array.isArray(payload.options) ? payload.options : (Array.isArray(raw.options) ? raw.options : []);
      options = options.map(o => String(o).trim()).filter(Boolean);
      const rawAns = evaluationData.correctAnswer || raw.correctAnswer || '';
      const cleanAns = String(rawAns).trim();

      if (options.length < 2) {
        options = [cleanAns || 'Option A', 'Option B', 'Option C', 'Option D'];
      }
      while (options.length < 4) options.push(`Option ${options.length + 1}`);
      options = options.slice(0, 4);

      payload.options = options;
      evaluationData.correctAnswer = options.includes(cleanAns) ? cleanAns : options[0];
      break;
    }

    case 'short_answer': {
      if (!payload.placeholder) {
        payload.placeholder = 'Write your concise answer here (1-3 sentences)...';
      }
      if (!payload.suggestedLength) {
        payload.suggestedLength = '1-3 sentences';
      }
      const modelAnswer = evaluationData.modelAnswer || raw.correctAnswer || raw.modelAnswer || 'Model conceptual explanation.';
      evaluationData.modelAnswer = String(modelAnswer).trim();
      evaluationData.keywords = Array.isArray(evaluationData.keywords)
        ? evaluationData.keywords.map(k => String(k).trim()).filter(Boolean)
        : [];
      break;
    }

    case 'code_completion': {
      let codeSnippet = payload.codeSnippet || raw.codeSnippet || questionText;
      if (!/___|\/\*\s*COMPLETE\s*HERE\s*\*\/|\/\/\s*COMPLETE\s*HERE|\[BLANK\]/i.test(codeSnippet)) {
        codeSnippet = `${codeSnippet}\n// Complete the solution:\n/* COMPLETE HERE */`;
      }
      payload.codeSnippet = codeSnippet;
      payload.language = payload.language || raw.language || 'javascript';

      const correctCompletion = evaluationData.correctCompletion || raw.correctAnswer || raw.correctCompletion || 'return true;';
      evaluationData.correctCompletion = String(correctCompletion).trim();
      evaluationData.acceptedSolutions = Array.isArray(evaluationData.acceptedSolutions)
        ? evaluationData.acceptedSolutions.map(s => String(s).trim())
        : [evaluationData.correctCompletion];
      break;
    }

    case 'code_tracing': {
      payload.codeSnippet = payload.codeSnippet || raw.codeSnippet || questionText;
      payload.language = payload.language || raw.language || 'javascript';

      let options = Array.isArray(payload.options) ? payload.options : (Array.isArray(raw.options) ? raw.options : []);
      options = options.map(o => String(o).trim()).filter(Boolean);

      const expectedOutput = evaluationData.expectedOutput || raw.correctAnswer || raw.expectedOutput || (options[0] || '0');
      evaluationData.expectedOutput = String(expectedOutput).trim();

      if (options.length >= 2) {
        if (!options.includes(evaluationData.expectedOutput)) {
          options[0] = evaluationData.expectedOutput;
        }
        payload.options = options;
      }
      break;
    }

    case 'debugging': {
      payload.buggyCode = payload.buggyCode || raw.buggyCode || questionText;
      payload.language = payload.language || raw.language || 'javascript';
      if (!payload.errorDescription && raw.errorDescription) {
        payload.errorDescription = raw.errorDescription;
      }

      const identifiedBug = evaluationData.identifiedBug || raw.correctAnswer || raw.identifiedBug || 'Line error identified.';
      const fixedCode = evaluationData.fixedCode || raw.fixedCode || 'Corrected implementation.';
      evaluationData.identifiedBug = String(identifiedBug).trim();
      evaluationData.fixedCode = String(fixedCode).trim();
      break;
    }

    case 'scenario_based': {
      payload.scenario = payload.scenario || raw.scenario || questionText;

      let options = Array.isArray(payload.options) ? payload.options : (Array.isArray(raw.options) ? raw.options : []);
      options = options.map(o => String(o).trim()).filter(Boolean);

      const bestChoice = evaluationData.bestChoice || raw.correctAnswer || raw.bestChoice || (options[0] || 'Recommended approach');
      evaluationData.bestChoice = String(bestChoice).trim();

      if (options.length >= 2) {
        if (!options.includes(evaluationData.bestChoice)) {
          options[0] = evaluationData.bestChoice;
        }
        payload.options = options;
      }
      if (raw.tradeoffs || evaluationData.tradeoffs) {
        evaluationData.tradeoffs = String(evaluationData.tradeoffs || raw.tradeoffs).trim();
      }
      break;
    }

    default:
      break;
  }

  // Derive legacy compatibility properties
  const legacyOptions = Array.isArray(payload.options) ? payload.options : [];
  const legacyCorrectAnswer = evaluationData.correctAnswer ||
    evaluationData.expectedOutput ||
    evaluationData.correctCompletion ||
    evaluationData.modelAnswer ||
    evaluationData.bestChoice ||
    evaluationData.identifiedBug ||
    '';

  const normalised = {
    questionText,
    marks,
    difficulty,
    bloomLevel,
    assessmentFormat,
    learningObjective: lo,
    explanation,
    payload,
    evaluationData,
    // Legacy fields for backward compatibility
    options: legacyOptions,
    correctAnswer: legacyCorrectAnswer,
  };

  // Run validation
  const validation = validateAssessment(normalised);
  if (!validation.valid) {
    console.warn(`Assessment validation warnings for ${assessmentFormat}:`, validation.errors);
  }

  return normalised;
}

function generateFallbackAdaptiveQuestion(spec) {
  try {
    const fallbackRaw = getAdaptiveFallbackQuestion(spec);
    if (fallbackRaw) {
      return validateAndNormaliseQuestion(fallbackRaw, spec);
    }
  } catch (err) {
    console.error('getAdaptiveFallbackQuestion error, using basic fallback:', err.message);
  }

  // Graceful fallback if bank throws unexpectedly
  const { topic, difficulty = 'normal', bloomLevel = 'understand', assessmentFormat = 'mcq' } = spec;
  const cleanTopic = (topic || 'this concept').trim();
  const basicRaw = {
    questionText: `Which of the following best describes how ${cleanTopic} operates in a software application?`,
    assessmentFormat: 'mcq',
    payload: {
      options: [
        `It processes instructions and maintains predictable state for ${cleanTopic}`,
        `It randomly modifies system memory without rules`,
        `It halts the operating system kernel immediately`,
        `It deletes files from disk without verification`,
      ],
      hint: `Think of how ${cleanTopic} organizes and executes programmatic logic predictably.`,
    },
    evaluationData: {
      correctAnswer: `It processes instructions and maintains predictable state for ${cleanTopic}`,
    },
    explanation: `Core Reasoning: In software engineering, ${cleanTopic} provides predictable, deterministic execution.\nStudent Pro-Tip: Trace operations step-by-step.`,
  };
  return validateAndNormaliseQuestion(basicRaw, spec);
}

/**
 * generateAdaptiveAssessment(spec, userId)
 *
 * Generates a single targeted assessment question using the adaptation
 * specification produced by adaptationService.
 *
 * The LLM receives format-specific instructions that describe exactly
 * what structure to produce. Server-side validation enforces the contract
 * after generation — the LLM cannot silently change the specification.
 *
 * Falls back to deterministic format generator if AI is unavailable.
 */
const generateAdaptiveAssessment = async (spec, userId) => {
  const {
    topic,
    topicSummary   = '',
    learningObjective,
    bloomLevel,
    difficulty,
    assessmentFormat = 'mcq',
    mastery          = 0.5,
    trend            = 'stable',
    misconception    = null,
    previousQuestions = [],
  } = spec;

  const formatSpec = getAdaptiveFormatSpec(assessmentFormat, spec);

  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { temperature: 0.7, topK: 40, topP: 0.9 },
  });

  const prompt = `You are generating an adaptive assessment question for a learning system.

ADAPTATION SPECIFICATION — follow these values exactly. Do NOT change them in your response:
- Topic: ${topic}
- Learning objective: ${learningObjective || `Demonstrate understanding of ${topic}`}
- Bloom level: ${bloomLevel}  (the cognitive process required)
- Difficulty: ${difficulty}   (how hard the task is — separate from Bloom level)
- Format: ${assessmentFormat} (the exact type of question to produce)
- Student mastery: ${Math.round(mastery * 100)}%
- Trend: ${trend}
${misconception ? `- Known misconception to address: ${misconception}` : ''}
${previousQuestions && previousQuestions.length > 0 ? `
CRITICAL - ANTI-REPETITION REQUIREMENT:
The student has ALREADY answered the following questions on this topic. You MUST produce a completely FRESH, DIFFERENT question with a different code snippet and scenario. Do NOT repeat or slightly rephrase:
${previousQuestions.map((pq, idx) => `${idx + 1}. "${pq.substring(0, 100)}..."`).join('\n')}
` : ''}

TOPIC CONTEXT (use this to make the question specific and realistic):
${topicSummary.substring(0, 400)}

TASK — ${assessmentFormat.toUpperCase()}:
${formatSpec.taskDescription}

CRITICAL RULES:
1. SIMPLICITY & NO JARGON: Use simple, everyday, friendly language. Absolutely NO enterprise or academic buzzwords (e.g. no "distributed systems", "cascading failures", "latency SLAs", "polymorphic invariants"). Keep scenarios and questions focused on simple, relatable examples (scores, games, students, shopping, recipes).
2. LASER-FOCUSED ON "${topic}": The question MUST test the exact micro-concept of "${topic}". Do NOT ask questions about unrelated or advanced language features.
3. PROGRESSIVE APPROPRIATENESS: Match the student difficulty (${difficulty}) and cognitive level (${bloomLevel}). For beginners, keep questions short, direct, and encouraging.
4. difficulty in your response MUST be "${difficulty}".
5. bloomLevel in your response MUST be "${bloomLevel}".
6. assessmentFormat in your response MUST be "${assessmentFormat}".
7. Return ONLY the JSON object below. No markdown, no explanation outside the JSON.

RESPONSE SHAPE:
${formatSpec.responseShape}`;

  const t0 = Date.now();
  try {
    const responseText = await callGemini(model, prompt);
    await logUsage({
      userId,
      operation: 'generate_quiz',
      inputChars: prompt.length,
      outputChars: responseText.length,
      success: true,
      durationMs: Date.now() - t0,
    });

    let clean = responseText.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`No JSON object in ${assessmentFormat} assessment response`);

    const raw = JSON.parse(match[0]);
    return validateAndNormaliseQuestion(raw, spec);

  } catch (err) {
    await logUsage({
      userId,
      operation: 'generate_quiz',
      inputChars: prompt.length,
      outputChars: 0,
      success: false,
      error: err.message,
      durationMs: Date.now() - t0,
    });
    console.warn(`generateAdaptiveAssessment [${assessmentFormat}] API error, using structured fallback:`, err.message);
    return generateFallbackAdaptiveQuestion(spec);
  }
};

// ─── Format-Aware Defensible Assessment Evaluation ─────────────────────────────
const evaluateAdaptiveResponse = async ({ format, studentAnswer, question, userId = null }) => {
  // LLM evaluator hook for open-ended formats when Gemini API is configured
  const llmEvaluator = async ({ format: effFormat, studentAnswer: sAns, question: q, userId: uId }) => {
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'dummy_key_for_build_testing') {
      return null;
    }
    try {
      const model = genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        generationConfig: { temperature: 0.1, topK: 20, topP: 0.8 },
      });

      const correct = q.evaluationData?.modelAnswer ||
        q.evaluationData?.identifiedBug ||
        q.evaluationData?.bestChoice ||
        q.correctAnswer || '';

      const evalPrompt = `You are an expert pedagogical assessment evaluator and supportive mentor for an adaptive learning platform.
Evaluate the student's answer against the reference model answer, explanation, and target learning objective.
Be fair, defensible, and formative: credit conceptual understanding and accurate diagnoses, even if phrased differently.
Do NOT give credit to irrelevant answers, empty buzzwords, or guessing.

Assessment Format: ${effFormat}
Question: ${q.questionText}
Reference Solution / Model Answer: ${correct}
Explanation / Scoring Guide: ${q.explanation || ''}
Learning Objective: ${q.learningObjective || ''}

Student's Submitted Answer:
"""${sAns}"""

Evaluation Tasks:
1. Determine if the student answer demonstrates genuine conceptual understanding or an accurate diagnosis.
2. For debugging: did they accurately pinpoint the root cause and provide or describe a valid fix?
3. For short answer: did they explain the mechanism clearly rather than only mentioning surface keywords?
4. Write "feedback" directly addressing the student (2nd person: "You..."):
   - If correct: Praise their precise insight and highlight what made their reasoning effective.
   - If incorrect or partial: Be encouraging, acknowledge anything they got right, and explicitly guide them on the exact missing concept or distinction needed so they learn immediately.

Return ONLY a JSON object:
{
  "isCorrect": true or false,
  "score": 1 or 0,
  "feedback": "2-3 sentences of supportive, constructive feedback addressed directly to the student.",
  "criteriaResults": [
    { "criterion": "Specific requirement 1", "passed": true or false },
    { "criterion": "Specific requirement 2", "passed": true or false }
  ]
}`;

      const t0 = Date.now();
      const responseText = await callGemini(model, evalPrompt);
      await logUsage({
        userId: uId,
        operation: 'evaluate_answer',
        inputChars: evalPrompt.length,
        outputChars: responseText.length,
        success: true,
        durationMs: Date.now() - t0,
      });

      let clean = responseText.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return {
          isCorrect: Boolean(parsed.isCorrect),
          score: parsed.score === 1 || parsed.isCorrect ? 1 : 0,
          evaluator: `gemini-rubric-v1 (${GEMINI_MODEL})`,
          feedback: parsed.feedback || (parsed.isCorrect ? 'Correct explanation.' : 'Incomplete explanation.'),
          criteriaResults: Array.isArray(parsed.criteriaResults) ? parsed.criteriaResults : [],
        };
      }
    } catch (llmErr) {
      console.warn('LLM evaluation call failed or skipped, falling back to deterministic rubric:', llmErr.message);
    }
    return null;
  };

  return evaluateAssessment({
    format,
    studentAnswer,
    assessment: question,
    llmEvaluator,
    userId,
  });
};

// Re-export with new functions added
module.exports = {
  extractTopicsAndSummaries,
  generateQuizQuestions,
  generateAdaptiveContent,
  generateAdaptiveAssessment,
  generateFallbackAdaptiveQuestion,
  buildDefaultAnimation,
  evaluateAdaptiveResponse,
  getTodayUsageCount,
  DAILY_LIMIT,
};

