const Navbar = ({
  navigateToFeed,
  navigateToMyProfile,
  setCurrentView,
  handleLogout,
  currentUserName,
  unreadCount = 0,
  isNotificationsOpen = false,
  onToggleNotifications,
  notificationsDropdown
}) => {
  return (
    <nav className="navbar" aria-label="Main Navigation">
      <h2 className="nav-logo" style={{ cursor: 'pointer' }} onClick={navigateToFeed}>
        SocialFeed 
      </h2>
      
      <div className="nav-actions">
        <button 
          onClick={navigateToMyProfile} 
          className="nav-action-btn"
          title={currentUserName || "Profile"}
          aria-label={currentUserName || "Profile"}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-btn-icon">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          <span className="nav-btn-text">{currentUserName || 'Profile'}</span>
        </button>
          
        <button 
          onClick={() => setCurrentView('search')} 
          className="nav-action-btn"
          title="Find Users"
          aria-label="Find Users"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-btn-icon">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <span className="nav-btn-text">Find Users</span>
        </button>

        <button
          onClick={() => setCurrentView('ai-chat')}
          className="nav-action-btn"
          title="AI Chatbot"
          aria-label="AI Chatbot"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-btn-icon">
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
          </svg>
          <span className="nav-btn-text">AI Chatbot</span>
        </button>

        {onToggleNotifications && (
          <div className="nav-notifications-wrapper" style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={onToggleNotifications}
              className={`nav-action-btn nav-notifications-btn ${isNotificationsOpen ? 'active' : ''}`}
              title={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
              aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
              aria-haspopup="dialog"
              aria-expanded={isNotificationsOpen}
            >
              <div className="nav-notifications-icon-container">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill={isNotificationsOpen ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="nav-btn-icon"
                >
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                </svg>
                {unreadCount > 0 && (
                  <span className="navbar-unread-badge" aria-hidden="true">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </div>
              <span className="nav-btn-text">Notifications</span>
            </button>
            {notificationsDropdown}
          </div>
        )}
          
        <button 
          onClick={handleLogout} 
          className="logout-btn"
          title="Logout"
          aria-label="Logout"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="logout-btn-icon">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
          <span className="nav-btn-text">Logout</span>
        </button>
      </div>
    </nav>
  );
};

export default Navbar;