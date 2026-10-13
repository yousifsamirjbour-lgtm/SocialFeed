import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SearchPage from '../SearchPage';

describe('SearchPage', () => {
  const defaultProps = {
    searchQuery: '',
    setSearchQuery: vi.fn(),
    searchResults: [],
    email: 'me@example.com',
    navigateToProfile: vi.fn(),
    handleFollowToggle: vi.fn()
  };

  it('renders search input', () => {
    render(<SearchPage {...defaultProps} />);

    const input = screen.getByPlaceholderText('Search users by email...');
    expect(input).toBeInTheDocument();
  });

  it('triggers setSearchQuery on input change', () => {
    render(<SearchPage {...defaultProps} />);

    const input = screen.getByPlaceholderText('Search users by email...');
    fireEvent.change(input, { target: { value: 'alice' } });
    expect(defaultProps.setSearchQuery).toHaveBeenCalledWith('alice');
  });

  it('renders search results when matches exist', () => {
    const results = [
      { id: 'u1', email: 'alice@example.com', is_following: false },
      { id: 'u2', email: 'alicia@example.com', is_following: true }
    ];
    render(<SearchPage {...defaultProps} searchQuery="ali" searchResults={results} />);

    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('alicia@example.com')).toBeInTheDocument();
  });

  it('renders "No users found." message when search returns no matches', () => {
    render(<SearchPage {...defaultProps} searchQuery="nonexistent" searchResults={[]} />);

    expect(screen.getByText('No users found.')).toBeInTheDocument();
  });
});
