import { useState, useEffect } from 'react';
import './styles/App.css';

// Import Pages
import AuthPage from './pages/AuthPage';
import FeedPage from './pages/FeedPage';
import ProfilePage from './pages/ProfilePage';
import SearchPage from './pages/SearchPage';
import SearchAgentPage from './pages/SearchAgentPage';

// Import Components
import Navbar from './components/Navbar';
import LikersModal from './components/LikersModal';
import FollowModal from './components/FollowModal';
import EditProfileModal from './components/EditProfileModal';

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [email, setEmail] = useState(localStorage.getItem('email') || '');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [feed, setFeed] = useState([]);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [fileKey, setFileKey] = useState(Date.now());
  const [commentInputs, setCommentInputs] = useState({});
  const [loadedComments, setLoadedComments] = useState({});
  const [showComments, setShowComments] = useState({});
  const [currentView, setCurrentView] = useState('feed'); 
  const [viewedUser, setViewedUser] = useState(null);
  const [userPosts, setUserPosts] = useState([]);
  const [feedMode, setFeedMode] = useState('global');
  const [showLikersModal, setShowLikersModal] = useState(false);
  const [currentLikers, setCurrentLikers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [editBio, setEditBio] = useState('');
  const [editFile, setEditFile] = useState(null);
  const [imageSrc, setImageSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [showCropModal, setShowCropModal] = useState(false); 
  const [postImageSrc, setPostImageSrc] = useState(null);
  const [postCrop, setPostCrop] = useState({ x: 0, y: 0 });
  const [postZoom, setPostZoom] = useState(1);
  const [postCroppedAreaPixels, setPostCroppedAreaPixels] = useState(null);
  const [postAspect, setPostAspect] = useState(1);
  const [showFollowModal, setShowFollowModal] = useState(false);
  const [followModalType, setFollowModalType] = useState('followers');
  const [followList, setFollowList] = useState([]);
  const [profileTab, setProfileTab] = useState('posts');
  const [savedPosts, setSavedPosts] = useState([]);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [likedPosts, setLikedPosts] = useState([]);
  const [loadingLiked, setLoadingLiked] = useState(false);
  const [postVideoSrc, setPostVideoSrc] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);

  const fetchFeed = async (requestedMode) => {
    try {
      const activeMode = typeof requestedMode === 'string' ? requestedMode : feedMode;
      const isFollowingOnly = activeMode === 'following';
      const response = await fetch(`https://socialfeed.duckdns.org/api/feed?following_only=${isFollowingOnly}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.status === 401) {
        handleLogout();
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch feed');
      const data = await response.json();
      setFeed(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const fetchProfile = async (userId) => {
    try {
      const response = await fetch(`https://socialfeed.duckdns.org/api/users/${userId}/profile`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.status === 401) {
        handleLogout();
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch profile');
      const profileData = await response.json();
      setViewedUser(profileData);
      setUserPosts(Array.isArray(profileData.posts) ? profileData.posts : []);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const delayDebounceFn = setTimeout(async () => {
      try {
        const response = await fetch(`https://socialfeed.duckdns.org/api/users/search?q=${searchQuery}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Search failed');
        const data = await response.json();
        setSearchResults(data);
      } catch (err) {
        console.error(err);
      }
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, token]);

  const navigateToMyProfile = async () => {
    try {
      const response = await fetch(`https://socialfeed.duckdns.org/api/users/search?q=${email}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      const me = data.find(user => user.email === email);
      if (me) {
        navigateToProfile(me.id);
      }
    } catch (err) {
      console.error("Failed to load own profile:", err);
    }
  };

  const navigateToProfile = (userId) => {
    setError('');
    setCurrentView('profile');
    setProfileTab('posts'); 
    fetchProfile(userId);
    setShowLikersModal(false);
    setShowFollowModal(false); 
  };

  const navigateToFeed = () => {
    setError('');
    setCurrentView('feed');
    setViewedUser(null);
    setUserPosts([]);
    fetchFeed();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    if (currentView === 'feed') {
      fetchFeed();
    }
  }, [token, currentView]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('email');
    setToken('');
    setEmail(''); 
    setFeed([]);
    setCurrentView('feed');
  };

  useEffect(() => {
    if (profileTab === 'liked' && viewedUser?.email === email && likedPosts.length === 0) {
      const fetchLikedPosts = async () => {
        setLoadingLiked(true);
        try {
          const response = await fetch('https://socialfeed.duckdns.org/api/users/me/liked-posts', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (response.ok) {
            const data = await response.json();
            setLikedPosts(data);
          }
        } catch (error) {
          console.error("Error fetching liked posts:", error);
        } finally {
          setLoadingLiked(false);
        }
      };
      fetchLikedPosts();
    }
  }, [profileTab, email, viewedUser, token]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    const formData = new URLSearchParams();
    formData.append('username', email);
    formData.append('password', password);
    try {
      const response = await fetch('https://socialfeed.duckdns.org/api/auth/jwt/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData
      });
      if (!response.ok) throw new Error('Invalid credentials');
      const data = await response.json();
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('email', email);
      setToken(data.access_token);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const response = await fetch('https://socialfeed.duckdns.org/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Registration failed');
      }
      setSuccessMessage('Registration successful! Please log in.');
      setIsRegistering(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!postImageSrc && !postVideoSrc) {
      setError('Please select an image or a video file first.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      let finalFile = null;
      if (postImageSrc && postCroppedAreaPixels) {
        finalFile = await getCroppedImg(postImageSrc, postCroppedAreaPixels);
        if (!finalFile) throw new Error('Could not process the cropped image.');
      } else if (postVideoSrc && selectedFile) {
        finalFile = selectedFile;
      }
      if (!finalFile) throw new Error('No valid file found for upload.');
      
      const uploadData = new FormData();
      uploadData.append('caption', caption || '');
      uploadData.append('file', finalFile);
      const response = await fetch('https://socialfeed.duckdns.org/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: uploadData
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || 'Upload failed');
      }
      setCaption('');
      setSelectedFile(null);
      setPostImageSrc(null); 
      setPostVideoSrc(null);
      setFileKey(Date.now()); 
      if (currentView === 'feed') fetchFeed();
      if (currentView === 'profile' && viewedUser) fetchProfile(viewedUser.id);
    } catch (err) {
      console.error("Upload error:", err);
      setError(err.message || 'An error occurred during upload.');
    } finally {
      setUploading(false);
    }
  };

  const handleFeedModeChange = (mode) => {
    setFeedMode(mode);
    fetchFeed(mode);
  };

  const handleLikeToggle = async (postId) => {
    try {
      const updatePostState = (prevPosts) => {
        if (!prevPosts) return []; 
        return prevPosts.map(post => {
          if (String(post.id) === String(postId)) {
            const wasLiked = post.is_liked;
            const currentLikes = Number(post.likes_count ?? post.like_count ?? 0);
            const newLikes = wasLiked ? Math.max(0, currentLikes - 1) : currentLikes + 1;
            return {
              ...post,
              is_liked: !wasLiked,
              likes_count: newLikes, 
              like_count: newLikes   
            };
          }
          return post;
        });
      };
      if (typeof setFeed === 'function') setFeed(updatePostState);
      if (typeof setUserPosts === 'function') setUserPosts(updatePostState);
      if (typeof setSavedPosts === 'function') setSavedPosts(updatePostState);
      if (typeof setLikedPosts === 'function') {
        setLikedPosts((prevPosts) => {
          const updatedPosts = updatePostState(prevPosts);
          return updatedPosts.filter(post => post.is_liked === true);
        });
      }
      const response = await fetch(`https://socialfeed.duckdns.org/api/posts/${postId}/like`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to toggle like');
    } catch (err) {
      console.error("Like toggle failed:", err);
    }
  };

  const handleFollowToggle = async (targetUserId) => {
    try {
      const response = await fetch(`https://socialfeed.duckdns.org/api/users/${targetUserId}/follow`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to toggle follow');
      
      const updateUserList = (prevList) => {
        if (!prevList) return [];
        return prevList.map(user => {
          if (String(user.id) === String(targetUserId)) {
            return { ...user, is_following: !user.is_following };
          }
          return user;
        });
      };
      if (typeof setCurrentLikers === 'function') setCurrentLikers(updateUserList);
      if (typeof setSearchResults === 'function') setSearchResults(updateUserList);
      if (typeof setFollowList === 'function') setFollowList(updateUserList);

      const updatePostList = (prevPosts) => {
        if (!prevPosts) return [];
        return prevPosts.map(post => {
          if (post.owner && String(post.owner.id) === String(targetUserId)) {
            return { ...post, owner: { ...post.owner, is_following: !post.owner.is_following } };
          }
          return post;
        });
      };
      if (typeof setFeed === 'function') setFeed(updatePostList);
      if (typeof setUserPosts === 'function') setUserPosts(updatePostList);
      if (typeof setSavedPosts === 'function') setSavedPosts(updatePostList); 
      if (typeof setLikedPosts === 'function') setLikedPosts(updatePostList);

      if (typeof setViewedUser === 'function') {
        setViewedUser(prevProfile => {
          if (!prevProfile || String(prevProfile.id) !== String(targetUserId)) {
            return prevProfile; 
          }
          const wasFollowing = prevProfile.is_following;
          return {
            ...prevProfile,
            is_following: !wasFollowing, 
            followers_count: wasFollowing ? Math.max(0, prevProfile.followers_count - 1) : prevProfile.followers_count + 1
          };
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCommentSubmit = async (e, postId) => {
    e.preventDefault();
    const text = commentInputs[postId];
    if (!text || !text.trim()) return;
    try {
      const response = await fetch(`https://socialfeed.duckdns.org/api/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (!response.ok) throw new Error('Failed to post comment');
      const newComment = await response.json();
      
      setCommentInputs(prev => ({ ...prev, [postId]: '' }));
      setLoadedComments(prev => ({
        ...prev,
        [postId]: [...(prev[postId] || []), newComment]
      }));
      setShowComments(prev => ({ ...prev, [postId]: true })); 

      const incrementCommentCount = (prevPosts) => {
        if (!prevPosts) return [];
        return prevPosts.map(post => {
          if (String(post.id) === String(postId)) {
            const currentCount = Number(post.comment_count ?? post.comments_count ?? 0);
            return { 
              ...post, 
              comment_count: currentCount + 1,
              comments_count: currentCount + 1,
              comments: post.comments ? [...post.comments, newComment] : post.comments
            };
          }
          return post;
        });
      };
      if (typeof setFeed === 'function') setFeed(incrementCommentCount);
      if (typeof setUserPosts === 'function') setUserPosts(incrementCommentCount);
      if (typeof setSavedPosts === 'function') setSavedPosts(incrementCommentCount);
      if (typeof setLikedPosts === 'function') setLikedPosts(incrementCommentCount);
    } catch (err) {
      console.error("Comment submit failed:", err);
    }
  };
  
  const handleToggleComments = async (postId) => {
    if (showComments[postId]) {
      setShowComments(prev => ({ ...prev, [postId]: false }));
      return;
    }
    try {
      const response = await fetch(`https://socialfeed.duckdns.org/api/posts/${postId}/comments`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch comments');
      const data = await response.json();
      setLoadedComments(prev => ({ ...prev, [postId]: data }));
      setShowComments(prev => ({ ...prev, [postId]: true }));
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSavedPosts = async () => {
    try {
      const response = await fetch(`https://socialfeed.duckdns.org/api/users/me/saved`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch saved posts');
      const data = await response.json();
      setSavedPosts(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveToggle = async (postId) => {
    try {
      const updatePostState = (prevPosts) => {
        if (!prevPosts) return [];
        return prevPosts.map(post => {
          if (String(post.id) === String(postId)) {
            return { ...post, is_saved: !post.is_saved };
          }
          return post;
        });
      };
      if (typeof setFeed === 'function') setFeed(updatePostState);
      if (typeof setUserPosts === 'function') setUserPosts(updatePostState);
      if (typeof setLikedPosts === 'function') setLikedPosts(updatePostState);
      if (typeof setSavedPosts === 'function') setSavedPosts(updatePostState);
      const response = await fetch(`https://socialfeed.duckdns.org/api/posts/${postId}/save`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to toggle save');
    } catch (err) {
      console.error("Save toggle failed:", err);
    }
  };    

  const handleDeleteComment = async (postId, commentId) => {
    if (!window.confirm("Delete this comment?")) return;
    try {
      setLoadedComments(prev => ({
        ...prev,
        [postId]: (prev[postId] || []).filter(c => String(c.id) !== String(commentId))
      }));
      const decrementCommentCount = (prevPosts) => {
        if (!prevPosts) return [];
        return prevPosts.map(post => {
          if (String(post.id) === String(postId)) {
            const currentCount = Number(post.comment_count ?? post.comments_count ?? 0);
            return { 
              ...post, 
              comment_count: Math.max(0, currentCount - 1),
              comments_count: Math.max(0, currentCount - 1),
              comments: post.comments 
                ? post.comments.filter(c => String(c.id) !== String(commentId)) 
                : post.comments
            };
          }
          return post;
        });
      };
      if (typeof setFeed === 'function') setFeed(decrementCommentCount);
      if (typeof setUserPosts === 'function') setUserPosts(decrementCommentCount);
      if (typeof setSavedPosts === 'function') setSavedPosts(decrementCommentCount);
      if (typeof setLikedPosts === 'function') setLikedPosts(decrementCommentCount); 
      
      const response = await fetch(`https://socialfeed.duckdns.org/api/comments/${commentId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to delete comment');
    } catch (err) {
      console.error("Delete comment failed:", err);
    }
  };

  const handleViewLikers = async (postId) => {
    try {
      const response = await fetch(`https://socialfeed.duckdns.org/api/posts/${postId}/likes`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch likers');
      const data = await response.json();
      setCurrentLikers(data);
      setShowLikersModal(true);
    } catch (err) {
      console.error(err);
    }
  }; 

  const handleDeletePost = async (postId) => {
    if (!window.confirm("Are you sure you want to delete this post?")) return;
    try {
      const response = await fetch(`https://socialfeed.duckdns.org/api/posts/${postId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to delete post');
      if (currentView === 'profile' && viewedUser) {
        fetchProfile(viewedUser.id);
      } else {
        fetchFeed(feedMode);
      }
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
  };

  const handleEditProfileSubmit = async (e) => {
    e.preventDefault();
    let finalFile = editFile;
    if (imageSrc && croppedAreaPixels) {
      finalFile = await getCroppedImg(imageSrc, croppedAreaPixels);
    }
    const formData = new FormData();
    if (editBio) formData.append('bio', editBio);
    if (finalFile) formData.append('file', finalFile);
    formData.append('remove_photo', removePhoto ? 'true' : 'false');
    try {
      const response = await fetch('https://socialfeed.duckdns.org/api/users/me/profile', {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      if (!response.ok) throw new Error('Failed to update profile');
      const data = await response.json();
      setViewedUser(prev => ({
        ...prev,
        bio: data.bio,
        profile_picture_url: data.profile_picture_url
      }));
      setRemovePhoto(false); 
      setShowEditProfileModal(false);
      setEditFile(null);
      setEditBio('');
      setImageSrc(null); 
    } catch (err) {
      console.error("Profile update failed:", err);
    }
  };

  const handleViewFollows = async (type) => {
    if (viewedUser.email !== email) return;
    try {
      const response = await fetch(`https://socialfeed.duckdns.org/api/users/${viewedUser.id}/${type}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error(`Failed to fetch ${type}`);
      const data = await response.json();
      setFollowList(data);
      setFollowModalType(type);
      setShowFollowModal(true);
    } catch (err) {
      console.error(err);
    }
  };

  const onFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setSelectedFile(file);
      if (file.type.startsWith('video/')) {
        const videoUrl = URL.createObjectURL(file);
        setVideoSrc(videoUrl); 
        setImageSrc(null);    
        setShowVideoModal(true); 
        return;
      }
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        setImageSrc(reader.result);
        setVideoSrc(null); 
        setShowCropModal(true); 
      });
      reader.readAsDataURL(file);
    }
  };

  const onPostFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setSelectedFile(file);
      if (file.type.startsWith('video/')) {
        const videoUrl = URL.createObjectURL(file);
        setPostVideoSrc(videoUrl);
        setPostImageSrc(null);
        return;
      }
      setPostVideoSrc(null);
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        setPostImageSrc(reader.result);
      });
      reader.readAsDataURL(file);
    }
  };

  const onPostCropComplete = (croppedArea, croppedAreaPixels) => {
    setPostCroppedAreaPixels(croppedAreaPixels);
  };

  const getCroppedImg = async (imageSrc, pixelCrop) => {
    const image = new Image();
    image.src = imageSrc;
    await new Promise((resolve) => { image.onload = resolve; });
    const canvas = document.createElement('canvas');
    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(
      image,
      pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
      0, 0, pixelCrop.width, pixelCrop.height
    );
    return new Promise((resolve) => {
      canvas.toBlob((file) => {
        resolve(new File([file], "profile-avatar.jpg", { type: "image/jpeg" }));
      }, 'image/jpeg');
    });
  };

  const onCropComplete = (croppedArea, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels);
  };

  // --- THE NEW CLEAN RENDER BLOCK ---
  if (!token) {
    return (
      <AuthPage 
        email={email} setEmail={setEmail} password={password} setPassword={setPassword}
        isRegistering={isRegistering} setIsRegistering={setIsRegistering}
        error={error} setError={setError} successMessage={successMessage} setSuccessMessage={setSuccessMessage}
        handleLogin={handleLogin} handleRegister={handleRegister}
      />
    );
  }

  return (
    <div>
      <Navbar navigateToFeed={navigateToFeed} navigateToMyProfile={navigateToMyProfile} setCurrentView={setCurrentView} handleLogout={handleLogout} />

      <div className="main-feed-container">
        {error && <div className="error-msg" style={{ width: '470px' }}>{error}</div>}

        {currentView === 'feed' && (
          <FeedPage 
            feed={feed} feedMode={feedMode} handleFeedModeChange={handleFeedModeChange}
            handleUpload={handleUpload} caption={caption} setCaption={setCaption}
            postVideoSrc={postVideoSrc} setPostVideoSrc={setPostVideoSrc} postImageSrc={postImageSrc} setPostImageSrc={setPostImageSrc}
            selectedFile={selectedFile} setSelectedFile={setSelectedFile} postCrop={postCrop} setPostCrop={setPostCrop}
            postZoom={postZoom} setPostZoom={setPostZoom} postAspect={postAspect} setPostAspect={setPostAspect}
            onPostCropComplete={onPostCropComplete} onPostFileChange={onPostFileChange} fileKey={fileKey}
            uploading={uploading} setUploading={setUploading} email={email} loadedComments={loadedComments} showComments={showComments}
            commentInputs={commentInputs} setCommentInputs={setCommentInputs} handleDeletePost={handleDeletePost} handleLikeToggle={handleLikeToggle}
            handleViewLikers={handleViewLikers} handleSaveToggle={handleSaveToggle} handleToggleComments={handleToggleComments}
            handleDeleteComment={handleDeleteComment} handleCommentSubmit={handleCommentSubmit} navigateToProfile={navigateToProfile}
            handleFollowToggle={handleFollowToggle}
          />
        )}

        {currentView === 'profile' && viewedUser && (
          <ProfilePage 
            viewedUser={viewedUser} email={email} navigateToFeed={navigateToFeed} handleFollowToggle={handleFollowToggle}
            setEditBio={setEditBio} setShowEditProfileModal={setShowEditProfileModal} userPosts={userPosts} handleViewFollows={handleViewFollows}
            profileTab={profileTab} setProfileTab={setProfileTab} fetchSavedPosts={fetchSavedPosts} savedPosts={savedPosts} likedPosts={likedPosts}
            loadedComments={loadedComments} showComments={showComments} commentInputs={commentInputs} setCommentInputs={setCommentInputs}
            handleDeletePost={handleDeletePost} handleLikeToggle={handleLikeToggle} handleViewLikers={handleViewLikers} handleSaveToggle={handleSaveToggle}
            handleToggleComments={handleToggleComments} handleDeleteComment={handleDeleteComment} handleCommentSubmit={handleCommentSubmit}
            navigateToProfile={navigateToProfile}
          />
        )}

        {currentView === 'search' && (
          <SearchPage 
            searchQuery={searchQuery} setSearchQuery={setSearchQuery} searchResults={searchResults} email={email}
            navigateToProfile={navigateToProfile} handleFollowToggle={handleFollowToggle}
          />
        )}

        {currentView === 'agent-search' && <SearchAgentPage />}
      </div>

      {showLikersModal && <LikersModal setShowLikersModal={setShowLikersModal} currentLikers={currentLikers} email={email} navigateToProfile={navigateToProfile} handleFollowToggle={handleFollowToggle} />}
      {showFollowModal && <FollowModal setShowFollowModal={setShowFollowModal} followModalType={followModalType} followList={followList} email={email} navigateToProfile={navigateToProfile} handleFollowToggle={handleFollowToggle} />}
      {showEditProfileModal && (
        <EditProfileModal 
          setShowEditProfileModal={setShowEditProfileModal} handleEditProfileSubmit={handleEditProfileSubmit} editBio={editBio} setEditBio={setEditBio}
          imageSrc={imageSrc} setImageSrc={setImageSrc} crop={crop} setCrop={setCrop} zoom={zoom} setZoom={setZoom} onCropComplete={onCropComplete}
          onFileChange={onFileChange} removePhoto={removePhoto} setRemovePhoto={setRemovePhoto}
        />
      )}
    </div>
  );
}

export default App;