/**
 * adaptationService.js
 *
 * Responsible for WHAT the learner should receive next.
 * Returns a transparent, reproducible adaptation plan — no black boxes.
 *
 * Architecture (spec §5):
 *   adaptationService → decides what to present
 *   learnerModelService → owns knowledge state
 *   aiService → generates content/assessment from the plan
 *
 * V1 Policy Table (spec §7 — operational design choices, not validated constants):
 *
 *  Mastery      State               Action      Content                Bloom        Assessment
 *  <0.40        needs_intervention  remediate   worked_examples        understand   mcq / short_answer
 *  0.40–<0.60   needs_intervention  remediate   remedial_explanation   apply        mcq / code_tracing
 *  0.60–<0.70   developing          reinforce   targeted_practice      apply/analy  code_completion / code_tracing
 *  0.70–<0.80   developing          reinforce   targeted_practice      analyze      debugging / scenario_based
 *  ≥0.80        mastered            advance     advanced_practice      eval/create  scenario_based
 */

const Module = require('../models/Module');
const Topic  = require('../models/Topic');
const {
  getKnowledgeGaps,
  getLearnerStateForModule,
  classifyKnowledgeState,
} = require('./learnerModelService');

// ── V1 Policy table ───────────────────────────────────────────────────────────
// Each row maps a mastery range to a full adaptation specification.
// Keep as a plain data structure so it can be swapped/tuned experimentally.
const POLICY = [
  {
    // Deep gap — student fundamentally doesn't understand the concept
    masteryMin: 0,    masteryMax: 0.40,
    state:      'needs_intervention',
    action:     'remediate',
    content:    'worked_examples',
    bloom:      'understand',
    formats:    ['mcq', 'short_answer'],
    difficulty: 'easy',
    reason:     'Mastery below 40% — worked examples and basic recognition tasks are most appropriate.',
  },
  {
    // Partial understanding — can recognise but not apply
    masteryMin: 0.40, masteryMax: 0.60,
    state:      'needs_intervention',
    action:     'remediate',
    content:    'remedial_explanation',
    bloom:      'apply',
    formats:    ['mcq', 'code_tracing'],
    difficulty: 'normal',
    reason:     'Mastery 40–60% — remedial explanation with application tasks required.',
  },
  {
    // Developing — applying but not analysing
    masteryMin: 0.60, masteryMax: 0.70,
    state:      'developing',
    action:     'reinforce',
    content:    'targeted_practice',
    bloom:      'apply',
    formats:    ['code_completion', 'code_tracing'],
    difficulty: 'normal',
    reason:     'Mastery 60–70% — targeted practice at application level to consolidate understanding.',
  },
  {
    // Developing — analysing but not yet mastered
    masteryMin: 0.70, masteryMax: 0.80,
    state:      'developing',
    action:     'reinforce',
    content:    'targeted_practice',
    bloom:      'analyze',
    formats:    ['debugging', 'scenario_based'],
    difficulty: 'advanced',
    reason:     'Mastery 70–80% — analysis-level tasks to move toward mastery.',
  },
  {
    // Mastered — ready for extension
    masteryMin: 0.80, masteryMax: 1.01,
    state:      'mastered',
    action:     'advance',
    content:    'advanced_practice',
    bloom:      'evaluate',
    formats:    ['scenario_based'],
    difficulty: 'advanced',
    reason:     'Mastery ≥80% — advance with evaluation/creation-level tasks.',
  },
];

/**
 * Look up the V1 policy row for a given mastery value.
 * Falls back to the first row if nothing matches (defensive).
 */
function policyFor(mastery) {
  return POLICY.find(p => mastery >= p.masteryMin && mastery < p.masteryMax) || POLICY[0];
}

/**
 * Intelligently and automatically determine the assessment format according to:
 * 1. Module characteristics (title, description, difficulty, coding vs conceptual domain)
 * 2. Topic characteristics (topic title, summary, key pedagogical concepts)
 * 3. Learner mastery level & trend (Bloom taxonomy alignment)
 * 4. Anti-fatigue rotation (cycles away from recentFormats[0] to keep practice varied)
 *
 * Returns: { format: string, reason: string }
 */
