import UserName from './UserName';

const UserBadge = ({ 
  userObj, 
  email, 
  currentUserId, 
  showFollowButton = true, 
  navigateToProfile, 
  handleFollowToggle 
}) => {
  const isSelf = Boolean(
    (currentUserId && userObj?.id && String(userObj.id).toLowerCase() === String(currentUserId).toLowerCase()) || 
    (email && userObj?.email && userObj.email.toLowerCase() === email.toLowerCase())
  );

  return (
    <span className="user-badge">
      <strong className="username-link" onClick={() => navigateToProfile && userObj?.id && navigateToProfile(userObj.id)}>
        <UserName user={userObj} />
      </strong>
      
      {showFollowButton && !isSelf && (
        <button 
          onClick={() => handleFollowToggle && userObj?.id && handleFollowToggle(userObj.id)}
          className={`inline-follow-btn ${userObj?.is_following ? 'following' : ''}`}
        >
          • {userObj?.is_following ? 'Following' : 'Follow'}
        </button>
      )}
    </span>
  );
};

export default UserBadge;