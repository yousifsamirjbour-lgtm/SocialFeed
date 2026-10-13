import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FollowModal from '../FollowModal';

describe('FollowModal Component', () => {
  const mockUsers = [
    { id: 'u1', name: 'User One', is_following: true },
    { id: 'u2', name: 'User Two', is_following: false }
  ];

  const defaultProps = {
    setShowFollowModal: vi.fn(),
    followModalType: 'followers',
    followList: mockUsers,
    email: 'me@example.com',
    currentUserId: 'my-id',
    navigateToProfile: vi.fn(),
    handleFollowToggle: vi.fn()
  };

  it('renders modal header and list of users by name', () => {
    render(<FollowModal {...defaultProps} />);

    expect(screen.getByText('followers')).toBeInTheDocument();
    expect(screen.getByText('User One')).toBeInTheDocument();
    expect(screen.getByText('User Two')).toBeInTheDocument();
  });

  it('renders empty state when list is empty', () => {
    render(<FollowModal {...defaultProps} followList={[]} />);

    expect(screen.getByText('No followers yet.')).toBeInTheDocument();
  });

  it('triggers close button', () => {
    render(<FollowModal {...defaultProps} />);
    const closeBtn = screen.getByText('✕');
    fireEvent.click(closeBtn);
    expect(defaultProps.setShowFollowModal).toHaveBeenCalledWith(false);
  });
});
