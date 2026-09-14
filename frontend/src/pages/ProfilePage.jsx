import React from 'react';
import PostCard from '../components/PostCard';

const ProfilePage = ({
  viewedUser, email, navigateToFeed, handleFollowToggle,
  setEditBio, setShowEditProfileModal, userPosts, handleViewFollows,
  profileTab, setProfileTab, fetchSavedPosts, savedPosts, likedPosts,
  
  // PostCard Props
  loadedComments, showComments, commentInputs, setCommentInputs,
  handleDeletePost, handleLikeToggle, handleViewLikers, handleSaveToggle,
  handleToggleComments, handleDeleteComment, handleCommentSubmit, navigateToProfile
}) => {
  // Helper to render the shared PostCard with all necessary props
  const renderProfilePost = (post) => (
    <PostCard 
      key={post.id} post={post} email={email}
      loadedComments={loadedComments} showComments={showComments}
      commentInputs={commentInputs} setCommentInputs={setCommentInputs}
      handleDeletePost={handleDeletePost} handleLikeToggle={handleLikeToggle}
      handleViewLikers={handleViewLikers} handleSaveToggle={handleSaveToggle}
      handleToggleComments={handleToggleComments} handleDeleteComment={handleDeleteComment}
      handleCommentSubmit={handleCommentSubmit} navigateToProfile={navigateToProfile}
      handleFollowToggle={handleFollowToggle}
    />
  );

  return (
    <div className="feed-content-wrapper">
      <div className="profile-header">
        <button onClick={navigateToFeed} className="back-nav-btn">← Back to Feed</button>

        <div className="profile-avatar-wrapper">
          {viewedUser.profile_picture_url ? (
            <img src={`http://localhost:8000${viewedUser.profile_picture_url}`} alt="Profile" className="profile-avatar-img" />
          ) : (
            <div className="profile-avatar-placeholder">{viewedUser.email[0].toUpperCase()}</div>
          )}
        </div>

        <div className="profile-title-row">
          <h2 className="profile-username">{viewedUser.email}</h2>
          {viewedUser.email !== email ? (
            <button 
              onClick={() => handleFollowToggle(viewedUser.id)}
              className={`auth-button profile-action-btn ${viewedUser.is_following ? 'unfollow-active' : ''}`}
            >
              {viewedUser.is_following ? 'Unfollow' : 'Follow'}
            </button>
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
          <div className={`stat-box ${viewedUser.email === email ? 'clickable-stat' : ''}`} onClick={() => viewedUser.email === email && handleViewFollows('followers')}>
            <span className="stat-number">{viewedUser.followers_count || 0}</span> followers
          </div>
          <div className={`stat-box ${viewedUser.email === email ? 'clickable-stat' : ''}`} onClick={() => viewedUser.email === email && handleViewFollows('following')}>
            <span className="stat-number">{viewedUser.following_count || 0}</span> following
          </div>
        </div>
      </div>

      {viewedUser.email === email && (
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