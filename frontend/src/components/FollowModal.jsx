import UserBadge from './UserBadge';

const FollowModal = ({ setShowFollowModal, followModalType, followList, email, currentUserId, navigateToProfile, handleFollowToggle }) => {
  return (
    <div className="modal-overlay" onClick={() => setShowFollowModal(false)}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ textTransform: 'capitalize' }}>{followModalType}</h3>
          <button className="close-modal-btn" onClick={() => setShowFollowModal(false)}>✕</button>
        </div>
        <div className="likers-list">
          {followList.length === 0 ? (
            <p className="empty-likes-msg">No {followModalType} yet.</p>
          ) : (
            followList.map(user => (
              <div key={user.id} className="liker-row">
                <UserBadge 
                  userObj={user} 
                  email={email} 
                  currentUserId={currentUserId}
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

export default FollowModal;