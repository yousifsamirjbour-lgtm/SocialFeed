import Cropper from 'react-easy-crop';
import PostCard from '../components/PostCard';

const FeedPage = ({
  // Feed Data & Toggles
  feed, feedMode, handleFeedModeChange,
  
  // Upload State & Handlers
  handleUpload, caption, setCaption, postVideoSrc, setPostVideoSrc,
  postImageSrc, setPostImageSrc, setSelectedFile,
  postCrop, setPostCrop, postZoom, setPostZoom, postAspect, setPostAspect,
  onPostCropComplete, onPostFileChange, fileKey, uploading, setUploading,
  
  // PostCard Props
  email, currentUserId, loadedComments, showComments, commentInputs, setCommentInputs,
  handleDeletePost, handleLikeToggle, handleViewLikers, handleSaveToggle,
  handleToggleComments, handleDeleteComment, handleCommentSubmit,
  navigateToProfile, handleFollowToggle,
  navigateToAiStudio, onAnalyzePost
}) => {
  return (
    <div className="feed-content-wrapper">
      {/* AI STUDIO PROMPT BANNER */}
      {navigateToAiStudio && (
        <div 
          className="ai-studio-prompt-banner" 
          onClick={() => navigateToAiStudio()} 
          role="button" 
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigateToAiStudio(); }}
          style={{ cursor: 'pointer' }}
        >
          <div className="ai-studio-prompt-content">
            <span className="ai-studio-sparkle">✨</span>
            <div>
              <div className="ai-studio-prompt-title">AI Studio: Fact-Check & Research</div>
              <div className="ai-studio-prompt-sub">Analyze discussions, verify facts with live web search, and turn them into verified posts.</div>
            </div>
          </div>
          <button type="button" className="ai-studio-prompt-btn" onClick={(e) => { e.stopPropagation(); navigateToAiStudio(); }}>Open Studio</button>
        </div>
      )}

      {/* UPLOAD CARD */}
      <div className="upload-card" style={{ maxWidth: '550px', width: '100%', margin: '0 auto 20px', padding: '20px', border: '1px solid #dbdbdb', borderRadius: '8px', backgroundColor: 'white' }}>
        <h3 className="upload-title" style={{ marginTop: 0, marginBottom: '15px' }}>Create Post</h3>
        <form onSubmit={handleUpload}>
          <textarea 
            value={caption} 
            onChange={(e) => setCaption(e.target.value)} 
            placeholder="Write a caption..."  
            className="caption-textarea"
            rows="3"
          />

          <div className="form-group" style={{ margin: 0 }}>
            {postVideoSrc ? (
              <>
                <div className="crop-container" style={{ margin: '0 auto', height: '280px', display: 'flex', justifyContent: 'center', background: '#000', borderRadius: '4px' }}>
                  <video src={postVideoSrc} controls style={{ height: '100%', maxWidth: '100%' }} />
                </div>
                <div className="slider-container" style={{ marginTop: '8px', textAlign: 'center' }}>
                  <button type="button" className="text-btn" style={{ fontSize: '11px', marginTop: '4px' }} onClick={() => { setPostVideoSrc(null); setSelectedFile(null); }}>
                    Choose a different file
                  </button>
                </div>
              </>
            ) : postImageSrc ? (
              <>
                <div className="crop-container" style={{ margin: '0 auto', height: '280px' }}>
                  <Cropper
                    image={postImageSrc}
                    crop={postCrop}
                    zoom={postZoom}
                    aspect={postAspect}
                    onMediaLoaded={(mediaSize) => setPostAspect(mediaSize.width / mediaSize.height)}
                    showGrid={true}
                    onCropChange={setPostCrop}
                    onZoomChange={setPostZoom}
                    onCropComplete={onPostCropComplete}
                  />
                </div>
                <div className="slider-container" style={{ marginTop: '8px' }}>
                  <label style={{ fontSize: '11px' }}>Zoom</label>
                  <input type="range" value={postZoom} min={1} max={3} step={0.1} onChange={(e) => setPostZoom(Number(e.target.value))} />
                  <button type="button" className="text-btn" style={{ fontSize: '11px', marginTop: '4px' }} onClick={() => { setPostImageSrc(null); setSelectedFile(null); }}>
                    Choose a different image
                  </button>
                </div>
              </>
            ) : (
              <div className="post-upload-section" style={{ margin: '15px 0' }}>
                <input key={fileKey} type="file" id="create-post-upload" accept="image/*,video/*" onChange={onPostFileChange} required style={{ display: 'none' }} />
                <label htmlFor="create-post-upload" className="custom-upload-btn" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #dbdbdb', display: 'block', textAlign: 'center', padding: '10px', cursor: 'pointer' }}>
                  📸 Choose an image or video
                </label>
              </div>
            )}
          </div>

          <div className="post-actions-container">
            <button type="button" className="cancel-btn" onClick={() => { setPostImageSrc(null); setPostVideoSrc(null); setSelectedFile(null); setCaption(''); setUploading(false); }}>
              Cancel
            </button>
            <button type="submit" disabled={uploading} className="modal-save-btn" style={{ opacity: uploading ? 0.7 : 1 }}>
              {uploading ? 'Sharing...' : 'Share'}
            </button>
          </div>
        </form>
      </div>

      {/* FEED TOGGLE */}
      <div className="feed-toggle-container">
        <button className={`feed-toggle-btn ${feedMode === 'global' ? 'active' : ''}`} onClick={() => handleFeedModeChange('global')}>
          For You
        </button>
        <button className={`feed-toggle-btn ${feedMode === 'following' ? 'active' : ''}`} onClick={() => handleFeedModeChange('following')}>
          Following
        </button>
      </div>
      
      {/* POSTS LIST */}
      <div className="feed-container">
        {feed.map(post => (
          <PostCard 
            key={post.id}
            post={post}
            email={email}
            currentUserId={currentUserId}
            loadedComments={loadedComments}
            showComments={showComments}
            commentInputs={commentInputs}
            setCommentInputs={setCommentInputs}
            handleDeletePost={handleDeletePost}
            handleLikeToggle={handleLikeToggle}
            handleViewLikers={handleViewLikers}
            handleSaveToggle={handleSaveToggle}
            handleToggleComments={handleToggleComments}
            handleDeleteComment={handleDeleteComment}
            handleCommentSubmit={handleCommentSubmit}
            navigateToProfile={navigateToProfile}
            handleFollowToggle={handleFollowToggle}
            onAnalyzePost={onAnalyzePost}
          />
        ))}
      </div>
    </div>
  );
};

export default FeedPage;