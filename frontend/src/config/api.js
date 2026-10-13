export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const getProfileImageUrl = (profilePictureUrl, defaultAvatar = '/default-avatar.svg') => {
  const trimmedUrl = profilePictureUrl?.trim();

  if (!trimmedUrl) return defaultAvatar;
  if (/^(https?:)?\/\//i.test(trimmedUrl)) {
    return trimmedUrl.startsWith('//') ? `https:${trimmedUrl}` : trimmedUrl;
  }

  return `${API_BASE_URL}${trimmedUrl.startsWith('/') ? '' : '/'}${trimmedUrl}`;
};
