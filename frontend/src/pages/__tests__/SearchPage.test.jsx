import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SearchPage from '../SearchPage';

describe('SearchPage', () => {
  const defaultProps = {
    searchQuery: '',
    setSearchQuery: vi.fn(),
    searchResults: [],
    email: 'me@example.com',
    currentUserId: 'my-id',
    navigateToProfile: vi.fn(),
    handleFollowToggle: vi.fn()
  };

  it('renders search input for users by name', () => {
    render(<SearchPage {...defaultProps} />);

    const input = screen.getByPlaceholderText('Search users by name...');
    expect(input).toBeInTheDocument();
  });

  it('triggers setSearchQuery on input change', () => {
    render(<SearchPage {...defaultProps} />);

    const input = screen.getByPlaceholderText('Search users by name...');
    fireEvent.change(input, { target: { value: 'alice' } });
    expect(defaultProps.setSearchQuery).toHaveBeenCalledWith('alice');
  });

  it('renders search results by display name when matches exist', () => {
    const results = [
      { id: 'u1', name: 'Alice Walker', is_following: false },
      { id: 'u2', name: 'Alicia Keys', is_following: true }
    ];
    render(<SearchPage {...defaultProps} searchQuery="ali" searchResults={results} />);

    expect(screen.getByText('Alice Walker')).toBeInTheDocument();
    expect(screen.getByText('Alicia Keys')).toBeInTheDocument();
  });

  it('renders "No users found." message when search returns no matches', () => {
    render(<SearchPage {...defaultProps} searchQuery="nonexistent" searchResults={[]} />);

    expect(screen.getByText('No users found.')).toBeInTheDocument();
  });
});
