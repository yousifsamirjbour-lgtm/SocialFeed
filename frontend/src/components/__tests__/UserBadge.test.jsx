import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import UserBadge from '../UserBadge';

describe('UserBadge Component', () => {
  const mockUser = {
    id: 'user-123',
    name: 'Sarah Connor',
    email: 'sarah@example.com',
    is_following: false
  };

  const defaultProps = {
    userObj: mockUser,
    email: 'viewer@example.com',
    currentUserId: 'viewer-id',
    showFollowButton: true,
    navigateToProfile: vi.fn(),
    handleFollowToggle: vi.fn()
  };

  it('renders display name and never renders email', () => {
    render(<UserBadge {...defaultProps} />);

    expect(screen.getByText('Sarah Connor')).toBeInTheDocument();
    expect(screen.queryByText('sarah@example.com')).not.toBeInTheDocument();
  });

  it('falls back to email prefix if name is missing', () => {
    const userWithoutName = { id: 'u2', email: 'john.wick@example.com' };
    render(<UserBadge {...defaultProps} userObj={userWithoutName} />);

    expect(screen.getByText('john.wick')).toBeInTheDocument();
    expect(screen.queryByText('john.wick@example.com')).not.toBeInTheDocument();
  });

  it('triggers navigateToProfile on clicking username link', () => {
    render(<UserBadge {...defaultProps} />);
    fireEvent.click(screen.getByText('Sarah Connor'));
    expect(defaultProps.navigateToProfile).toHaveBeenCalledWith('user-123');
  });

  it('renders follow button and calls handleFollowToggle on click', () => {
    render(<UserBadge {...defaultProps} />);
    const followBtn = screen.getByRole('button', { name: /Follow/i });
    expect(followBtn).toBeInTheDocument();
    fireEvent.click(followBtn);
    expect(defaultProps.handleFollowToggle).toHaveBeenCalledWith('user-123');
  });

  it('hides follow button when user is the current user', () => {
    render(<UserBadge {...defaultProps} currentUserId="user-123" />);
    expect(screen.queryByRole('button', { name: /Follow/i })).not.toBeInTheDocument();
  });
});