function determineAutomatedFormat({
  module = {},
  topic = {},
  mastery = 0.5,
  trend = 'stable',
  recentFormats = [],
  isAdvancement = false,
}) {
  const combinedText = `${module?.title || ''} ${module?.description || ''} ${topic?.title || ''} ${topic?.summary || ''}`.toLowerCase();

  // Domain signals
  const isCodeModule = /code|program|function|variable|loop|class|syntax|array|list|map|object|null|string|async|promise|thread|runtime|compiler|algorithm|struct|java|kotlin|python|node|c\+\+|c\#|javascript|react|typescript|sql|database|api|http|oop|method|constructor|debug|trace|compile/i.test(combinedText);

  // Concept signals
  const hasDebugIntent = /null|safety|bug|error|exception|debug|troubleshoot|fix|leak|edge case|handling|race condition|deadlock|failing|broken|crash/i.test(combinedText);
  const hasTracingIntent = /loop|range|iteration|for\b|while\b|recursion|control flow|condition|if-else|if\b|else\b|when\b|switch\b|execution|trace|output|step|order/i.test(combinedText);
  const hasCompletionIntent = /syntax|variable|function|method|class|constructor|array|collection|list|map|set|structure|module|implement|definition|npm|file system|declare/i.test(combinedText);
  const hasScenarioIntent = /architecture|design|pattern|system|environment|project|production|scalability|security|lifecycle|real-world|application/i.test(combinedText);

  // For a spoonfed, frictionless student experience, automated adaptive practice
  // consistently uses 4-choice interactive question formats (MCQ, code tracing, scenario):
  let candidates = ['mcq', 'code_tracing', 'scenario_based'];

  if (isAdvancement || mastery >= 0.80) {
    candidates = ['scenario_based', 'mcq', 'code_tracing'];
  } else if (mastery >= 0.65) {
    candidates = ['code_tracing', 'mcq', 'scenario_based'];
  } else {
    candidates = ['mcq', 'code_tracing', 'scenario_based'];
  }

  // Declining trend scaffolding: prefer the most scaffolded candidate
  if (trend === 'declining' && candidates.includes('code_tracing')) {
    candidates = ['code_tracing', ...candidates.filter(c => c !== 'code_tracing')];
  }

  // Anti-fatigue rotation: If candidate 0 matches the most recent format, rotate to candidate 1 if available
  let chosenFormat = candidates[0];
  if (recentFormats.length > 0 && recentFormats[0] === chosenFormat && candidates.length > 1) {
    chosenFormat = candidates[1];
  }

  // Automated rationale generation
  const formatDisplayNames = {
    debugging: 'Debugging',
    code_tracing: 'Code Tracing',
    code_completion: 'Code Completion',
    scenario_based: 'Scenario-Based',
    short_answer: 'Short Answer',
    mcq: 'Multiple Choice',
  };

  const moduleName = module?.title || 'this module';
  const topicName = topic?.title || 'this topic';
  const formatName = formatDisplayNames[chosenFormat] || chosenFormat;
  const masteryPct = Math.round(mastery * 100);

  let rationale = '';
  if (chosenFormat === 'debugging') {
    rationale = `Automated for ${moduleName} (${topicName}): ${formatName} selected to analyze edge cases and repair defect patterns aligned with current mastery (${masteryPct}%).`;
  } else if (chosenFormat === 'code_tracing') {
    rationale = `Automated for ${moduleName} (${topicName}): ${formatName} selected to verify step-by-step program execution and variable states.`;
  } else if (chosenFormat === 'code_completion') {
    rationale = `Automated for ${moduleName} (${topicName}): ${formatName} selected to reinforce syntax implementation and structural fluency.`;
  } else if (chosenFormat === 'scenario_based') {
    rationale = `Automated for ${moduleName} (${topicName}): ${formatName} selected to test real-world architectural and problem-solving reasoning.`;
  } else if (chosenFormat === 'short_answer') {
    rationale = `Automated for ${moduleName} (${topicName}): ${formatName} selected to assess clear conceptual understanding.`;
  } else {
    rationale = `Automated for ${moduleName} (${topicName}): ${formatName} selected for foundational concept verification.`;
  }

  return { format: chosenFormat, reason: rationale };
}

/**
 * Select a specific assessment format from the policy row's format list.
 * Fallback / compatibility wrapper for determineAutomatedFormat.
 */
function selectFormat(policyRow, trend) {
  const formats = policyRow.formats;
  if (trend === 'declining') return formats[0];
  return formats[formats.length - 1];
}

/**
 * Build the learningObjective string from the policy.
 * Kept as a human-readable string so it can be logged and passed to the LLM.
 */
function buildObjective(topicTitle, policyRow) {
  const verbMap = {
    understand: 'Explain and identify',
    apply:      'Apply and demonstrate',
    analyze:    'Analyse and compare',
    evaluate:   'Evaluate and justify',
    create:     'Design and construct',
  };
  const verb = verbMap[policyRow.bloom] || 'Understand';
  return `${verb} the core concepts of "${topicTitle}"`;
}

