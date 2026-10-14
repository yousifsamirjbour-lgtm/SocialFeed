import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PostCard from '../PostCard';

describe('PostCard Component', () => {
  const basePost = {
    id: 'post-123',
    caption: 'Test post caption',
    url: 'https://example.com/test.jpg',
    file_type: 'image/jpeg',
    file_name: 'test.jpg',
    likes_count: 5,
    comment_count: 2,
    is_liked: false,
    is_saved: false,
    owner: {
      id: 'user-1',
      name: 'Post Owner',
      is_following: false
    }
  };

  const defaultProps = {
    post: basePost,
    email: 'viewer@example.com',
    currentUserId: 'viewer-id',
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
    navigateToProfile: vi.fn(),
    handleFollowToggle: vi.fn()
  };

  it('renders image post correctly with caption, like count, and author name', () => {
    render(<PostCard {...defaultProps} />);

    expect(screen.getByText('Test post caption')).toBeInTheDocument();
    expect(screen.getByText('5 likes')).toBeInTheDocument();
    expect(screen.getByText('2 comments')).toBeInTheDocument();

    // Verify display name appears, and email never appears
    expect(screen.getAllByText('Post Owner')).toHaveLength(2);
    expect(screen.queryByText('owner@example.com')).not.toBeInTheDocument();

    const img = screen.getByRole('img', { name: /test.jpg/i });
    expect(img).toHaveAttribute('src', basePost.url);
  });

  it('renders video element when file_type is video', () => {
    const videoPost = {
      ...basePost,
      url: 'https://example.com/test.mp4',
      file_type: 'video/mp4'
    };
    render(<PostCard {...defaultProps} post={videoPost} />);

    const video = document.querySelector('video');
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute('src', videoPost.url);
  });

  it('calls handleLikeToggle when like button is clicked', () => {
    render(<PostCard {...defaultProps} />);
    const likeBtn = screen.getByText('5 likes').closest('.post-actions-row').querySelector('.like-btn');
    fireEvent.click(likeBtn);
    expect(defaultProps.handleLikeToggle).toHaveBeenCalledWith('post-123');
  });

  it('calls handleViewLikers when clicking likes count', () => {
    render(<PostCard {...defaultProps} />);
    const likeCountSpan = screen.getByText('5 likes');
    fireEvent.click(likeCountSpan);
    expect(defaultProps.handleViewLikers).toHaveBeenCalledWith('post-123');
  });

  it('calls handleSaveToggle when save button is clicked', () => {
    render(<PostCard {...defaultProps} />);
    const saveBtn = document.querySelector('.save-btn');
    fireEvent.click(saveBtn);
    expect(defaultProps.handleSaveToggle).toHaveBeenCalledWith('post-123');
  });

  it('shows delete button only when current user is the owner', () => {
    // When viewer is NOT owner
    const { rerender } = render(<PostCard {...defaultProps} currentUserId="other-user" email="viewer@example.com" />);
    expect(screen.queryByTitle('Delete Post')).not.toBeInTheDocument();

    // When viewer IS owner
    rerender(<PostCard {...defaultProps} currentUserId="user-1" email="owner@example.com" />);
    const deleteBtn = screen.getByTitle('Delete Post');
    expect(deleteBtn).toBeInTheDocument();
    fireEvent.click(deleteBtn);
    expect(defaultProps.handleDeletePost).toHaveBeenCalledWith('post-123');
  });

  it('never shows follow button next to caption, and never shows follow button for own post', () => {
    // When viewing own post
    const { rerender } = render(<PostCard {...defaultProps} currentUserId="user-1" />);
    // Entire component should have 0 follow buttons
    expect(screen.queryByRole('button', { name: /follow/i })).not.toBeInTheDocument();

    // When viewing someone else's post
    rerender(<PostCard {...defaultProps} currentUserId="viewer-id" />);
    // Follow button should exist in the header, but NOT in the caption
    const followButtons = screen.getAllByRole('button', { name: /follow/i });
    expect(followButtons).toHaveLength(1);
    // Header contains the follow button
    expect(document.querySelector('.post-header').querySelector('.inline-follow-btn')).toBeInTheDocument();
    // Caption never contains a follow button
    expect(document.querySelector('.post-caption').querySelector('.inline-follow-btn')).toBeNull();
  });

  it('allows delete comment only for comment author or post owner', () => {
    const postWithComments = {
      ...basePost,
      comment_count: 2,
      owner: { id: 'post-owner-id', name: 'Post Owner' }
    };

    const loadedComments = {
      'post-123': [
        { id: 'c1', text: 'Comment by Author 1', author: { id: 'author-1-id', name: 'Author One' } },
        { id: 'c2', text: 'Comment by Author 2', author: { id: 'author-2-id', name: 'Author Two' } }
      ]
    };

    const showComments = { 'post-123': true };

    // Viewer is Author 1: can delete c1, but cannot delete c2
    const { rerender } = render(
      <PostCard
        {...defaultProps}
        post={postWithComments}
        currentUserId="author-1-id"
        loadedComments={loadedComments}
        showComments={showComments}
      />
    );

    const deleteButtonsAuthor1 = screen.getAllByRole('button', { name: 'Delete' });
    // Only 1 comment delete button (no post delete button since viewer is not post owner)
    expect(deleteButtonsAuthor1).toHaveLength(1);

    // Viewer is Post Owner: can delete both comments plus post
    rerender(
      <PostCard
        {...defaultProps}
        post={postWithComments}
        currentUserId="post-owner-id"
        loadedComments={loadedComments}
        showComments={showComments}
      />
    );
    const deleteButtonsOwner = screen.getAllByRole('button', { name: 'Delete' });
    expect(deleteButtonsOwner).toHaveLength(2); // Both comments

    // Viewer is random 3rd party: cannot delete any comments
    rerender(
      <PostCard
        {...defaultProps}
        post={postWithComments}
        currentUserId="random-user-id"
        loadedComments={loadedComments}
        showComments={showComments}
      />
    );
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('renders upgraded Verify micro-pill button and triggers onAnalyzePost on click', () => {
    const onAnalyzePost = vi.fn();
    render(<PostCard {...defaultProps} onAnalyzePost={onAnalyzePost} />);

    const verifyBtn = screen.getByRole('button', { name: /Analyze & Verify with AI Studio/i });
    expect(verifyBtn).toBeInTheDocument();
    expect(verifyBtn).toHaveClass('ai-analyze-btn');
    expect(screen.getByText('Verify')).toBeInTheDocument();

    fireEvent.click(verifyBtn);
    expect(onAnalyzePost).toHaveBeenCalledTimes(1);
    expect(onAnalyzePost).toHaveBeenCalledWith(basePost);
  });
});


