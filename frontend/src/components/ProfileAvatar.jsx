const API_BASE_URL = 'https://socialfeed.duckdns.org/api';
const DEFAULT_AVATAR_URL = '/default-avatar.svg';

const getProfileImageUrl = (profilePictureUrl) => {
  const trimmedUrl = profilePictureUrl?.trim();

  if (!trimmedUrl) return DEFAULT_AVATAR_URL;
  if (/^(https?:)?\/\//i.test(trimmedUrl)) {
    return trimmedUrl.startsWith('//') ? `https:${trimmedUrl}` : trimmedUrl;
  }

  return `${API_BASE_URL}${trimmedUrl.startsWith('/') ? '' : '/'}${trimmedUrl}`;
};

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