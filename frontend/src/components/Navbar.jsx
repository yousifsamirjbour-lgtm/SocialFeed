import React from 'react';

const Navbar = ({ navigateToFeed, navigateToMyProfile, setCurrentView, handleLogout }) => {
  return (
    <nav className="navbar">
      <h2 className="nav-logo" style={{ cursor: 'pointer' }} onClick={navigateToFeed}>
        SocialFeed 
      </h2>
      
      <div className="nav-actions">
        <button 
          onClick={navigateToMyProfile} 
          className="nav-action-btn"
          title="Profile"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', verticalAlign: 'middle' }}>
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          Profile
        </button>
          
        <button 
          onClick={() => setCurrentView('search')} 
          className="nav-action-btn"
          title="Find Users"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', verticalAlign: 'middle' }}>
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          Find Users
        </button>

        <button
          onClick={() => setCurrentView('agent-search')}
          className="nav-action-btn"
          title="Web Search"
        >
          AI Web Search
        </button>
          
        <button onClick={handleLogout} className="logout-btn">Logout</button>
      </div>
    </nav>
  );
};

export default Navbar;