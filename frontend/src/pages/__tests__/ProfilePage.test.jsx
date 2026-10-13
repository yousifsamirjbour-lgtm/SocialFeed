import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ProfilePage from '../ProfilePage';

describe('ProfilePage', () => {
  const ownUser = {
    id: 'my-id',
    email: 'me@example.com',
    bio: 'Software engineer bio',
    profile_picture_url: null,
    followers_count: 10,
    following_count: 5,
    is_following: false
  };

  const otherUser = {
    id: 'other-id',
    email: 'other@example.com',
    bio: 'Traveler bio',
    profile_picture_url: null,
    followers_count: 20,
    following_count: 15,
    is_following: true
  };

  const defaultProps = {
    viewedUser: ownUser,
    email: 'me@example.com',
    navigateToFeed: vi.fn(),
    handleFollowToggle: vi.fn(),
    setEditBio: vi.fn(),
    setShowEditProfileModal: vi.fn(),
    userPosts: [],
    handleViewFollows: vi.fn(),
    profileTab: 'posts',
    setProfileTab: vi.fn(),
    fetchSavedPosts: vi.fn(),
    savedPosts: [],
    likedPosts: [],
    loadedComments: {},
    showComments: {},
    commentInputs: {},
    setCommentInputs: vi.fn(),
    handleDeletePost: vi.fn(),
    handleLikeToggle: vi.fn(),
    handleViewLikers: vi.fn(),
    handleSaveToggle: vi.fn(),
    handleToggleComments: vi.fn(),
    handleDeleteComment: vi.fn(),
    handleCommentSubmit: vi.fn(),
    navigateToProfile: vi.fn()
  };

  it('renders own profile header with Edit Profile button and tabs', () => {
    render(<ProfilePage {...defaultProps} />);

    expect(screen.getByText('me@example.com')).toBeInTheDocument();
    expect(screen.getByText('Software engineer bio')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Profile' })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Posts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saved' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Liked' })).toBeInTheDocument();
    expect(screen.getByText('No posts yet.')).toBeInTheDocument();
  });

  it('renders other user profile with Follow/Unfollow button and no tabs', () => {
    render(<ProfilePage {...defaultProps} viewedUser={otherUser} email="me@example.com" />);

    expect(screen.getByText('other@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unfollow' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Profile' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Saved' })).not.toBeInTheDocument();
  });

  it('triggers Edit Profile modal when Edit Profile is clicked', () => {
    render(<ProfilePage {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
    expect(defaultProps.setEditBio).toHaveBeenCalledWith('Software engineer bio');
    expect(defaultProps.setShowEditProfileModal).toHaveBeenCalledWith(true);
  });

  it('triggers handleFollowToggle when Follow/Unfollow button clicked', () => {
    render(<ProfilePage {...defaultProps} viewedUser={otherUser} email="me@example.com" />);

    fireEvent.click(screen.getByRole('button', { name: 'Unfollow' }));
    expect(defaultProps.handleFollowToggle).toHaveBeenCalledWith('other-id');
  });

  it('triggers navigateToFeed when clicking Back button', () => {
    render(<ProfilePage {...defaultProps} />);

    fireEvent.click(screen.getByText('← Back to Feed'));
    expect(defaultProps.navigateToFeed).toHaveBeenCalled();
  });

  it('shows empty state for saved and liked tabs', () => {
    const { rerender } = render(<ProfilePage {...defaultProps} profileTab="saved" savedPosts={[]} />);
    expect(screen.getByText('No saved posts.')).toBeInTheDocument();

    rerender(<ProfilePage {...defaultProps} profileTab="liked" likedPosts={[]} />);
    expect(screen.getByText('No liked posts yet.')).toBeInTheDocument();
  });
});