// ─── Main adaptation function ─────────────────────────────────────────────────

/**
 * getNextLearningAction(studentId, moduleId, options = {})
 *
 * Returns a transparent adaptation plan. Every field is documented so the
 * system's decision is always interpretable and reproducible.
 *
 * no_action reasons are strictly distinct:
 *   'all_mastered'       — all topics have >= MIN_ATTEMPTS and are >= 0.80 mastery
 *   'insufficient_data'  — topics have not yet reached the MIN_ATTEMPTS threshold
 *   'no_topics'          — module has no topics
 *   'module_not_found'   — module does not exist
 *
 * When options.allowAdvance is true and all topics are mastered,
 * it returns an active 'advance' adaptation plan to challenge the learner.
 * When options.autoStart is true, it initiates automated practice even if prior
 * quiz interaction data has not yet reached MIN_ATTEMPTS.
 *
 * @returns {object} adaptation plan
 */
const getNextLearningAction = async (studentId, moduleId, options = {}) => {
  try {
    const { MIN_ATTEMPTS } = require('./learnerModelService');
    const module = await Module.findById(moduleId).populate('topics', 'title summary difficulty');
    if (!module) return { hasGap: false, action: 'no_action', noActionReason: 'module_not_found', reason: 'Module not found.' };

    const topicIds = module.topics.map(t => t._id);
    if (topicIds.length === 0) {
      return { hasGap: false, action: 'no_action', noActionReason: 'no_topics', reason: 'Module has no topics.' };
    }

    // Fetch learner state for all topics in this module
    const stateMap = await getLearnerStateForModule(studentId, topicIds);

    // Build ordered list of topics with learner progress
    const orderedTopics = module.topics.map((t, index) => {
      const r = stateMap[t._id.toString()];
      const mastery = r ? r.mastery : 0.5;
      const attempts = r ? r.attemptCount : 0;
      const trend = r?.trend || 'stable';
      const isMastered = attempts >= MIN_ATTEMPTS && mastery >= 0.80;
      return {
        topic: t,
        topicId: t._id,
        title: t.title,
        order: index + 1,
        index,
        mastery,
        attempts,
        trend,
        isMastered,
        isProficient: mastery >= 0.65 && attempts >= 1,
      };
    });

    // Determine unlocked threshold: student can access topics up to the first non-proficient topic + 1
    let unlockedUntilIndex = 0;
    for (let i = 0; i < orderedTopics.length; i++) {
      if (orderedTopics[i].isProficient || orderedTopics[i].isMastered) {
        unlockedUntilIndex = Math.min(i + 1, orderedTopics.length - 1);
      } else {
        break;
      }
    }

    // Check if entire module is mastered
    const allMastered = orderedTopics.length > 0 && orderedTopics.every(t => t.isMastered);

    if (allMastered && !options.targetTopicId) {
      if (options.allowAdvance) {
        // Advanced mastery challenge on the last or most complex topic
        const target = orderedTopics[orderedTopics.length - 1];
        const policy = policyFor(target.mastery);
        const automated = determineAutomatedFormat({
          module,
          topic: target.topic,
          mastery: target.mastery,
          trend: target.trend,
          recentFormats: options.recentFormats || [],
          isAdvancement: true,
        });
        const format = options.format || automated.format;
        return {
          hasGap: true,
          isAdvancement: true,
          action: 'advance',
          topicId: target.topicId,
          topicTitle: target.title,
          sequenceIndex: target.index,
          totalTopics: orderedTopics.length,
          mastery: Math.round(target.mastery * 100) / 100,
          masteryState: 'mastered',
          trend: target.trend,
          contentStrategy: 'advanced_practice',
          difficulty: 'advanced',
          bloomLevel: 'evaluate',
          assessmentFormat: format,
          learningObjective: `Mastery Challenge: Analyze complex scenarios in "${target.title}"`,
          reason: 'All foundational topics mastered! Ready for advanced application challenge.',
          topicChain: orderedTopics.map(ot => ({
            topicId: ot.topicId,
            title: ot.title,
            order: ot.order,
            isUnlocked: true,
            isCurrent: ot.index === target.index,
            isMastered: true,
            mastery: ot.mastery,
          })),
          allGaps: [],
          noActionReason: null,
        };
      }

      return {
        hasGap: false,
        action: 'no_action',
        noActionReason: 'all_mastered',
        reason: 'Congratulations! All topics in this module have reached the mastery threshold (≥80%).',
        canAdvance: true,
        topicChain: orderedTopics.map(ot => ({
          topicId: ot.topicId,
          title: ot.title,
          order: ot.order,
          isUnlocked: true,
          isCurrent: false,
          isMastered: true,
          mastery: ot.mastery,
        })),
      };
    }

    // ── Target Topic Selection (Progressive Ladder) ──────────────────────────
    let selectedTarget = null;

    if (options.targetTopicId) {
      // Direct request from student (e.g. clicking a topic in the topic chain)
      selectedTarget = orderedTopics.find(t => t.topicId.toString() === options.targetTopicId.toString());
    }

    if (!selectedTarget) {
      // PROGRESSIVE CURRICULUM FLOW:
      // Strictly select the EARLIEST topic in sequential order that has not yet reached mastery (≥ 0.80).
      // This guarantees the student begins with Topic 1 (minute fundamentals) and progresses sequentially!
      selectedTarget = orderedTopics.find(t => t.mastery < 0.80) || orderedTopics[0];
    }

    const targetTopic = selectedTarget.topic;
    const mastery = selectedTarget.mastery;
    const trend = selectedTarget.trend;
    const policy = policyFor(mastery);

    const automated = determineAutomatedFormat({
      module,
      topic: targetTopic,
      mastery,
      trend,
      recentFormats: options.recentFormats || [],
      isAdvancement: mastery >= 0.80,
    });

    const format = options.format || automated.format;
    const learningObjective = buildObjective(targetTopic.title, policy);

    let contentStrategy = policy.content;
    if (selectedTarget.attempts === 0 || mastery < 0.50) {
      // Beginners always get step-by-step worked examples with simplified analogies
      contentStrategy = 'worked_examples';
    } else if (trend === 'declining' && mastery >= 0.40) {
      contentStrategy = 'misconception_correction';
    }

    const topicChain = orderedTopics.map(ot => ({
      topicId: ot.topicId,
      title: ot.title,
      order: ot.order,
      isUnlocked: true,
      isCurrent: ot.topicId.toString() === targetTopic._id.toString(),
      isMastered: ot.isMastered,
      mastery: ot.mastery,
      attempts: ot.attempts,
    }));

    return {
      hasGap: true,
      isAdvancement: mastery >= 0.80,
      action: policy.action,
      topicId: targetTopic._id,
      topicTitle: targetTopic.title,
      sequenceIndex: selectedTarget.index,
      totalTopics: orderedTopics.length,
      mastery: Math.round(mastery * 100) / 100,
      masteryState: policy.state,
      trend,
      contentStrategy,
      difficulty: (selectedTarget.index === 0 && selectedTarget.attempts < 2) ? 'easy' : policy.difficulty,
      bloomLevel: (selectedTarget.index === 0 && selectedTarget.attempts < 2) ? 'understand' : policy.bloom,
      assessmentFormat: (selectedTarget.index === 0 && selectedTarget.attempts < 2) ? 'mcq' : format,
      learningObjective,
      reason: `Progressive Step ${selectedTarget.index + 1}/${orderedTopics.length}: Focus on "${targetTopic.title}" before advancing to downstream topics.`,
      topicChain,
      allGaps: [],
      noActionReason: null,
    };
  } catch (err) {
    console.error('adaptationService error:', err.message);
    return null;
  }
};

