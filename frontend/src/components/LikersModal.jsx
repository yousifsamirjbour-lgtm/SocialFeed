import React from 'react';
import UserBadge from './UserBadge';

const LikersModal = ({ setShowLikersModal, currentLikers, email, navigateToProfile, handleFollowToggle }) => {
  return (
    <div className="modal-overlay" onClick={() => setShowLikersModal(false)}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Likes</h3>
          <button className="close-modal-btn" onClick={() => setShowLikersModal(false)}>✕</button>
        </div>
        <div className="likers-list">
          {currentLikers.length === 0 ? (
            <p className="empty-likes-msg">No likes yet.</p>
          ) : (
            currentLikers.map(liker => (
              <div key={liker.id} className="liker-row">
                <UserBadge 
                  userObj={liker} 
                  email={email} 
                  navigateToProfile={navigateToProfile} 
                  handleFollowToggle={handleFollowToggle} 
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default LikersModal;