import UserBadge from '../components/UserBadge';

const SearchPage = ({
  searchQuery,
  setSearchQuery,
  searchResults,
  email,
  currentUserId,
  navigateToProfile,
  handleFollowToggle
}) => {
  return (
    <div className="search-page">
      <div className="search-form">
        <input 
          type="text" 
          placeholder="Search users by name..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
          autoFocus 
        />
      </div>

      <div className="search-results-container">
        {searchResults.length === 0 && searchQuery.trim() !== '' ? (
          <p className="empty-search-msg">No users found.</p>
        ) : (
          searchResults.map(user => (
            <div key={user.id} className="search-result-card">
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
  );
};

export default SearchPage;