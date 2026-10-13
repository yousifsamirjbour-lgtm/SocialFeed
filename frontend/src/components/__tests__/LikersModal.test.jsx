import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import LikersModal from '../LikersModal';

describe('LikersModal Component', () => {
  const mockLikers = [
    { id: 'u1', email: 'liker1@example.com', is_following: false },
    { id: 'u2', email: 'liker2@example.com', is_following: true }
  ];

  const defaultProps = {
    setShowLikersModal: vi.fn(),
    currentLikers: mockLikers,
    email: 'me@example.com',
    navigateToProfile: vi.fn(),
    handleFollowToggle: vi.fn()
  };

  it('renders title and liker list', () => {
    render(<LikersModal {...defaultProps} />);

    expect(screen.getByText('Likes')).toBeInTheDocument();
    expect(screen.getByText('liker1@example.com')).toBeInTheDocument();
    expect(screen.getByText('liker2@example.com')).toBeInTheDocument();
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
