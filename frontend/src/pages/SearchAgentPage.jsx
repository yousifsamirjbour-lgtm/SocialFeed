import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './SearchAgentPage.css';

const SearchAgentPage = () => {
  const [searchInput, setSearchInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('Searching the web...');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoading) return undefined;

    const statusTimer = window.setTimeout(() => {
      setLoadingStatus('Synthesizing response...');
    }, 2500);

    return () => window.clearTimeout(statusTimer);
  }, [isLoading]);

  const handleSearch = async (event) => {
    event.preventDefault();
    const query = searchInput.trim();
    if (!query || isLoading) return;

    setIsLoading(true);
    setLoadingStatus('Searching the web...');
    setResult('');
    setError('');

    try {
      const res = await fetch('/api/search-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });

      if (!res.ok) {
        const errorBody = await res.text();
        let errorMessage = `Search request failed (${res.status}).`;

        try {
          const errorData = JSON.parse(errorBody);
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch {
          if (errorBody.trim() && !errorBody.trimStart().startsWith('<')) {
            errorMessage = errorBody;
          }
        }

        throw new Error(errorMessage);
      }

      const data = await res.json();
      setResult(typeof data.response === 'string' ? data.response : '');
    } catch (requestError) {
      setError(
        requestError instanceof SyntaxError
          ? 'The search service returned an invalid response.'
          : requestError.message || 'Search request failed. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="agent-search-page">
      <header className="agent-search-heading">
        <p className="agent-search-eyebrow">WEB RESEARCH</p>
        <h1>Search the web</h1>
      </header>

      <form className="agent-search-form" onSubmit={handleSearch}>
        <label className="agent-search-label" htmlFor="agent-search-input">What would you like to find?</label>
        <div className="agent-search-controls">
          <input
            id="agent-search-input"
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Ask a question or enter a topic"
            disabled={isLoading}
            required
          />
          <button type="submit" disabled={isLoading || !searchInput.trim()}>
            {isLoading ? 'Searching' : 'Search'}
          </button>
        </div>
      </form>

      {isLoading && (
        <div className="agent-search-status" role="status" aria-live="polite">
          <span className="agent-search-spinner" aria-hidden="true" />
          <span>{loadingStatus}</span>
        </div>
      )}

      {error && <p className="agent-search-error" role="alert">{error}</p>}

      {result && (
        <article className="agent-search-results" aria-label="Search results">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, title, children }) => (
                <a
                  href={href}
                  title={title}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="agent-search-link"
                >
                  {children}
                </a>
              )
            }}
          >
            {result}
          </ReactMarkdown>
        </article>
      )}
    </main>
  );
};

export default SearchAgentPage;