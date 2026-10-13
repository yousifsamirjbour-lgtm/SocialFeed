import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AuthPage from '../AuthPage';

describe('AuthPage', () => {
  const defaultProps = {
    name: '',
    setName: vi.fn(),
    email: '',
    setEmail: vi.fn(),
    password: '',
    setPassword: vi.fn(),
    isRegistering: false,
    setIsRegistering: vi.fn(),
    error: '',
    setError: vi.fn(),
    successMessage: '',
    setSuccessMessage: vi.fn(),
    handleLogin: vi.fn((e) => e.preventDefault()),
    handleRegister: vi.fn((e) => e.preventDefault())
  };

  it('renders login form by default with ONLY email and password', () => {
    render(<AuthPage {...defaultProps} />);

    expect(screen.getByText('SocialFeed')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Email address')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Full Name')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByText("Don't have an account?")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeInTheDocument();
  });

  it('renders registration form with Full Name, Email, and Password when isRegistering is true', () => {
    render(<AuthPage {...defaultProps} isRegistering={true} />);

    const nameInput = screen.getByPlaceholderText('Full Name');
    expect(nameInput).toBeInTheDocument();
    expect(nameInput).toHaveAttribute('required');
    expect(nameInput).toHaveAttribute('minLength', '2');
    expect(nameInput).toHaveAttribute('maxLength', '50');

    expect(screen.getByPlaceholderText('Email address')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeInTheDocument();
    expect(screen.getByText('Have an account?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });

  it('submits login form when not registering', () => {
    render(<AuthPage {...defaultProps} email="test@example.com" password="secretpassword" isRegistering={false} />);

    const submitBtn = screen.getByRole('button', { name: 'Log in' });
    fireEvent.click(submitBtn);
    expect(defaultProps.handleLogin).toHaveBeenCalled();
  });

  it('submits registration form when isRegistering is true', () => {
    render(<AuthPage {...defaultProps} name="John Doe" email="test@example.com" password="secretpassword" isRegistering={true} />);

    const submitBtn = screen.getByRole('button', { name: 'Sign up' });
    fireEvent.click(submitBtn);
    expect(defaultProps.handleRegister).toHaveBeenCalled();
  });

  it('displays error and success messages', () => {
    const { rerender } = render(<AuthPage {...defaultProps} error="Invalid email or password" />);
    expect(screen.getByText('Invalid email or password')).toBeInTheDocument();

    rerender(<AuthPage {...defaultProps} error="" successMessage="Account created successfully!" />);
    expect(screen.getByText('Account created successfully!')).toBeInTheDocument();
  });

  it('switches between Login and Sign up modes', () => {
    render(<AuthPage {...defaultProps} isRegistering={false} />);
    const switchBtn = screen.getByRole('button', { name: 'Sign up' });
    fireEvent.click(switchBtn);
    expect(defaultProps.setIsRegistering).toHaveBeenCalledWith(true);
    expect(defaultProps.setError).toHaveBeenCalledWith('');
    expect(defaultProps.setSuccessMessage).toHaveBeenCalledWith('');
  });
});
