/**
 * assessmentEvaluator.js
 *
 * Format-routed assessment evaluation engine.
 * Implements defensible, pedagogically sound scoring rules for all 6 assessment formats:
 *   - mcq
 *   - short_answer
 *   - code_completion
 *   - code_tracing
 *   - debugging
 *   - scenario_based
 *
 * Critical rule: NEVER uses simple length proxies for open-ended or code evaluations.
 */

const STOP_WORDS = new Set([
  'the', 'and', 'with', 'from', 'that', 'this', 'have', 'which', 'what', 'when',
  'where', 'will', 'your', 'about', 'into', 'some', 'than', 'them', 'then', 'there',
  'these', 'they', 'been', 'each', 'also', 'such', 'does', 'were', 'must', 'should',
  'could', 'would', 'their', 'other', 'only', 'more', 'most',
]);

function extractSubstantiveTokens(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-zA-Z0-9_]+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

function normalizeCode(str) {
  if (!str) return '';
  return str.toString()
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')           // strip comments
    .replace(/\s+/g, ' ')                             // collapse whitespace
    .replace(/\s*([;{}()=+\-*/<>!&|,:[\]])\s*/g, '$1') // normalize around operators
    .trim()
    .toLowerCase();
}

// ── 1. MCQ Evaluator ──────────────────────────────────────────────────────────
function evaluateMcq(studentAnswer, payload = {}, evaluationData = {}, question = {}) {
  const std = (studentAnswer || '').toString().trim();
  const correct = (evaluationData.correctAnswer || question.correctAnswer || '').toString().trim();
  const options = payload.options || question.options || [];

  if (!std) {
    return {
      isCorrect: false,
      score: 0,
      evaluator: 'mcq-evaluator-v2',
      feedback: 'No option selected.',
      criteriaResults: [{ criterion: 'Valid option selection', passed: false }],
    };
  }

  // Exact option text match
  if (std.toLowerCase() === correct.toLowerCase()) {
    return {
      isCorrect: true,
      score: 1,
      evaluator: 'mcq-evaluator-v2',
      feedback: 'Correct option selected.',
      criteriaResults: [{ criterion: 'Option match', passed: true }],
    };
  }

  // Option letter match (A, B, C, D)
  const letterIdx = ['A', 'B', 'C', 'D'].indexOf(std.toUpperCase());
  if (letterIdx !== -1 && options[letterIdx]) {
    const selectedOption = options[letterIdx].trim();
    const isMatch = selectedOption.toLowerCase() === correct.toLowerCase();
    return {
      isCorrect: isMatch,
      score: isMatch ? 1 : 0,
      evaluator: 'mcq-evaluator-v2',
      feedback: isMatch ? 'Correct option selected.' : 'Selected option does not match correct answer.',
      criteriaResults: [{ criterion: 'Option letter match', passed: isMatch }],
    };
  }

  // Match selected text against option list, then against correct
  const matchedOpt = options.find(o => o.trim().toLowerCase() === std.toLowerCase());
  const isMatch = matchedOpt && matchedOpt.trim().toLowerCase() === correct.toLowerCase();

  return {
    isCorrect: Boolean(isMatch),
    score: isMatch ? 1 : 0,
    evaluator: 'mcq-evaluator-v2',
    feedback: isMatch
      ? 'Great job! You selected the correct option.'
      : 'Not quite. Review the explanation below to understand why this option was incorrect and how to avoid the common misconception.',
    criteriaResults: [{ criterion: 'Option text match', passed: Boolean(isMatch) }],
  };
}

