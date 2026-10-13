/**
 * Reusable utility to extract and format a user's display name consistently.
 * Ensures the user's email is never exposed publicly as an identity string.
 *
 * @param {Object|null|undefined} user - User object with optional name/email.
 * @returns {string} Clean display name.
 */
export function getUserDisplayName(user) {
  if (!user) return 'User';
  if (typeof user === 'string') {
    // If a string was passed (e.g. legacy name or email string)
    if (user.includes('@')) {
      return user.split('@')[0];
    }
    return user.trim() || 'User';
  }
  if (user.name && typeof user.name === 'string' && user.name.trim().length > 0) {
    return user.name.trim();
  }
  if (user.email && typeof user.email === 'string') {
    return user.email.split('@')[0];
  }
  return 'User';
}

/**
 * Reusable utility to check if a user object or user ID matches the current logged-in user.
 *
 * @param {Object|string|null|undefined} targetUserOrId - Target user object (with .id or .user_id) or string ID.
 * @param {string|null|undefined} currentUserId - The authenticated user's ID.
 * @param {string|null|undefined} [currentUserEmail] - Optional fallback for legacy email comparison if needed.
 * @returns {boolean} True if the target represents the current user.
 */
export function isCurrentUser(targetUserOrId, currentUserId, currentUserEmail = null) {
  if (!targetUserOrId) return false;

  const targetId = typeof targetUserOrId === 'object'
    ? (targetUserOrId?.id ?? targetUserOrId?.user_id)
    : targetUserOrId;

  if (currentUserId && targetId) {
    return String(targetId).toLowerCase() === String(currentUserId).toLowerCase();
  }

  // Fallback for legacy email comparison if target and current user both supply email
  if (currentUserEmail && typeof targetUserOrId === 'object' && targetUserOrId?.email) {
    if (String(targetUserOrId.email).toLowerCase() === String(currentUserEmail).toLowerCase()) {
      return true;
    }
  }

  return false;
}

