import PostCard from '../components/PostCard';
import ProfileAvatar from '../components/ProfileAvatar';
import UserName from '../components/UserName';
import { isCurrentUser } from '../utils/user';

const ProfilePage = ({
  viewedUser, email, currentUserId, navigateToFeed, handleFollowToggle,
  setEditBio, setShowEditProfileModal, userPosts, handleViewFollows,
  profileTab, setProfileTab, fetchSavedPosts, savedPosts, likedPosts,
  
  // PostCard Props
  loadedComments, showComments, commentInputs, setCommentInputs,
  handleDeletePost, handleLikeToggle, handleViewLikers, handleSaveToggle,
  handleToggleComments, handleDeleteComment, handleCommentLikeToggle, handleCommentSubmit, navigateToProfile,
  onStartChat
}) => {
  const isOwnProfile = isCurrentUser(viewedUser, currentUserId, email);

  // Helper to render the shared PostCard with all necessary props
  const renderProfilePost = (post) => (
    <PostCard 
      key={post.id} post={post} email={email} currentUserId={currentUserId}
      loadedComments={loadedComments} showComments={showComments}
      commentInputs={commentInputs} setCommentInputs={setCommentInputs}
      handleDeletePost={handleDeletePost} handleLikeToggle={handleLikeToggle}
      handleViewLikers={handleViewLikers} handleSaveToggle={handleSaveToggle}
      handleToggleComments={handleToggleComments} handleDeleteComment={handleDeleteComment}
      handleCommentLikeToggle={handleCommentLikeToggle}
      handleCommentSubmit={handleCommentSubmit} navigateToProfile={navigateToProfile}
      handleFollowToggle={handleFollowToggle}
    />
  );

  return (
    <div className="feed-content-wrapper">
      <div className="profile-header">
        <button onClick={navigateToFeed} className="back-nav-btn">← Back to Feed</button>

        <div className="profile-avatar-wrapper">
          <ProfileAvatar profilePictureUrl={viewedUser.profile_picture_url} />
        </div>

        <div className="profile-title-row">
          <h2 className="profile-username"><UserName user={viewedUser} /></h2>
          {!isOwnProfile ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button 
                onClick={() => handleFollowToggle(viewedUser.id)}
                className={`auth-button profile-action-btn ${viewedUser.is_following ? 'unfollow-active' : ''}`}
              >
                {viewedUser.is_following ? 'Unfollow' : 'Follow'}
              </button>
              {onStartChat && (
                <button
                  type="button"
                  onClick={() => onStartChat(viewedUser)}
                  className="auth-button profile-action-btn"
                  style={{ background: '#efefef', color: '#262626', border: '1px solid #dbdbdb' }}
                  title={`Message ${viewedUser.name || 'User'}`}
                >
                  Message
                </button>
              )}
            </div>
          ) : (
            <button 
              className="auth-button profile-action-btn"
              onClick={() => { setEditBio(viewedUser.bio || ''); setShowEditProfileModal(true); }}
            >
              Edit Profile
            </button>
          )}
        </div>

        {viewedUser.bio && (
          <div className="profile-bio-container"><p>{viewedUser.bio}</p></div>
        )}
        
        <div className="profile-stats">
          <div className="stat-box"><span className="stat-number">{userPosts.length}</span> posts</div>
          <div className={`stat-box ${isOwnProfile ? 'clickable-stat' : ''}`} onClick={() => isOwnProfile && handleViewFollows('followers')}>
            <span className="stat-number">{viewedUser.followers_count || 0}</span> followers
          </div>
          <div className={`stat-box ${isOwnProfile ? 'clickable-stat' : ''}`} onClick={() => isOwnProfile && handleViewFollows('following')}>
            <span className="stat-number">{viewedUser.following_count || 0}</span> following
          </div>
        </div>
      </div>

      {isOwnProfile && (
        <div className="profile-tabs-container">
          <button className={`profile-tab ${profileTab === 'posts' ? 'active' : ''}`} onClick={() => setProfileTab('posts')}>Posts</button>
          <button className={`profile-tab ${profileTab === 'saved' ? 'active' : ''}`} onClick={() => { setProfileTab('saved'); fetchSavedPosts(); }}>Saved</button>
          <button className={`profile-tab ${profileTab === 'liked' ? 'active' : ''}`} onClick={() => setProfileTab('liked')}>Liked</button>
        </div>
      )}

      <div className="profile-posts-grid">
        {profileTab === 'posts' && (
          userPosts.length > 0 ? userPosts.map(renderProfilePost) : <p className="status-text">No posts yet.</p>
        )}
        {profileTab === 'saved' && (
          savedPosts.length > 0 ? savedPosts.map(renderProfilePost) : <p className="status-text">No saved posts.</p>
        )}
        {profileTab === 'liked' && (
          likedPosts.length > 0 ? likedPosts.map(renderProfilePost) : <p className="status-text">No liked posts yet.</p>
        )}
      </div>
    </div>
  );
};

export default ProfilePage;