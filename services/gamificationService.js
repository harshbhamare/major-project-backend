const User = require('../models/User');

const LEVEL_CONFIG = [
  { level: 1, minXp: 0,    title: 'Novice Explorer' },
  { level: 2, minXp: 150,  title: 'Code Apprentice' },
  { level: 3, minXp: 400,  title: 'Bug Hunter' },
  { level: 4, minXp: 800,  title: 'Code Sleuth' },
  { level: 5, minXp: 1400, title: 'Algorithm Crafter' },
  { level: 6, minXp: 2200, title: 'Master Architect' },
];

function getLevelInfo(xp = 0) {
  let currentLevel = LEVEL_CONFIG[0];
  let nextLevel = LEVEL_CONFIG[1];

  for (let i = LEVEL_CONFIG.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_CONFIG[i].minXp) {
      currentLevel = LEVEL_CONFIG[i];
      nextLevel = LEVEL_CONFIG[i + 1] || null;
      break;
    }
  }

  const nextLevelXp = nextLevel ? nextLevel.minXp : currentLevel.minXp + 1000;
  const currentBaseXp = currentLevel.minXp;
  const progressInLevel = Math.max(0, xp - currentBaseXp);
  const neededInLevel = Math.max(1, nextLevelXp - currentBaseXp);
  const progressPct = Math.min(100, Math.round((progressInLevel / neededInLevel) * 100));

  return {
    level: currentLevel.level,
    title: currentLevel.title,
    xp,
    nextLevelXp,
    currentBaseXp,
    progressPct,
  };
}

function updateStreak(user) {
  const now = new Date();
  const lastActive = user.lastActiveDate ? new Date(user.lastActiveDate) : null;
  let streak = user.streak || 1;

  if (lastActive) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lastDay = new Date(lastActive.getFullYear(), lastActive.getMonth(), lastActive.getDate());
    const diffDays = Math.round((today - lastDay) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      streak += 1;
    } else if (diffDays > 1) {
      streak = 1; // streak broke
    }
    // If diffDays === 0, active today already: keep current streak
  } else {
    streak = 1;
  }

  user.streak = streak;
  user.lastActiveDate = now;
  return streak;
}

/**
 * Awards gamification rewards for adaptive activities or quizzes
 */
async function awardGamification(userId, { type, format, isCorrect, score = 0, percentage = 0 }) {
  const user = await User.findById(userId);
  if (!user) return null;

  // 1. Calculate XP
  let xpEarned = 15; // Participation XP

  if (type === 'adaptive') {
    if (isCorrect) {
      xpEarned += 35; // base correct bonus
      if (format === 'debugging') {
        xpEarned += 25; // Bug squashing special bounty! (total +75 XP)
      } else if (format === 'code_completion' || format === 'code_tracing') {
        xpEarned += 15;
      }
    }
  } else if (type === 'quiz') {
    xpEarned = 50; // base quiz finish
    if (percentage >= 90) xpEarned += 50; // Ace bonus
    else if (percentage >= 70) xpEarned += 30;
    else if (percentage >= 50) xpEarned += 15;
  }

  user.xp = (user.xp || 0) + xpEarned;

  // 2. Update Streak
  const streak = updateStreak(user);

  // 3. Update Level
  const levelInfo = getLevelInfo(user.xp);
  user.level = levelInfo.level;

  // 4. Check Badges
  const existingBadgeIds = new Set((user.badges || []).map(b => b.id));
  const newBadges = [];

  const maybeUnlock = (id, title, icon, description) => {
    if (!existingBadgeIds.has(id)) {
      const badge = { id, title, icon, description, unlockedAt: new Date() };
      user.badges.push(badge);
      existingBadgeIds.add(id);
      newBadges.push(badge);
    }
  };

  // Check conditions
  if (format === 'debugging' && isCorrect) {
    maybeUnlock('first_bug_squashed', 'Bug Squashed!', '🐞', 'Found and corrected a defect in code.');
  }
  if (type === 'adaptive' && isCorrect) {
    maybeUnlock('adaptive_ace', 'Adaptive Ace', '⚡', 'Mastered a targeted concept practice challenge.');
  }
  if (type === 'quiz' && percentage >= 90) {
    maybeUnlock('quiz_ace', 'Quiz Master', '🎯', 'Scored 90%+ on a module assessment.');
  }
  if (streak >= 3) {
    maybeUnlock('streak_3', 'Hot Streak', '🔥', 'Maintained a 3-day learning streak.');
  }
  if (user.xp >= 500) {
    maybeUnlock('scholar_500', 'Knowledge Seeker', '🌟', 'Accumulated 500+ XP on your journey.');
  }

  await user.save();

  return {
    xpEarned,
    totalXp: user.xp,
    level: levelInfo.level,
    levelTitle: levelInfo.title,
    nextLevelXp: levelInfo.nextLevelXp,
    progressPct: levelInfo.progressPct,
    streak,
    newBadges,
    allBadges: user.badges || [],
  };
}

module.exports = {
  getLevelInfo,
  awardGamification,
};
