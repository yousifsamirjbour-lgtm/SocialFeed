import React from 'react';

const AuthPage = ({
  email, setEmail,
  password, setPassword,
  isRegistering, setIsRegistering,
  error, setError,
  successMessage, setSuccessMessage,
  handleLogin, handleRegister
}) => {
  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1 className="auth-title">SocialFeed</h1>
        
        {error && <div className="error-msg">{error}</div>}
        {successMessage && <div className="success-msg">{successMessage}</div>}

        <form onSubmit={isRegistering ? handleRegister : handleLogin} className="auth-form">
          <input 
            type="email" 
            placeholder="Email address"
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            required 
            className="auth-input"
          />
          <input 
            type="password" 
            placeholder="Password"
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
            required 
            className="auth-input"
          />
          <button type="submit" className="auth-button">
            {isRegistering ? 'Sign up' : 'Log in'}
          </button>
        </form>

        <p className="auth-switch">
          {isRegistering ? 'Have an account?' : "Don't have an account?"}{' '}
          <button 
            type="button"
            onClick={() => { setIsRegistering(!isRegistering); setError(''); setSuccessMessage(''); }}
            className="auth-switch-btn"
          >
            {isRegistering ? 'Log in' : 'Sign up'}
          </button>
        </p>
      </div>
    </div>
  );
};

export default AuthPage;