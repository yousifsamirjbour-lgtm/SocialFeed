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
