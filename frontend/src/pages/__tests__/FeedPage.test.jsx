import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FeedPage from '../FeedPage';

describe('FeedPage', () => {
  const samplePosts = [
    {
      id: 'p1',
      caption: 'First feed post',
      url: 'https://example.com/p1.jpg',
      file_type: 'image/jpeg',
      file_name: 'p1.jpg',
      likes_count: 3,
      comment_count: 1,
      is_liked: false,
      is_saved: false,
      owner: { id: 'u1', email: 'u1@example.com', is_following: false }
    }
  ];

  const defaultProps = {
    feed: samplePosts,
    feedMode: 'global',
    handleFeedModeChange: vi.fn(),
    handleUpload: vi.fn((e) => e.preventDefault()),
    caption: '',
    setCaption: vi.fn(),
    postVideoSrc: null,
    setPostVideoSrc: vi.fn(),
    postImageSrc: null,
    setPostImageSrc: vi.fn(),
    selectedFile: null,
    setSelectedFile: vi.fn(),
    postCrop: { x: 0, y: 0 },
    setPostCrop: vi.fn(),
    postZoom: 1,
    setPostZoom: vi.fn(),
    postAspect: 1,
    setPostAspect: vi.fn(),
    onPostCropComplete: vi.fn(),
    onPostFileChange: vi.fn(),
    fileKey: 12345,
    uploading: false,
    setUploading: vi.fn(),
    email: 'user@example.com',
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

  it('renders create post form and feed mode toggles', () => {
    render(<FeedPage {...defaultProps} />);

    expect(screen.getByText('Create Post')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Write a caption...')).toBeInTheDocument();
    expect(screen.getByText('For You')).toBeInTheDocument();
    expect(screen.getByText('Following')).toBeInTheDocument();
    expect(screen.getByText('First feed post')).toBeInTheDocument();
  });

  it('triggers handleFeedModeChange when switching tabs', () => {
    render(<FeedPage {...defaultProps} />);

    fireEvent.click(screen.getByText('Following'));
    expect(defaultProps.handleFeedModeChange).toHaveBeenCalledWith('following');

    fireEvent.click(screen.getByText('For You'));
    expect(defaultProps.handleFeedModeChange).toHaveBeenCalledWith('global');
  });

  it('displays loading state when uploading is true', () => {
    render(<FeedPage {...defaultProps} uploading={true} />);

    const shareBtn = screen.getByRole('button', { name: 'Sharing...' });
    expect(shareBtn).toBeInTheDocument();
    expect(shareBtn).toBeDisabled();
  });

  it('renders empty feed container when feed is empty', () => {
    render(<FeedPage {...defaultProps} feed={[]} />);

    expect(screen.queryByText('First feed post')).not.toBeInTheDocument();
    expect(document.querySelector('.feed-container')).toBeInTheDocument();
  });

  it('renders modern AI Studio entry banner and navigates when clicked', () => {
    const navigateToAiStudio = vi.fn();
    render(<FeedPage {...defaultProps} navigateToAiStudio={navigateToAiStudio} />);

    expect(screen.getByText('AI Studio: Fact-Check & Research')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText(/Analyze discussions, verify facts with live web search/i)).toBeInTheDocument();

    const openBtn = screen.getByRole('button', { name: /Open Studio/i });
    expect(openBtn).toBeInTheDocument();

    fireEvent.click(openBtn);
    expect(navigateToAiStudio).toHaveBeenCalledTimes(1);

    // Also clicking the banner card itself triggers navigation
    const banner = screen.getByLabelText('Open AI Studio Banner');
    fireEvent.click(banner);
    expect(navigateToAiStudio).toHaveBeenCalledTimes(2);
  });
});

