/**
 * test_assessment_formats.js
 *
 * Comprehensive End-to-End Verification Suite for Refactored Assessment Data Model:
 * 1. Strict format-specific schema validation for all 6 formats:
 *    - mcq, short_answer, code_completion, code_tracing, debugging, scenario_based
 * 2. Fallback AI question generation producing valid unified assessment entities
 * 3. Format-routed evaluation and scoring (defensible rubrics, no length proxies)
 * 4. Client payload security: withholding of correctAnswer, modelAnswer, evaluationData, explanation
 * 5. End-to-end AdaptiveActivity simulation (lifecycle from plan to submission outcome)
 * 6. Standard quiz flow backward compatibility
 */

const assert = require('assert');
const {
  validateAssessment,
  sanitizeAssessmentForClient,
  SUPPORTED_FORMATS,
} = require('./validators/assessmentValidator');

const {
  evaluateAssessment,
  evaluateMcq,
  evaluateCodeTracing,
  evaluateCodeCompletion,
  evaluateDebuggingDeterministic,
  evaluateShortAnswerDeterministic,
  evaluateScenarioBased,
} = require('./services/assessmentEvaluator');

const {
  generateFallbackAdaptiveQuestion,
  validateAndNormaliseQuestion,
  evaluateAdaptiveResponse,
} = require('./config/aiService');

const { assessmentSchema } = require('./models/Assessment');
const AdaptiveActivity = require('./models/AdaptiveActivity');
const Quiz = require('./models/Quiz');

