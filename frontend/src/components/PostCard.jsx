import UserBadge from './UserBadge';
import { isCurrentUser } from '../utils/user';

const PostCard = ({
  post,
  email,
  currentUserId,
  loadedComments,
  showComments,
  commentInputs,
  setCommentInputs,
  handleDeletePost,
  handleLikeToggle,
  handleViewLikers,
  handleSaveToggle,
  handleToggleComments,
  handleDeleteComment,
  handleCommentSubmit,
  navigateToProfile,
  handleFollowToggle,
  onAnalyzePost
}) => {
  const actualCommentCount = loadedComments[post.id] 
    ? loadedComments[post.id].length 
    : Number(post.comment_count ?? post.comments_count ?? 0);

  const isOwner = isCurrentUser(post.owner || post.user_id, currentUserId, email);

  return (
    <div className="post-card">
       <div className="post-header post-header-row">
        <UserBadge 
          userObj={post.owner} 
          email={email} 
          currentUserId={currentUserId}
          showFollowButton={!isOwner}
          navigateToProfile={navigateToProfile} 
          handleFollowToggle={handleFollowToggle} 
        />
        
        {isOwner && (
          <button onClick={() => handleDeletePost(post.id)} className="delete-post-btn" title="Delete Post">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        )}
      </div>

      <div className="post-image-container">
        {post.url && (
          post.url.match(/\.(mp4|webm|ogg|mov)$/i) || post.file_type?.startsWith('video/') ? (
            <video 
              src={post.url} controls preload="auto" className="post-media-video" 
              style={{ width: '100%', minHeight: '300px', backgroundColor: '#000' }} 
            />
          ) : (
            <img src={post.url} alt={post.file_name || "Post media"} className="post-image" style={{ width: '100%' }} />
          )
        )}
      </div>

      <div className="post-body">
        <div className="post-actions-row" style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <button onClick={() => handleLikeToggle(post.id)} className="like-btn">
              {post.is_liked ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#ed4956" stroke="#ed4956" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                </svg>
              )}
            </button>
            <span 
              className={`like-count ${post.likes_count > 0 ? 'clickable-likes' : ''}`}
              onClick={() => { if (post.likes_count > 0) handleViewLikers(post.id); }}
            >
              {post.likes_count || 0} {post.likes_count === 1 ? 'like' : 'likes'}
            </span>
            <span className="comments-count"> 
              {actualCommentCount} comments
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {onAnalyzePost && (
              <button
                onClick={() => onAnalyzePost(post)}
                className="ai-analyze-btn"
                title="Analyze & Verify with AI Studio"
                aria-label="Analyze & Verify with AI Studio"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
                </svg>
                <span>Verify</span>
              </button>
            )}

            <button onClick={() => handleSaveToggle(post.id)} className="save-btn">
              {post.is_saved ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
                </svg>
              )}
            </button>
          </div>
        </div>

        <div className="post-caption" style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <UserBadge 
            userObj={post.owner} 
            email={email} 
            currentUserId={currentUserId}
            showFollowButton={false}
            navigateToProfile={navigateToProfile} 
            handleFollowToggle={handleFollowToggle} 
          />
          <span>{post.caption}</span>
        </div>

        {post.comment_count > 0 && (
          <button onClick={() => handleToggleComments(post.id)} className="view-comments-btn">
            {showComments[post.id] ? 'Hide comments' : `View all ${post.comment_count} comments`}
          </button>
        )}

        {showComments[post.id] && loadedComments[post.id] && (
          <div className="comments-list">
            {loadedComments[post.id].map(comment => {
              const isCommentAuthor = isCurrentUser(comment.author || comment.user_id, currentUserId, email);
              const isPostOwner = isOwner;
              const canDelete = isCommentAuthor || isPostOwner;

              return (
                <div key={comment.id} className="comment-item" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                    <UserBadge 
                      userObj={comment.author} 
                      email={email} 
                      currentUserId={currentUserId}
                      showFollowButton={false} 
                      navigateToProfile={navigateToProfile} 
                      handleFollowToggle={handleFollowToggle} 
                    />
                    <span>{comment.text}</span>
                  </div>
                  {canDelete && (
                    <button onClick={() => handleDeleteComment(post.id, comment.id)} className="delete-comment-btn">Delete</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <form onSubmit={(e) => handleCommentSubmit(e, post.id)} className="comment-form">
          <input 
            type="text" placeholder="Add a comment..."
            value={commentInputs[post.id] || ''}
            onChange={(e) => setCommentInputs({ ...commentInputs, [post.id]: e.target.value })}
            className="comment-input"
          />
          <button type="submit" className="comment-submit-btn">Post</button>
        </form>
      </div>
    </div>
  );
};

export default PostCard;