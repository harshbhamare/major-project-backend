/**
 * assessmentValidator.js
 *
 * Strict validation schemas and client sanitization for all 6 assessment formats:
 *   - mcq
 *   - short_answer
 *   - code_completion
 *   - code_tracing
 *   - debugging
 *   - scenario_based
 */

const SUPPORTED_FORMATS = [
  'mcq',
  'short_answer',
  'code_completion',
  'code_tracing',
  'debugging',
  'scenario_based',
];

const SUPPORTED_DIFFICULTIES = ['easy', 'normal', 'advanced', 'medium'];
const SUPPORTED_BLOOM_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

/**
 * Validates the common metadata and format-specific payload & evaluationData.
 * Returns { valid: boolean, errors: string[] }
 */
function validateAssessment(assessment) {
  const errors = [];

  if (!assessment || typeof assessment !== 'object') {
    return { valid: false, errors: ['Assessment must be a non-null object'] };
  }

  // 1. Common Metadata Validation
  const format = assessment.assessmentFormat;
  if (!format || !SUPPORTED_FORMATS.includes(format)) {
    errors.push(`assessmentFormat must be one of: ${SUPPORTED_FORMATS.join(', ')}. Got: "${format}"`);
  }

  if (!assessment.questionText || typeof assessment.questionText !== 'string' || assessment.questionText.trim().length === 0) {
    errors.push('questionText is required and must be a non-empty string');
  }

  if (assessment.difficulty && !SUPPORTED_DIFFICULTIES.includes(assessment.difficulty)) {
    errors.push(`difficulty must be one of: ${SUPPORTED_DIFFICULTIES.join(', ')}. Got: "${assessment.difficulty}"`);
  }

  if (assessment.bloomLevel && !SUPPORTED_BLOOM_LEVELS.includes(assessment.bloomLevel)) {
    errors.push(`bloomLevel must be one of: ${SUPPORTED_BLOOM_LEVELS.join(', ')}. Got: "${assessment.bloomLevel}"`);
  }

  if (assessment.marks !== undefined && (typeof assessment.marks !== 'number' || assessment.marks < 0)) {
    errors.push('marks must be a non-negative number');
  }

  // Payload and evaluationData can be explicit or derived from legacy fields
  const payload = assessment.payload || {};
  const evaluationData = assessment.evaluationData || {};

  if (payload.hint !== undefined && typeof payload.hint !== 'string') {
    errors.push('payload.hint must be a string if provided');
  }

  // 2. Format-Specific Validation
  switch (format) {
    case 'mcq': {
      const options = payload.options || assessment.options;
      if (!Array.isArray(options) || options.length < 2) {
        errors.push('mcq format requires payload.options with at least 2 non-empty options');
      } else {
        const nonBlank = options.map(o => String(o).trim()).filter(Boolean);
        if (nonBlank.length < 2) {
          errors.push('mcq format requires at least 2 distinct non-blank options');
        }
      }

      const correctAnswer = evaluationData.correctAnswer || assessment.correctAnswer;
      if (!correctAnswer || typeof correctAnswer !== 'string' || correctAnswer.trim().length === 0) {
        errors.push('mcq format requires evaluationData.correctAnswer as a non-empty string');
      } else if (Array.isArray(options) && options.length > 0) {
        const trimmedOptions = options.map(o => String(o).trim().toLowerCase());
        const trimmedAns = correctAnswer.trim().toLowerCase();
        const letterIdx = ['a', 'b', 'c', 'd'].indexOf(trimmedAns);
        const matchesOption = trimmedOptions.includes(trimmedAns) || (letterIdx !== -1 && letterIdx < options.length);
        if (!matchesOption) {
          errors.push(`mcq evaluationData.correctAnswer ("${correctAnswer}") must match one of the options`);
        }
      }
      break;
    }

    case 'short_answer': {
      const modelAnswer = evaluationData.modelAnswer || assessment.correctAnswer;
      if (!modelAnswer || typeof modelAnswer !== 'string' || modelAnswer.trim().length === 0) {
        errors.push('short_answer format requires evaluationData.modelAnswer (or correctAnswer) as a non-empty string');
      }
      if (payload.wordLimit !== undefined && (typeof payload.wordLimit !== 'number' || payload.wordLimit <= 0)) {
        errors.push('short_answer payload.wordLimit must be a positive number if provided');
      }
      break;
    }

    case 'code_completion': {
      const codeSnippet = payload.codeSnippet;
      if (!codeSnippet || typeof codeSnippet !== 'string' || codeSnippet.trim().length === 0) {
        errors.push('code_completion format requires payload.codeSnippet as a non-empty string');
      } else {
        const hasBlank = /___|\/\*\s*COMPLETE\s*HERE\s*\*\/|\/\/\s*COMPLETE\s*HERE|\[BLANK\]|<blank>/i.test(codeSnippet);
        const hasPrefixSuffix = payload.prefixCode !== undefined || payload.starterCode !== undefined;
        if (!hasBlank && !hasPrefixSuffix) {
          errors.push('code_completion payload.codeSnippet must contain a completion marker (e.g. "___" or "/* COMPLETE HERE */")');
        }
      }

      const correctCompletion = evaluationData.correctCompletion || assessment.correctAnswer;
      if (!correctCompletion || typeof correctCompletion !== 'string' || correctCompletion.trim().length === 0) {
        errors.push('code_completion format requires evaluationData.correctCompletion as a non-empty string');
      }
      break;
    }

    case 'code_tracing': {
      const codeSnippet = payload.codeSnippet;
      if (!codeSnippet || typeof codeSnippet !== 'string' || codeSnippet.trim().length === 0) {
        errors.push('code_tracing format requires payload.codeSnippet as a non-empty string');
      }

      const expectedOutput = evaluationData.expectedOutput || assessment.correctAnswer;
      if (!expectedOutput || typeof expectedOutput !== 'string' || expectedOutput.trim().length === 0) {
        errors.push('code_tracing format requires evaluationData.expectedOutput as a non-empty string');
      }

      const options = payload.options || assessment.options;
      if (Array.isArray(options) && options.length > 0) {
        if (options.length < 2) {
          errors.push('code_tracing payload.options must have at least 2 options when multiple-choice tracing is used');
        } else if (expectedOutput) {
          const trimmedOptions = options.map(o => String(o).trim().toLowerCase());
          const trimmedAns = expectedOutput.trim().toLowerCase();
          const letterIdx = ['a', 'b', 'c', 'd'].indexOf(trimmedAns);
          const matchesOption = trimmedOptions.includes(trimmedAns) || (letterIdx !== -1 && letterIdx < options.length);
          if (!matchesOption) {
            errors.push(`code_tracing expectedOutput ("${expectedOutput}") must match one of the provided options`);
          }
        }
      }
      break;
    }

    case 'debugging': {
      const buggyCode = payload.buggyCode;
      if (!buggyCode || typeof buggyCode !== 'string' || buggyCode.trim().length === 0) {
        errors.push('debugging format requires payload.buggyCode as a non-empty string');
      }

      const identifiedBug = evaluationData.identifiedBug || evaluationData.fixedCode || assessment.correctAnswer;
      if (!identifiedBug || typeof identifiedBug !== 'string' || identifiedBug.trim().length === 0) {
        errors.push('debugging format requires evaluationData.identifiedBug or fixedCode as a non-empty string');
      }
      break;
    }

    case 'scenario_based': {
      const scenario = payload.scenario;
      if (!scenario || typeof scenario !== 'string' || scenario.trim().length === 0) {
        errors.push('scenario_based format requires payload.scenario as a non-empty string');
      }

      const bestChoice = evaluationData.bestChoice || evaluationData.modelAnswer || assessment.correctAnswer;
      if (!bestChoice || typeof bestChoice !== 'string' || bestChoice.trim().length === 0) {
        errors.push('scenario_based format requires evaluationData.bestChoice (or modelAnswer) as a non-empty string');
      }

      const options = payload.options || assessment.options;
      if (Array.isArray(options) && options.length > 0) {
        if (options.length < 2) {
          errors.push('scenario_based payload.options must have at least 2 options when choice-based');
        } else if (bestChoice) {
          const trimmedOptions = options.map(o => String(o).trim().toLowerCase());
          const trimmedChoice = bestChoice.trim().toLowerCase();
          const letterIdx = ['a', 'b', 'c', 'd'].indexOf(trimmedChoice);
          const matchesOption = trimmedOptions.includes(trimmedChoice) || (letterIdx !== -1 && letterIdx < options.length);
          if (!matchesOption) {
            errors.push(`scenario_based bestChoice ("${bestChoice}") must match one of the options`);
          }
        }
      }
      break;
    }

    default:
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Sanitizes an assessment document or object for the client BEFORE submission.
 * CRITICAL SECURITY INVARIANT:
 * NEVER exposes correctAnswer, modelAnswer, evaluationData, explanation, or marking rubrics before submission.
 */
function sanitizeAssessmentForClient(assessment) {
  if (!assessment) return null;

  const raw = typeof assessment.toObject === 'function' ? assessment.toObject() : { ...assessment };
  const format = raw.assessmentFormat || 'mcq';

  // Build client payload from structured payload or legacy fields
  const payload = raw.payload ? { ...raw.payload } : {};
  if (raw.hint && !payload.hint) {
    payload.hint = raw.hint;
  }

  // Ensure format-specific presentation fields exist for client
  switch (format) {
    case 'mcq':
      if (!payload.options && Array.isArray(raw.options)) {
        payload.options = [...raw.options];
      }
      break;
    case 'code_completion':
      if (!payload.codeSnippet && raw.questionText) {
        payload.codeSnippet = raw.questionText;
      }
      if (!payload.language) payload.language = 'javascript';
      break;
    case 'code_tracing':
      if (!payload.codeSnippet && raw.questionText) {
        payload.codeSnippet = raw.questionText;
      }
      if (!payload.options && Array.isArray(raw.options) && raw.options.length > 0) {
        payload.options = [...raw.options];
      }
      if (!payload.language) payload.language = 'javascript';
      break;
    case 'debugging':
      if (!payload.buggyCode && raw.questionText) {
        payload.buggyCode = raw.questionText;
      }
      if (!payload.language) payload.language = 'javascript';
      break;
    case 'scenario_based':
      if (!payload.scenario && raw.questionText) {
        payload.scenario = raw.questionText;
      }
      if (!payload.options && Array.isArray(raw.options) && raw.options.length > 0) {
        payload.options = [...raw.options];
      }
      break;
    case 'short_answer':
    default:
      break;
  }

  // Return the client-safe structure
  const clientSafe = {
    _id:               raw._id,
    assessmentFormat:  format,
    questionText:      raw.questionText,
    marks:             raw.marks !== undefined ? raw.marks : 1,
    difficulty:        raw.difficulty || 'normal',
    bloomLevel:        raw.bloomLevel || 'understand',
    learningObjective: raw.learningObjective || '',
    payload,
  };

  // Keep legacy options property at top level if mcq/options exist for backward compatibility
  if (Array.isArray(payload.options)) {
    clientSafe.options = payload.options;
  }

  // EXPLICIT CHECK: Ensure no secret keys ever leak
  delete clientSafe.correctAnswer;
  delete clientSafe.evaluationData;
  delete clientSafe.explanation;
  delete clientSafe.modelAnswer;

  return clientSafe;
}

module.exports = {
  SUPPORTED_FORMATS,
  SUPPORTED_DIFFICULTIES,
  SUPPORTED_BLOOM_LEVELS,
  validateAssessment,
  sanitizeAssessmentForClient,
};
