import React from 'react';

const UserBadge = ({ userObj, email, showFollowButton = true, navigateToProfile, handleFollowToggle }) => {
  return (
    <span className="user-badge">
      <strong className="username-link" onClick={() => navigateToProfile(userObj.id)}>
        {userObj.email}
      </strong>
      
      {showFollowButton && userObj.email !== email && (
        <button 
          onClick={() => handleFollowToggle(userObj.id)}
          className={`inline-follow-btn ${userObj.is_following ? 'following' : ''}`}
        >
          • {userObj.is_following ? 'Following' : 'Follow'}
        </button>
      )}
    </span>
  );
};

export default UserBadge;