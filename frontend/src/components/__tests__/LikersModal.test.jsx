import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import LikersModal from '../LikersModal';

describe('LikersModal Component', () => {
  const mockLikers = [
    { id: 'u1', name: 'Liker One', is_following: false },
    { id: 'u2', name: 'Liker Two', is_following: true }
  ];

  const defaultProps = {
    setShowLikersModal: vi.fn(),
    currentLikers: mockLikers,
    email: 'me@example.com',
    currentUserId: 'my-id',
    navigateToProfile: vi.fn(),
    handleFollowToggle: vi.fn()
  };

  it('renders title and liker list by name', () => {
    render(<LikersModal {...defaultProps} />);

    expect(screen.getByText('Likes')).toBeInTheDocument();
    expect(screen.getByText('Liker One')).toBeInTheDocument();
    expect(screen.getByText('Liker Two')).toBeInTheDocument();
  });

  it('renders empty state when likers list is empty', () => {
    render(<LikersModal {...defaultProps} currentLikers={[]} />);

    expect(screen.getByText('No likes yet.')).toBeInTheDocument();
  });

  it('triggers close button', () => {
    render(<LikersModal {...defaultProps} />);
    const closeBtn = screen.getByText('✕');
    fireEvent.click(closeBtn);
    expect(defaultProps.setShowLikersModal).toHaveBeenCalledWith(false);
  });
});
