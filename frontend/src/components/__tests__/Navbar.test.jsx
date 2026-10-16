import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Navbar from '../Navbar';

describe('Navbar Component', () => {
  const defaultProps = {
    navigateToFeed: vi.fn(),
    navigateToMyProfile: vi.fn(),
    setCurrentView: vi.fn(),
    handleLogout: vi.fn(),
    currentUserName: ''
  };

  it('renders brand name and navigation buttons', () => {
    render(<Navbar {...defaultProps} />);

    expect(screen.getByText('SocialFeed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Profile/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Find Users/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI Chatbot/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Logout/i })).toBeInTheDocument();
  });

  it('renders logged-in user display name on profile button when provided', () => {
    render(<Navbar {...defaultProps} currentUserName="Jane Doe" />);

    expect(screen.getByRole('button', { name: /Jane Doe/i })).toBeInTheDocument();
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

  it('triggers setCurrentView with search and ai-chat', () => {
    render(<Navbar {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Find Users/i }));
    expect(defaultProps.setCurrentView).toHaveBeenCalledWith('search');

    fireEvent.click(screen.getByRole('button', { name: /AI Chatbot/i }));
    expect(defaultProps.setCurrentView).toHaveBeenCalledWith('ai-chat');
  });

  it('triggers handleLogout when clicking Logout button', () => {
    render(<Navbar {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Logout/i }));
    expect(defaultProps.handleLogout).toHaveBeenCalled();
  });

  it('renders notifications button with badge and triggers onToggleNotifications', () => {
    const onToggleNotifications = vi.fn();
    render(
      <Navbar
        {...defaultProps}
        unreadCount={5}
        isNotificationsOpen={false}
        onToggleNotifications={onToggleNotifications}
      />
    );

    const notifBtn = screen.getByRole('button', { name: /Notifications/i });
    expect(notifBtn).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    fireEvent.click(notifBtn);
    expect(onToggleNotifications).toHaveBeenCalledTimes(1);
  });
});
