import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ProfilePage from '../ProfilePage';

describe('ProfilePage', () => {
  const ownUser = {
    id: 'my-id',
    name: 'My Name',
    email: 'me@example.com',
    bio: 'Software engineer bio',
    profile_picture_url: null,
    followers_count: 10,
    following_count: 5,
    is_following: false
  };

  const otherUser = {
    id: 'other-id',
    name: 'Other Person',
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
    currentUserId: 'my-id',
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

  it('renders own profile header with name (no email) and Edit Profile button', () => {
    render(<ProfilePage {...defaultProps} />);

    expect(screen.getByText('My Name')).toBeInTheDocument();
    expect(screen.queryByText('me@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('Software engineer bio')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    const editBtn = screen.getByRole('button', { name: 'Edit Profile' });
    expect(editBtn).toBeInTheDocument();
  });

  it('renders other user profile with name (no email) and Unfollow button when following', () => {
    render(<ProfilePage {...defaultProps} viewedUser={otherUser} currentUserId="my-id" email="me@example.com" />);

    expect(screen.getByText('Other Person')).toBeInTheDocument();
    expect(screen.queryByText('other@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('Traveler bio')).toBeInTheDocument();

    const unfollowBtn = screen.getByRole('button', { name: 'Unfollow' });
    expect(unfollowBtn).toBeInTheDocument();
  });

  it('triggers handleFollowToggle when clicking Follow/Unfollow button', () => {
    render(<ProfilePage {...defaultProps} viewedUser={otherUser} currentUserId="my-id" email="me@example.com" />);
    const unfollowBtn = screen.getByRole('button', { name: 'Unfollow' });
    fireEvent.click(unfollowBtn);
    expect(defaultProps.handleFollowToggle).toHaveBeenCalledWith('other-id');
  });

  it('opens edit modal and sets bio on Edit Profile click', () => {
    render(<ProfilePage {...defaultProps} />);
    const editBtn = screen.getByRole('button', { name: 'Edit Profile' });
    fireEvent.click(editBtn);
    expect(defaultProps.setEditBio).toHaveBeenCalledWith('Software engineer bio');
    expect(defaultProps.setShowEditProfileModal).toHaveBeenCalledWith(true);
  });

  it('triggers tab switching for Posts, Saved, and Liked', () => {
    render(<ProfilePage {...defaultProps} />);

    const savedTab = screen.getByRole('button', { name: 'Saved' });
    fireEvent.click(savedTab);
    expect(defaultProps.setProfileTab).toHaveBeenCalledWith('saved');
    expect(defaultProps.fetchSavedPosts).toHaveBeenCalled();

    const likedTab = screen.getByRole('button', { name: 'Liked' });
    fireEvent.click(likedTab);
    expect(defaultProps.setProfileTab).toHaveBeenCalledWith('liked');
  });

  it('triggers navigation back to feed', () => {
    render(<ProfilePage {...defaultProps} />);
    const backBtn = screen.getByText('← Back to Feed');
    fireEvent.click(backBtn);
    expect(defaultProps.navigateToFeed).toHaveBeenCalled();
  });

  it('allows opening followers and following modal on own profile even without email in viewedUser', () => {
    const ownUserWithoutEmail = {
      id: 'my-id',
      name: 'My Name',
      bio: 'Bio',
      followers_count: 12,
      following_count: 8
    };
    render(<ProfilePage {...defaultProps} viewedUser={ownUserWithoutEmail} currentUserId="my-id" />);

    const followersStat = screen.getByText(/followers/i);
    fireEvent.click(followersStat);
    expect(defaultProps.handleViewFollows).toHaveBeenCalledWith('followers');

    const followingStat = screen.getByText(/following/i);
    fireEvent.click(followingStat);
    expect(defaultProps.handleViewFollows).toHaveBeenCalledWith('following');
  });

  it('renders liked posts when on own profile with profileTab="liked"', () => {
    const likedPost = {
      id: 'liked-post-1',
      caption: 'Amazing sunset from vacation',
      url: 'https://example.com/sunset.jpg',
      file_type: 'image/jpeg',
      file_name: 'sunset.jpg',
      likes_count: 42,
      comment_count: 3,
      is_liked: true,
      owner: { id: 'photographer-id', name: 'Photographer' }
    };

    render(
      <ProfilePage
        {...defaultProps}
        viewedUser={{ id: 'my-id', name: 'My Name' }}
        currentUserId="my-id"
        profileTab="liked"
        likedPosts={[likedPost]}
      />
    );

    expect(screen.getByRole('button', { name: 'Liked' })).toBeInTheDocument();
    expect(screen.getByText('Amazing sunset from vacation')).toBeInTheDocument();
  });

  it('does NOT render Liked tab or allow opening follow modals on someone else profile', () => {
    const handleViewFollowsMock = vi.fn();
    render(
      <ProfilePage
        {...defaultProps}
        viewedUser={otherUser}
        currentUserId="my-id"
        email="me@example.com"
        handleViewFollows={handleViewFollowsMock}
      />
    );

    // Liked tab should not exist on someone else's profile
    expect(screen.queryByRole('button', { name: 'Liked' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Saved' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Posts' })).not.toBeInTheDocument();

    // Clicking followers or following should not open modal
    const followersStat = screen.getByText(/followers/i);
    fireEvent.click(followersStat);
    expect(handleViewFollowsMock).not.toHaveBeenCalled();

    const followingStat = screen.getByText(/following/i);
    fireEvent.click(followingStat);
    expect(handleViewFollowsMock).not.toHaveBeenCalled();
  });
});