async function runAllTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING COMPREHENSIVE ASSESSMENT FORMATS SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err.message}\n`);
      failed++;
    }
  }

  // ── 1. Strict Validation Schemas for All 6 Formats ──────────────────────────
  console.log('--- Suite 1: Strict Format-Specific Schema Validation ---');

  await test('Format enum contains all 6 required formats', () => {
    assert.deepStrictEqual(SUPPORTED_FORMATS.sort(), [
      'code_completion',
      'code_tracing',
      'debugging',
      'mcq',
      'scenario_based',
      'short_answer',
    ].sort());
  });

  await test('MCQ validation: passes valid options/answer, fails missing options or invalid answer', () => {
    const valid = {
      assessmentFormat: 'mcq',
      questionText: 'What is O(log n)?',
      payload: { options: ['Logarithmic', 'Linear', 'Quadratic', 'Constant'] },
      evaluationData: { correctAnswer: 'Logarithmic' },
    };
    assert.strictEqual(validateAssessment(valid).valid, true);

    const missingOptions = {
      assessmentFormat: 'mcq',
      questionText: 'What is O(log n)?',
      payload: { options: [] },
      evaluationData: { correctAnswer: 'Logarithmic' },
    };
    assert.strictEqual(validateAssessment(missingOptions).valid, false);

    const mismatchAnswer = {
      assessmentFormat: 'mcq',
      questionText: 'What is O(log n)?',
      payload: { options: ['A', 'B'] },
      evaluationData: { correctAnswer: 'NonExistent' },
    };
    assert.strictEqual(validateAssessment(mismatchAnswer).valid, false);
  });

  await test('Short Answer validation: passes valid modelAnswer, fails missing modelAnswer', () => {
    const valid = {
      assessmentFormat: 'short_answer',
      questionText: 'Define encapsulation.',
      payload: { placeholder: 'Define encapsulation...', wordLimit: 40 },
      evaluationData: { modelAnswer: 'Bundling of data and methods.', keywords: ['bundling', 'data'] },
    };
    assert.strictEqual(validateAssessment(valid).valid, true);

    const invalid = {
      assessmentFormat: 'short_answer',
      questionText: 'Define encapsulation.',
      payload: {},
      evaluationData: {},
    };
    assert.strictEqual(validateAssessment(invalid).valid, false);
  });

  await test('Code Completion validation: requires blank marker and correctCompletion', () => {
    const valid = {
      assessmentFormat: 'code_completion',
      questionText: 'Complete the filter:',
      payload: { codeSnippet: 'return items.filter(/* COMPLETE HERE */);', language: 'javascript' },
      evaluationData: { correctCompletion: 'item => item.active' },
    };
    assert.strictEqual(validateAssessment(valid).valid, true);

    const noBlank = {
      assessmentFormat: 'code_completion',
      questionText: 'Complete the filter:',
      payload: { codeSnippet: 'return items.filter();' },
      evaluationData: { correctCompletion: 'item => item.active' },
    };
    assert.strictEqual(validateAssessment(noBlank).valid, false);

    const noCompletion = {
      assessmentFormat: 'code_completion',
      questionText: 'Complete the filter:',
      payload: { codeSnippet: 'return items.filter(___);' },
      evaluationData: { correctCompletion: '' },
    };
    assert.strictEqual(validateAssessment(noCompletion).valid, false);
  });

  await test('Code Tracing validation: requires codeSnippet and expectedOutput', () => {
    const valid = {
      assessmentFormat: 'code_tracing',
      questionText: 'Trace the output:',
      payload: { codeSnippet: 'let x = 5; console.log(x * 2);', options: ['10', '5', '2'] },
      evaluationData: { expectedOutput: '10' },
    };
    assert.strictEqual(validateAssessment(valid).valid, true);

    const noSnippet = {
      assessmentFormat: 'code_tracing',
      questionText: 'Trace the output:',
      payload: { options: ['10', '5'] },
      evaluationData: { expectedOutput: '10' },
    };
    assert.strictEqual(validateAssessment(noSnippet).valid, false);
  });

  await test('Debugging validation: requires buggyCode and identifiedBug or fixedCode', () => {
    const valid = {
      assessmentFormat: 'debugging',
      questionText: 'Fix the bug in calculate:',
      payload: { buggyCode: 'let sum; sum += 1;', errorDescription: 'sum is NaN' },
      evaluationData: { identifiedBug: 'sum is undefined', fixedCode: 'let sum = 0;' },
    };
    assert.strictEqual(validateAssessment(valid).valid, true);

    const noBugDesc = {
      assessmentFormat: 'debugging',
      questionText: 'Fix the bug in calculate:',
      payload: { buggyCode: 'let sum; sum += 1;' },
      evaluationData: {},
    };
    assert.strictEqual(validateAssessment(noBugDesc).valid, false);
  });

  await test('Scenario-Based validation: requires scenario and bestChoice', () => {
    const valid = {
      assessmentFormat: 'scenario_based',
      questionText: 'Which pattern should you select?',
      payload: {
        scenario: 'High throughput payment service with transient network partitions.',
        options: ['Circuit Breaker', 'Ignore timeouts', 'Immediate retry loop'],
      },
      evaluationData: { bestChoice: 'Circuit Breaker' },
    };
    assert.strictEqual(validateAssessment(valid).valid, true);

    const noScenario = {
      assessmentFormat: 'scenario_based',
      questionText: 'Which pattern should you select?',
      payload: { scenario: '', options: ['A', 'B'] },
      evaluationData: { bestChoice: 'A' },
    };
    assert.strictEqual(validateAssessment(noScenario).valid, false);
  });

  // ── 2. Unified Assessment Generation for All 6 Formats ───────────────────────
  console.log('\n--- Suite 2: AI / Fallback Question Generation for All Formats ---');

  SUPPORTED_FORMATS.forEach((fmt) => {
    test(`Fallback generation for format "${fmt}" produces valid unified entity`, () => {
      const spec = {
        topic: 'Graph Traversal',
        topicSummary: 'Breadth-First Search and Depth-First Search algorithms.',
        learningObjective: 'Analyze graph traversal order and queue states',
        bloomLevel: 'apply',
        difficulty: 'normal',
        assessmentFormat: fmt,
        mastery: 0.65,
        trend: 'improving',
      };

      const q = generateFallbackAdaptiveQuestion(spec);
      assert.ok(q, `Generated question must not be null for ${fmt}`);
      assert.strictEqual(q.assessmentFormat, fmt);
      assert.strictEqual(q.difficulty, 'normal');
      assert.strictEqual(q.bloomLevel, 'apply');
      assert.ok(q.questionText && q.questionText.length > 5, 'questionText must exist');
      assert.ok(q.payload && typeof q.payload === 'object', 'payload must exist as an object');
      assert.ok(q.evaluationData && typeof q.evaluationData === 'object', 'evaluationData must exist as an object');

      const validation = validateAssessment(q);
      assert.strictEqual(validation.valid, true, `Validation must pass for ${fmt}: ${validation.errors.join('; ')}`);
    });
  });

  // ── 3. Format-Routed Defensible Evaluation & Scoring ─────────────────────────
  console.log('\n--- Suite 3: Format-Routed Defensible Evaluation ---');

  await test('MCQ evaluation: exact option and option letter match', async () => {
    const assessment = {
      assessmentFormat: 'mcq',
      questionText: 'What is a binary search prerequisite?',
      payload: { options: ['Array must be sorted', 'Array must have even length', 'Elements must be strings', 'No duplicates allowed'] },
      evaluationData: { correctAnswer: 'Array must be sorted' },
    };

    const resExact = await evaluateAssessment({ format: 'mcq', studentAnswer: 'Array must be sorted', assessment });
    assert.strictEqual(resExact.isCorrect, true);
    assert.strictEqual(resExact.score, 1);

    const resLetter = await evaluateAssessment({ format: 'mcq', studentAnswer: 'A', assessment });
    assert.strictEqual(resLetter.isCorrect, true);

    const resWrong = await evaluateAssessment({ format: 'mcq', studentAnswer: 'Array must have even length', assessment });
    assert.strictEqual(resWrong.isCorrect, false);
    assert.strictEqual(resWrong.score, 0);
  });

  await test('Code Tracing evaluation: normalized numeric and option matching', async () => {
    const assessment = {
      assessmentFormat: 'code_tracing',
      questionText: 'What is logged?',
      payload: { codeSnippet: 'let sum = 0; for(let i=0; i<3; i++) sum += i; console.log(sum);', options: ['3', '6', '1', '0'] },
      evaluationData: { expectedOutput: '3' },
    };

    const res1 = await evaluateAssessment({ format: 'code_tracing', studentAnswer: '3', assessment });
    assert.strictEqual(res1.isCorrect, true);

    const resLetter = await evaluateAssessment({ format: 'code_tracing', studentAnswer: 'A', assessment });
    assert.strictEqual(resLetter.isCorrect, true);

    const resWrong = await evaluateAssessment({ format: 'code_tracing', studentAnswer: '6', assessment });
    assert.strictEqual(resWrong.isCorrect, false);
  });

  await test('Code Completion evaluation: whitespace & syntax normalization', async () => {
    const assessment = {
      assessmentFormat: 'code_completion',
      questionText: 'Complete the return statement:',
      payload: { codeSnippet: 'function getId(user) { /* COMPLETE HERE */ }' },
      evaluationData: {
        correctCompletion: 'return user.id;',
        acceptedSolutions: ['return user.id;', 'return user["id"];'],
      },
    };

    const resWhitespace = await evaluateAssessment({ format: 'code_completion', studentAnswer: '   return   user.id ;  ', assessment });
    assert.strictEqual(resWhitespace.isCorrect, true);

    const resAlt = await evaluateAssessment({ format: 'code_completion', studentAnswer: 'return user["id"];', assessment });
    assert.strictEqual(resAlt.isCorrect, true);

    const resFail = await evaluateAssessment({ format: 'code_completion', studentAnswer: 'return false;', assessment });
    assert.strictEqual(resFail.isCorrect, false);

    // Beginner variable assignment test: typing just the value vs full statement
    const beginnerAssessment = {
      assessmentFormat: 'code_completion',
      questionText: 'Complete the code to assign 10 to variable count:',
      payload: { codeSnippet: 'let count = ___;\nconsole.log(count);' },
      evaluationData: {
        correctCompletion: '10',
        acceptedSolutions: ['10', '10;'],
      },
    };

    const resBeginnerValue = await evaluateAssessment({ format: 'code_completion', studentAnswer: '10', assessment: beginnerAssessment });
    assert.strictEqual(resBeginnerValue.isCorrect, true, 'Beginner typing value 10 should pass');

    const resBeginnerValueSemi = await evaluateAssessment({ format: 'code_completion', studentAnswer: '10;', assessment: beginnerAssessment });
    assert.strictEqual(resBeginnerValueSemi.isCorrect, true, 'Beginner typing value 10; should pass');

    const resBeginnerStatement = await evaluateAssessment({ format: 'code_completion', studentAnswer: 'let count = 10;', assessment: beginnerAssessment });
    assert.strictEqual(resBeginnerStatement.isCorrect, true, 'Beginner typing full statement should pass');
  });

  await test('Debugging evaluation: rejects arbitrary strings, accepts valid diagnosis & fix', async () => {
    const assessment = {
      assessmentFormat: 'debugging',
      questionText: 'Find and fix the error in calculateTotal:',
      payload: { buggyCode: 'function total(items) { let sum; for(let i=0;i<items.length;i++) sum+=items[i]; return sum; }' },
      evaluationData: { identifiedBug: 'Line 1: sum is undefined and not initialized', fixedCode: 'let sum = 0;' },
      explanation: 'In JavaScript uninitialized variable sum causes sum += items[i] to evaluate to NaN.',
    };

    // PROVE NO LENGTH PROXY: an arbitrary 12+ character string must fail!
    const resFail = await evaluateAssessment({ format: 'debugging', studentAnswer: 'abcdefghijklmnop', assessment });
    assert.strictEqual(resFail.isCorrect, false, 'Meaningless string must fail without length proxy');

    // Valid diagnosis and fix must pass
    const resPass = await evaluateAssessment({
      format: 'debugging',
      studentAnswer: 'The variable sum is undefined and not initialized. It needs to be initialized to 0.',
      assessment,
    });
    assert.strictEqual(resPass.isCorrect, true);
    assert.ok(resPass.criteriaResults.length > 0);

    // IN-PLACE CODE EDIT: Student directly edits the code snippet to fix the defect
    const editedSnippet = 'function total(items) { let sum = 0; for(let i=0;i<items.length;i++) sum+=items[i]; return sum; }';
    const resEditedCode = await evaluateAssessment({
      format: 'debugging',
      studentAnswer: editedSnippet,
      assessment,
    });
    assert.strictEqual(resEditedCode.isCorrect, true, 'Direct in-place code edit fixing the defect must pass');

    // FILL-IN-THE-BLANK / FIXED LINE: Student inputs only the corrected line
    const resFixedLine = await evaluateAssessment({
      format: 'debugging',
      studentAnswer: 'let sum = 0;',
      assessment,
    });
    assert.strictEqual(resFixedLine.isCorrect, true, 'Fill-in-the-blank corrected line must pass');

    // UNMODIFIED BUGGY CODE: Must fail because defect is not resolved
    const resUnmodified = await evaluateAssessment({
      format: 'debugging',
      studentAnswer: assessment.payload.buggyCode,
      assessment,
    });
    assert.strictEqual(resUnmodified.isCorrect, false, 'Unmodified buggy code must fail');
  });

  await test('Short Answer evaluation: rejects arbitrary strings, accepts conceptual response', async () => {
    const assessment = {
      assessmentFormat: 'short_answer',
      questionText: 'What is polymorphism in OOP?',
      payload: { suggestedLength: '1-2 sentences' },
      evaluationData: {
        modelAnswer: 'Polymorphism allows objects of different classes to be treated as instances of a common superclass, executing overriding method implementations.',
        keywords: ['polymorphism', 'superclass', 'overriding', 'methods'],
      },
      explanation: 'Core concepts: common interface, subclass specialization, dynamic dispatch.',
    };

    // Arbitrary string fails
    const resFail = await evaluateAssessment({ format: 'short_answer', studentAnswer: 'qwertyuiopasdfgh', assessment });
    assert.strictEqual(resFail.isCorrect, false, 'Meaningless string must fail short answer');

    // Substantive answer passes
    const resPass = await evaluateAssessment({
      format: 'short_answer',
      studentAnswer: 'Polymorphism allows different classes to share a common superclass interface while executing specific overriding method implementations.',
      assessment,
    });
    assert.strictEqual(resPass.isCorrect, true);
  });

  await test('Scenario-Based evaluation: choice-based and reasoning scoring', async () => {
    const assessment = {
      assessmentFormat: 'scenario_based',
      questionText: 'Select the optimal cache invalidation strategy:',
      payload: {
        scenario: 'A banking application requires immediate consistency upon account balance updates.',
        options: ['Write-through cache with transactional consistency', 'Time-to-live only without invalidation', 'Never cache balances'],
      },
      evaluationData: { bestChoice: 'Write-through cache with transactional consistency' },
    };

    const resPass = await evaluateAssessment({
      format: 'scenario_based',
      studentAnswer: 'Write-through cache with transactional consistency',
      assessment,
    });
    assert.strictEqual(resPass.isCorrect, true);

    const resWrong = await evaluateAssessment({
      format: 'scenario_based',
      studentAnswer: 'Time-to-live only without invalidation',
      assessment,
    });
    assert.strictEqual(resWrong.isCorrect, false);
  });

  // ── 4. Client Payload Security Verification ──────────────────────────────────
  console.log('\n--- Suite 4: Security Verification (Withholding Secrets) ---');

  SUPPORTED_FORMATS.forEach((fmt) => {
    test(`Client sanitization for format "${fmt}" withholds all answers and evaluation secrets`, () => {
      const fullAssessment = {
        _id: 'sample_id_123',
        assessmentFormat: fmt,
        questionText: 'Sample prompt for ' + fmt,
        marks: 1,
        difficulty: 'normal',
        bloomLevel: 'apply',
        learningObjective: 'Objective 1',
        explanation: 'Confidential pedagogical rationale and solution.',
        payload: {
          options: ['Alpha', 'Beta', 'Gamma'],
          codeSnippet: 'let x = 1; /* COMPLETE HERE */',
          buggyCode: 'let buggy = true;',
          scenario: 'A distributed system scenario.',
        },
        evaluationData: {
          correctAnswer: 'Alpha',
          modelAnswer: 'Teacher reference answer.',
          correctCompletion: 'return 1;',
          expectedOutput: '42',
          identifiedBug: 'Bug on line 1',
          fixedCode: 'fix line 1',
        },
        // Legacy top-level secrets
        correctAnswer: 'Alpha',
      };

      const sanitized = sanitizeAssessmentForClient(fullAssessment);

      assert.strictEqual(sanitized.correctAnswer, undefined, 'correctAnswer must NEVER be sent to client');
      assert.strictEqual(sanitized.evaluationData, undefined, 'evaluationData must NEVER be sent to client');
      assert.strictEqual(sanitized.explanation, undefined, 'explanation must NEVER be sent before submission');
      assert.strictEqual(sanitized.modelAnswer, undefined, 'modelAnswer must NEVER be sent to client');

      // Presentation fields must be intact
      assert.ok(sanitized.payload, 'payload must be present in sanitized output');
      assert.strictEqual(sanitized.assessmentFormat, fmt);
      assert.strictEqual(sanitized.questionText, fullAssessment.questionText);
    });
  });

  // ── 5. End-to-End AdaptiveActivity Lifecycle ────────────────────────────────
  console.log('\n--- Suite 5: AdaptiveActivity Schema & Submission Lifecycle ---');

  await test('AdaptiveActivity schema paths include payload and evaluationData', () => {
    const qPaths = AdaptiveActivity.schema.paths['question'].schema.paths;
    assert.ok(qPaths.payload, 'AdaptiveActivity question must have payload schema path');
    assert.ok(qPaths.evaluationData, 'AdaptiveActivity question must have evaluationData schema path');
    assert.ok(qPaths.assessmentFormat, 'AdaptiveActivity question must have assessmentFormat schema path');
  });

  await test('Simulate end-to-end question lifecycle for debugging format', async () => {
    // 1. Generation
    const spec = {
      topic: 'Recursion',
      learningObjective: 'Identify missing base case',
      bloomLevel: 'analyze',
      difficulty: 'advanced',
      assessmentFormat: 'debugging',
    };
    const generated = generateFallbackAdaptiveQuestion(spec);

    // 2. Client View (pre-submission)
    const clientSafe = sanitizeAssessmentForClient(generated);
    assert.strictEqual(clientSafe.correctAnswer, undefined);
    assert.strictEqual(clientSafe.evaluationData, undefined);
    assert.ok(clientSafe.payload.buggyCode);

    // 3. Student Submission & Evaluation
    const studentAnswer = 'The function is missing a terminating base case, which causes a stack overflow.';
    const evalResult = await evaluateAdaptiveResponse({
      format: 'debugging',
      studentAnswer,
      question: generated,
    });

    assert.ok(typeof evalResult.isCorrect === 'boolean');
    assert.ok(evalResult.score === 0 || evalResult.score === 1);
    assert.ok(evalResult.evaluator);
    assert.ok(Array.isArray(evalResult.criteriaResults));

    // 4. Post-Submission Reveal
    const postSubmissionOutcome = {
      isCorrect: evalResult.isCorrect,
      score: evalResult.score,
      correctAnswer: generated.evaluationData.identifiedBug || generated.correctAnswer,
      explanation: generated.explanation,
    };
    assert.ok(postSubmissionOutcome.correctAnswer.length > 0);
    assert.ok(postSubmissionOutcome.explanation.length > 0);
  });

  // ── 6. Standard Quiz Compatibility ──────────────────────────────────────────
  console.log('\n--- Suite 6: Standard Quiz Compatibility ---');

  await test('Quiz model questionSchema defines payload, evaluationData, and legacy options/correctAnswer', () => {
    const qPaths = Quiz.schema.paths['questions'].schema.paths;
    assert.ok(qPaths.questionText, 'Quiz questions must have questionText');
    assert.ok(qPaths.options, 'Quiz questions must have options');
    assert.ok(qPaths.correctAnswer, 'Quiz questions must have correctAnswer');
    assert.ok(qPaths.payload, 'Quiz questions must support payload');
    assert.ok(qPaths.evaluationData, 'Quiz questions must support evaluationData');
  });

  console.log('\n================================================================');
  console.log(`📊 RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllTests();
