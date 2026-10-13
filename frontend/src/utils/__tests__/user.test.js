import { describe, it, expect } from 'vitest';
import { getUserDisplayName, isCurrentUser } from '../user';

describe('user utils', () => {
  describe('getUserDisplayName', () => {
    it('returns user name if present and trimmed', () => {
      expect(getUserDisplayName({ name: '  Alice Bob  ' })).toBe('Alice Bob');
    });

    it('falls back to email prefix if name is missing or empty', () => {
      expect(getUserDisplayName({ email: 'alice@example.com' })).toBe('alice');
      expect(getUserDisplayName({ name: '   ', email: 'bob@example.com' })).toBe('bob');
    });

    it('handles string input correctly', () => {
      expect(getUserDisplayName('carol@example.com')).toBe('carol');
      expect(getUserDisplayName('Carol Danvers')).toBe('Carol Danvers');
    });

    it('returns "User" if user is null or undefined or empty', () => {
      expect(getUserDisplayName(null)).toBe('User');
      expect(getUserDisplayName(undefined)).toBe('User');
      expect(getUserDisplayName({})).toBe('User');
    });
  });

  describe('isCurrentUser', () => {
    const currentUserId = '11111111-2222-3333-4444-555555555555';
    const currentUserEmail = 'me@example.com';

    it('returns true when target has matching id property', () => {
      expect(isCurrentUser({ id: currentUserId }, currentUserId, currentUserEmail)).toBe(true);
    });

    it('returns true when target has matching user_id property', () => {
      expect(isCurrentUser({ user_id: currentUserId }, currentUserId, currentUserEmail)).toBe(true);
    });

    it('returns true when target is matching string ID', () => {
      expect(isCurrentUser(currentUserId, currentUserId, currentUserEmail)).toBe(true);
    });

    it('handles case-insensitive UUID match', () => {
      expect(isCurrentUser(currentUserId.toUpperCase(), currentUserId, currentUserEmail)).toBe(true);
      expect(isCurrentUser({ id: currentUserId.toUpperCase() }, currentUserId, currentUserEmail)).toBe(true);
    });

    it('falls back to email matching when IDs are not available', () => {
      expect(isCurrentUser({ email: 'ME@EXAMPLE.COM' }, null, currentUserEmail)).toBe(true);
      expect(isCurrentUser({ email: 'other@example.com' }, null, currentUserEmail)).toBe(false);
    });

    it('returns false when IDs mismatch even if email matches', () => {
      expect(isCurrentUser({ id: 'other-id', email: currentUserEmail }, currentUserId, currentUserEmail)).toBe(false);
    });

    it('returns false when target has different ID', () => {
      expect(isCurrentUser({ id: 'other-id' }, currentUserId, currentUserEmail)).toBe(false);
      expect(isCurrentUser('other-id', currentUserId, currentUserEmail)).toBe(false);
    });

    it('returns false for null, undefined, or empty targets', () => {
      expect(isCurrentUser(null, currentUserId, currentUserEmail)).toBe(false);
      expect(isCurrentUser(undefined, currentUserId, currentUserEmail)).toBe(false);
      expect(isCurrentUser({}, currentUserId, currentUserEmail)).toBe(false);
    });
  });
});
