import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Navbar from '../Navbar';

describe('Navbar Component', () => {
  const defaultProps = {
    navigateToFeed: vi.fn(),
    navigateToMyProfile: vi.fn(),
    setCurrentView: vi.fn(),
    handleLogout: vi.fn()
  };

  it('renders brand name and navigation buttons', () => {
    render(<Navbar {...defaultProps} />);

    expect(screen.getByText('SocialFeed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Profile/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Find Users/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI Web Search/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Logout/i })).toBeInTheDocument();
  });

  it('triggers navigateToFeed when clicking logo', () => {
    render(<Navbar {...defaultProps} />);
    fireEvent.click(screen.getByText('SocialFeed'));
    expect(defaultProps.navigateToFeed).toHaveBeenCalled();
  });

  it('triggers navigateToMyProfile when clicking Profile button', () => {
    render(<Navbar {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Profile/i }));
    expect(defaultProps.navigateToMyProfile).toHaveBeenCalled();
  });

  it('triggers setCurrentView with search and agent-search', () => {
    render(<Navbar {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Find Users/i }));
    expect(defaultProps.setCurrentView).toHaveBeenCalledWith('search');

    fireEvent.click(screen.getByRole('button', { name: /AI Web Search/i }));
    expect(defaultProps.setCurrentView).toHaveBeenCalledWith('agent-search');
  });

  it('triggers handleLogout when clicking Logout button', () => {
    render(<Navbar {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Logout/i }));
    expect(defaultProps.handleLogout).toHaveBeenCalled();
  });
});