// ─── Module summary (dashboard + ModuleView sidebar) ─────────────────────────

const getLearnerModuleSummary = async (studentId, moduleId) => {
  try {
    const module = await Module.findById(moduleId).populate('topics', 'title difficulty');
    if (!module) return null;

    const topicIds = module.topics.map(t => t._id);
    const stateMap = await getLearnerStateForModule(studentId, topicIds);

    const topicSummaries = module.topics.map(topic => {
      const record = stateMap[topic._id.toString()];
      const hasAttempts = record && record.attemptCount > 0;
      return {
        topicId:    topic._id,
        topicTitle: topic.title,
        mastery:    hasAttempts ? Math.round(record.mastery * 100) / 100 : null,
        state:      hasAttempts ? classifyKnowledgeState(record.mastery, record.attemptCount) : 'not_assessed',
        trend:      record?.trend || 'stable',
        attempts:   record?.attemptCount || 0,
      };
    });

    const assessed = topicSummaries.filter(t => t.mastery !== null);
    const avgMastery = assessed.length
      ? Math.round((assessed.reduce((s, t) => s + t.mastery, 0) / assessed.length) * 100) / 100
      : null;

    return { moduleId, topicSummaries, avgMastery };
  } catch (err) {
    console.error('getLearnerModuleSummary error:', err.message);
    return null;
  }
};

module.exports = {
  getNextLearningAction,
  getLearnerModuleSummary,
  determineAutomatedFormat,
  selectFormat,
  POLICY,
};
