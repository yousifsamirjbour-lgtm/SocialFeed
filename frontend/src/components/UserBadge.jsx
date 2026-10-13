import UserName from './UserName';
import { isCurrentUser } from '../utils/user';

const UserBadge = ({ 
  userObj, 
  email, 
  currentUserId, 
  showFollowButton = true, 
  navigateToProfile, 
  handleFollowToggle 
}) => {
  const isSelf = isCurrentUser(userObj, currentUserId, email);

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