// ── 2. Code Tracing Evaluator ────────────────────────────────────────────────
function evaluateCodeTracing(studentAnswer, payload = {}, evaluationData = {}, question = {}) {
  const std = (studentAnswer || '').toString().trim();
  const expected = (evaluationData.expectedOutput || question.correctAnswer || '').toString().trim();
  const options = payload.options || question.options || [];

  if (!std) {
    return {
      isCorrect: false,
      score: 0,
      evaluator: 'code-tracing-v2',
      feedback: 'No trace output entered. Please provide your predicted value or state.',
      criteriaResults: [{ criterion: 'Trace output provided', passed: false }],
    };
  }

  // If tracing is multiple-choice with options
  if (options.length >= 2) {
    if (std.toLowerCase() === expected.toLowerCase()) {
      return {
        isCorrect: true,
        score: 1,
        evaluator: 'code-tracing-v2',
        feedback: 'Spot on! You accurately traced the execution state.',
        criteriaResults: [{ criterion: 'Trace state match', passed: true }],
      };
    }
    const letterIdx = ['A', 'B', 'C', 'D'].indexOf(std.toUpperCase());
    if (letterIdx !== -1 && options[letterIdx]) {
      const isMatch = options[letterIdx].trim().toLowerCase() === expected.toLowerCase();
      return {
        isCorrect: isMatch,
        score: isMatch ? 1 : 0,
        evaluator: 'code-tracing-v2',
        feedback: isMatch
          ? 'Spot on! You accurately traced the execution state.'
          : 'Your predicted output did not match the actual execution state. Review the step-by-step trace below.',
        criteriaResults: [{ criterion: 'Option trace match', passed: isMatch }],
      };
    }
  }

  // Normalized literal matching (strips quotes, semicolons, extra whitespace)
  const normStd = std.replace(/^['"`]|['"`]$/g, '').replace(/;+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const normExpected = expected.replace(/^['"`]|['"`]$/g, '').replace(/;+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const isMatch = normStd === normExpected;

  return {
    isCorrect: isMatch,
    score: isMatch ? 1 : 0,
    evaluator: 'code-tracing-v2',
    feedback: isMatch
      ? 'Spot on! You accurately traced the execution state.'
      : 'Your predicted output did not match the actual execution state. Review the step-by-step trace below.',
    criteriaResults: [{ criterion: 'Execution state output match', passed: isMatch }],
  };
}

// ── 3. Code Completion Evaluator ─────────────────────────────────────────────
function evaluateCodeCompletion(studentAnswer, payload = {}, evaluationData = {}, question = {}) {
  const std = (studentAnswer || '').toString().trim();
  const expected = (evaluationData.correctCompletion || question.correctAnswer || '').toString().trim();
  const accepted = Array.isArray(evaluationData.acceptedSolutions)
    ? evaluationData.acceptedSolutions.map(s => String(s).trim())
    : [];

  if (!std) {
    return {
      isCorrect: false,
      score: 0,
      evaluator: 'code-completion-v2',
      feedback: 'Please enter your code completion answer.',
      criteriaResults: [{ criterion: 'Code completion provided', passed: false }],
    };
  }

  // Normalization helper: normalize quotes (' and ` to "), collapse spaces, normalize operators, trim semicolons
  const normalize = (code) => {
    return (code || '')
      .toString()
      .replace(/['`]/g, '"')                 // normalize quotes
      .replace(/\s+/g, ' ')                  // collapse whitespace
      .replace(/\s*([=+\-*/(),;])\s*/g, '$1') // normalize space around symbols/operators
      .replace(/;+$/, '')                    // trim trailing semicolons
      .trim()
      .toLowerCase();
  };

  const normStd = normalize(std);
  const normExpected = normalize(expected);

  // 1. Exact normalized match
  if (normStd === normExpected) {
    return {
      isCorrect: true,
      score: 1,
      evaluator: 'code-completion-v2',
      feedback: 'Excellent work! Your code completes the solution correctly.',
      criteriaResults: [{ criterion: 'Syntax completion match', passed: true }],
    };
  }

  // 2. Check acceptedSolutions list
  for (const alt of accepted) {
    if (normStd === normalize(alt)) {
      return {
        isCorrect: true,
        score: 1,
        evaluator: 'code-completion-v2',
        feedback: 'Great job! Valid alternative completion accepted.',
        criteriaResults: [{ criterion: 'Accepted completion variant', passed: true }],
      };
    }
  }

  // 3. Essential token sequence containment
  // e.g. student typed full line or full snippet containing expected completion
  if (normExpected.length > 0 && normStd.includes(normExpected)) {
    return {
      isCorrect: true,
      score: 1,
      evaluator: 'code-completion-v2',
      feedback: 'Well done! Target code expression successfully integrated.',
      criteriaResults: [{ criterion: 'Code expression containment', passed: true }],
    };
  }

  // 4. Blank substitution check:
  // If the question snippet had a blank (e.g. `let count = ___;`) and expected was `let count = 10;`,
  // but student only typed `10` (the blank value)
  const codeSnippet = payload.codeSnippet || question.payload?.codeSnippet || '';
  if (codeSnippet && /___|\/\*\s*COMPLETE\s*HERE\s*\*\/|\[BLANK\]/i.test(codeSnippet)) {
    const substituted = codeSnippet.replace(/___|\/\*\s*COMPLETE\s*HERE\s*\*\/|\[BLANK\]/i, std);
    const normSub = normalize(substituted);
    if (normSub.includes(normExpected) || normExpected.includes(normStd)) {
      return {
        isCorrect: true,
        score: 1,
        evaluator: 'code-completion-v2',
        feedback: 'Correct! You successfully filled in the blank.',
        criteriaResults: [{ criterion: 'Blank substitution match', passed: true }],
      };
    }
  }

  return {
    isCorrect: false,
    score: 0,
    evaluator: 'code-completion-v2',
    feedback: 'Not quite. Check your variable assignment or value, and try again!',
    criteriaResults: [{ criterion: 'Syntax completion match', passed: false }],
  };
}

// ── 4. Debugging Evaluator ───────────────────────────────────────────────────
function evaluateDebuggingDeterministic(studentAnswer, payload = {}, evaluationData = {}, question = {}) {
  const std = (studentAnswer || '').toString().trim().toLowerCase();
  const bugInfo = (evaluationData.identifiedBug || question.correctAnswer || '').toString().trim().toLowerCase();
  const rawFix = (evaluationData.fixedCode || '').toString().trim();
  const fixInfo = rawFix.toLowerCase();
  const explanation = (question.explanation || '').toString().trim().toLowerCase();

  // 1. Check for direct code edit / fill-in-the-blank fix in snippet
  const normStd = normalizeCode(studentAnswer);
  const normFix = normalizeCode(rawFix);
  const normFixNoSemi = normFix.replace(/;+$/, '');
  const normBuggy = normalizeCode(payload.buggyCode || '');

  const fixTokens = extractSubstantiveTokens(rawFix);
  const hasAllFixTokens = fixTokens.length > 0 && fixTokens.every(t => std.includes(t.toLowerCase()));

  const isDirectCodeFix = Boolean(
    normFix && (
      normStd === normFix ||
      normStd === normFixNoSemi ||
      (normFixNoSemi.length >= 3 && normStd.includes(normFixNoSemi) && (normBuggy ? normStd !== normBuggy : true)) ||
      (hasAllFixTokens && (normBuggy ? normStd !== normBuggy : true) && fixTokens.length >= 2)
    )
  );

  // 2. Check for textual diagnosis / explanation (backward compatibility)
  const combinedReference = `${bugInfo} ${fixInfo} ${explanation}`.trim();
  const referenceTokens = Array.from(new Set(extractSubstantiveTokens(combinedReference)));

  const bugIndicators = ['bug', 'error', 'wrong', 'issue', 'fail', 'undefined', 'null', 'nan', 'infinite', 'loop', 'index', 'type', 'variable', 'sum', 'syntax', 'overflow', 'bound', 'line'];
  const fixIndicators = ['fix', 'change', 'replace', 'initialize', 'init', 'declare', 'add', 'remove', 'set', 'return', 'correct', 'make', 'update'];

  const matchedKeyTokens = referenceTokens.filter(t => std.includes(t));
  const tokenCoverage = referenceTokens.length > 0 ? (matchedKeyTokens.length / referenceTokens.length) : 0;

  const hasBugMention = bugIndicators.some(b => std.includes(b) && combinedReference.includes(b));
  const hasFixMention = fixIndicators.some(f => std.includes(f) && combinedReference.includes(f));

  // A valid response is either a direct code fix OR a valid diagnosis
  const passed = isDirectCodeFix || (tokenCoverage >= 0.35 && (hasBugMention || hasFixMention)) || tokenCoverage >= 0.50;

  return {
    isCorrect: passed,
    score: passed ? 1 : 0,
    evaluator: 'debugging-deterministic-v2',
    feedback: passed
      ? (isDirectCodeFix
          ? '🎯 Bug squashed! Your code fix successfully resolves the defect.'
          : 'Outstanding diagnosis! You correctly pinpointed the defect and explained how to resolve it.')
      : 'Good effort! However, your answer did not resolve the defect or describe the fix. Review the solution and corrected code below.',
    criteriaResults: [
      { criterion: 'Defect corrected / identified', passed: isDirectCodeFix || hasBugMention || tokenCoverage >= 0.35 },
      { criterion: 'Valid code fix applied', passed: isDirectCodeFix || hasFixMention || tokenCoverage >= 0.40 },
      { criterion: 'Domain concept alignment', passed: isDirectCodeFix || tokenCoverage >= 0.35 },
    ],
  };
}

// ── 5. Short Answer Evaluator ────────────────────────────────────────────────
function evaluateShortAnswerDeterministic(studentAnswer, payload = {}, evaluationData = {}, question = {}) {
  const std = (studentAnswer || '').toString().trim().toLowerCase();
  const modelAnswer = (evaluationData.modelAnswer || question.correctAnswer || '').toString().trim().toLowerCase();
  const explanation = (question.explanation || '').toString().trim().toLowerCase();

  const correctTokens = Array.from(new Set(extractSubstantiveTokens(modelAnswer)));
  const explanationTokens = Array.from(new Set(extractSubstantiveTokens(explanation)));
  const combinedTokens = Array.from(new Set([...correctTokens, ...explanationTokens]));

  const matchedKeyTokens = combinedTokens.filter(t => std.includes(t));
  const coverage = combinedTokens.length > 0 ? (matchedKeyTokens.length / combinedTokens.length) : 0;
  const passed = coverage >= 0.38;

  return {
    isCorrect: passed,
    score: passed ? 1 : 0,
    evaluator: 'short-answer-deterministic-v2',
    feedback: passed
      ? 'Well articulated! Your answer covers the essential conceptual criteria for this topic.'
      : 'You are on the right track, but your response is missing key conceptual elements required by the learning objective. Check the model answer below.',
    criteriaResults: [
      { criterion: 'Core concept identification', passed: coverage >= 0.30 },
      { criterion: 'Technical accuracy and terminology', passed: coverage >= 0.38 },
    ],
  };
}

// ── 6. Scenario-Based Evaluator ──────────────────────────────────────────────
function evaluateScenarioBased(studentAnswer, payload = {}, evaluationData = {}, question = {}) {
  const std = (studentAnswer || '').toString().trim();
  const bestChoice = (evaluationData.bestChoice || evaluationData.modelAnswer || question.correctAnswer || '').toString().trim();
  const options = payload.options || question.options || [];

  if (options.length >= 2) {
    // Option-based scenario decision
    return evaluateMcq(studentAnswer, { options }, { correctAnswer: bestChoice }, question);
  }

  // Open-ended scenario: evaluate substantive tokens and rationale
  const stdTokens = extractSubstantiveTokens(std);
  const bestChoiceTokens = extractSubstantiveTokens(bestChoice);
  const matchedTokens = bestChoiceTokens.filter(t => std.toLowerCase().includes(t));
  const coverage = bestChoiceTokens.length > 0 ? (matchedTokens.length / bestChoiceTokens.length) : 0;
  const passed = coverage >= 0.35;

  return {
    isCorrect: passed,
    score: passed ? 1 : 0,
    evaluator: 'scenario-deterministic-v2',
    feedback: passed
      ? 'Great architectural judgment! Your recommendation effectively balances the system constraints and tradeoffs.'
      : 'Your recommendation does not sufficiently address the primary scenario trade-offs. Review the trade-off breakdown below to see the ideal approach.',
    criteriaResults: [
      { criterion: 'Scenario constraint satisfaction', passed },
      { criterion: 'Architectural/decision justification', passed: coverage >= 0.30 },
    ],
  };
}

/**
 * Main evaluation router. Dispatches to the format-specific evaluator.
 */
async function evaluateAssessment({
  format,
  studentAnswer,
  assessment = {},
  llmEvaluator = null,
  userId = null,
}) {
  if (!studentAnswer || (typeof studentAnswer === 'string' && studentAnswer.trim() === '')) {
    return {
      isCorrect: false,
      score: 0,
      evaluator: 'input-validation',
      feedback: 'No answer provided.',
      criteriaResults: [],
    };
  }

  const effectiveFormat = format || assessment.assessmentFormat || 'mcq';
  const payload = assessment.payload || {};
  const evaluationData = assessment.evaluationData || {};

  switch (effectiveFormat) {
    case 'mcq':
      return evaluateMcq(studentAnswer, payload, evaluationData, assessment);

    case 'code_tracing':
      return evaluateCodeTracing(studentAnswer, payload, evaluationData, assessment);

    case 'code_completion':
      return evaluateCodeCompletion(studentAnswer, payload, evaluationData, assessment);

    case 'debugging': {
      // Direct exact match fast path
      const std = studentAnswer.toString().trim();
      const expected = (evaluationData.identifiedBug || assessment.correctAnswer || '').toString().trim();
      if (std.toLowerCase() === expected.toLowerCase()) {
        return {
          isCorrect: true,
          score: 1,
          evaluator: 'exact-match-v2',
          feedback: 'Direct match with model diagnosis.',
          criteriaResults: [{ criterion: 'Diagnosis and fix match', passed: true }],
        };
      }
      if (typeof llmEvaluator === 'function') {
        const llmResult = await llmEvaluator({
          format: effectiveFormat,
          studentAnswer,
          question: assessment,
          userId,
        });
        if (llmResult) return llmResult;
      }
      return evaluateDebuggingDeterministic(studentAnswer, payload, evaluationData, assessment);
    }

    case 'short_answer': {
      const std = studentAnswer.toString().trim();
      const modelAns = (evaluationData.modelAnswer || assessment.correctAnswer || '').toString().trim();
      if (std.toLowerCase() === modelAns.toLowerCase()) {
        return {
          isCorrect: true,
          score: 1,
          evaluator: 'exact-match-v2',
          feedback: 'Direct match with model answer.',
          criteriaResults: [{ criterion: 'Complete conceptual match', passed: true }],
        };
      }
      if (typeof llmEvaluator === 'function') {
        const llmResult = await llmEvaluator({
          format: effectiveFormat,
          studentAnswer,
          question: assessment,
          userId,
        });
        if (llmResult) return llmResult;
      }
      return evaluateShortAnswerDeterministic(studentAnswer, payload, evaluationData, assessment);
    }

    case 'scenario_based': {
      if (typeof llmEvaluator === 'function' && (!payload.options || payload.options.length < 2)) {
        const llmResult = await llmEvaluator({
          format: effectiveFormat,
          studentAnswer,
          question: assessment,
          userId,
        });
        if (llmResult) return llmResult;
      }
      return evaluateScenarioBased(studentAnswer, payload, evaluationData, assessment);
    }

    default:
      return evaluateMcq(studentAnswer, payload, evaluationData, assessment);
  }
}

module.exports = {
  evaluateAssessment,
  evaluateMcq,
  evaluateCodeTracing,
  evaluateCodeCompletion,
  evaluateDebuggingDeterministic,
  evaluateShortAnswerDeterministic,
  evaluateScenarioBased,
};
