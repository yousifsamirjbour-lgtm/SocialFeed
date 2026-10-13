import { getProfileImageUrl } from '../config/api';
const DEFAULT_AVATAR_URL = '/default-avatar.svg';

const ProfileAvatar = ({ profilePictureUrl, className = 'profile-avatar-img' }) => {
  const handleImageError = (event) => {
    event.currentTarget.onerror = null;
    event.currentTarget.src = DEFAULT_AVATAR_URL;
  };

  return (
    <img
      src={getProfileImageUrl(profilePictureUrl)}
      alt="Profile"
      className={className}
      onError={handleImageError}
    />
  );
};

export default ProfileAvatar;