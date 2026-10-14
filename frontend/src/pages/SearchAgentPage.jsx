import { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './SearchAgentPage.css';

const DEFAULT_STEPS = [
  { id: 'retrieve_internal', label: '1. Community Search', description: 'Searching discussions across SocialFeed' },
  { id: 'grade_documents', label: '2. Relevance Check', description: 'Evaluating community content completeness' },
  { id: 'web_search', label: '3. Web Verification', description: 'Checking live internet facts & citations' },
  { id: 'draft', label: '4. Synthesis & Drafting', description: 'Combining community opinions with web facts' },
  { id: 'critique', label: '5. Editor Critique', description: 'Editor AI checking accuracy & tone' },
  { id: 'approval_ready', label: '6. Human Approval', description: 'Your final review and publication control' }
];

const SearchAgentPage = ({ initialQuery = '', initialPostId = null, navigateToFeed, onPostPublished }) => {
  const [searchInput, setSearchInput] = useState(initialQuery || '');
  const [wantImage, setWantImage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentStepId, setCurrentStepId] = useState('');
  const [statusText, setStatusText] = useState('');
  const [critiqueWarning, setCritiqueWarning] = useState('');
  const [completedSteps, setCompletedSteps] = useState(new Set());
  
  // Research output
  const [threadId, setThreadId] = useState('');
  const [comparisonData, setComparisonData] = useState(null);
  const [editedPost, setEditedPost] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [publishStatus, setPublishStatus] = useState('idle'); // 'idle' | 'publishing' | 'published' | 'cancelled'
  const [error, setError] = useState('');
  const abortControllerRef = useRef(null);

  const handleStartResearch = async (event) => {
    if (event) event.preventDefault();
    const query = searchInput.trim();
    if (!query || isLoading) return;

    setIsLoading(true);
    setError('');
    setCritiqueWarning('');
    setComparisonData(null);
    setThreadId('');
    setPublishStatus('idle');
    setCompletedSteps(new Set());
    setCurrentStepId('retrieve_internal');
    setStatusText('Reading what people on SocialFeed said about this...');

    const token = localStorage.getItem('token');
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch('/api/agent/research', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          query,
          post_id: initialPostId || null,
          want_image: wantImage
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        let errMessage = `Request failed (${response.status})`;
        try {
          const errData = await response.json();
          errMessage = errData.detail || errData.message || errMessage;
        } catch {
          const errText = await response.text();
          if (errText) errMessage = errText;
        }
        throw new Error(errMessage);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const rawBlock of lines) {
          if (!rawBlock.trim()) continue;

          let eventType = 'message';
          let eventData = '';

          const blockLines = rawBlock.split('\n');
          for (const line of blockLines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              eventData = line.slice(6);
            }
          }

          if (!eventData) continue;

          try {
            const parsed = JSON.parse(eventData);

            if (eventType === 'step') {
              if (parsed.name) {
                setCurrentStepId(parsed.name);
                setCompletedSteps(prev => new Set([...prev, parsed.name]));
              }
              if (parsed.status) {
                setStatusText(parsed.status);
              }
              if (parsed.warning && parsed.partial?.critique_feedback) {
                setCritiqueWarning(parsed.partial.critique_feedback);
              }
            } else if (eventType === 'approval_ready') {
              setThreadId(parsed.thread_id);
              setComparisonData(parsed);
              setEditedPost(parsed.draft_post || '');
              setSelectedImage(parsed.image_url || null);
              setCompletedSteps(prev => new Set([...prev, 'approval_ready']));
              setCurrentStepId('approval_ready');
              setStatusText('Synthesis verified. Ready for your review & publication.');
            } else if (eventType === 'error') {
              setError(parsed.message || 'An error occurred during AI research.');
            }
          } catch {
            // Ignore partial chunk decode errors
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Failed to connect to AI Studio.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!threadId) return;
    setPublishStatus('publishing');
    setError('');

    const token = localStorage.getItem('token');
    try {
      const response = await fetch(`/api/agent/research/${threadId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          user_action: 'approve',
          edited_text: editedPost,
          selected_image_url: selectedImage
        })
      });

      if (!response.ok) {
        let errText = 'Failed to publish post.';
        try {
          const d = await response.json();
          errText = d.detail || d.message || errText;
        } catch {
          // ignore
        }
        throw new Error(errText);
      }

      setPublishStatus('published');
      if (onPostPublished) onPostPublished();
    } catch (err) {
      setError(err.message || 'Approval failed.');
      setPublishStatus('idle');
    }
  };

  const handleCancel = async () => {
    if (threadId) {
      const token = localStorage.getItem('token');
      try {
        await fetch(`/api/agent/research/${threadId}/cancel`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
          }
        });
      } catch {
        // ignore
      }
    }
    setPublishStatus('cancelled');
    setIsLoading(false);
  };

  const getVerdictClass = (verdict = '') => {
    const lower = verdict.toLowerCase();
    if (lower.includes('true') || lower.includes('verified')) return 'verdict-true';
    if (lower.includes('false') || lower.includes('misleading')) return 'verdict-false';
    if (lower.includes('mixed') || lower.includes('nuanced')) return 'verdict-mixed';
    return 'verdict-unverified';
  };

  return (
    <main className="ai-studio-page">
      <header className="ai-studio-header">
        <div className="ai-studio-eyebrow">
          <span className="ai-sparkle-icon">✨</span>
          <span>SOCIALFEED AI STUDIO</span>
        </div>
        <h1>Research Assistant & Fact-Checker</h1>
        <p className="ai-studio-subtitle">
          Connect what people on SocialFeed are saying with live facts from the web.
          Watch the AI research, cross-reference, and self-correct with full human approval.
        </p>
      </header>

      {/* Query Input Box */}
      <form className="ai-studio-query-card" onSubmit={handleStartResearch}>
        <label htmlFor="ai-studio-input" className="ai-studio-label">
          What claim or topic would you like to research?
        </label>
        <div className="ai-studio-input-row">
          <input
            id="ai-studio-input"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="e.g. Is Python or JavaScript better for beginners in 2026?"
            disabled={isLoading}
            maxLength={300}
            required
          />
          <button
            type="submit"
            className="ai-studio-submit-btn"
            disabled={isLoading || !searchInput.trim()}
          >
            {isLoading ? 'Researching...' : 'Start Research'}
          </button>
        </div>

        <div className="ai-studio-options-row">
          <label className="ai-studio-checkbox-label">
            <input
              type="checkbox"
              checked={wantImage}
              onChange={(e) => setWantImage(e.target.checked)}
              disabled={isLoading}
            />
            <span>Generate Concept Illustration with Pollinations.ai</span>
          </label>
          <span className="ai-studio-cost-badge">$0.00 Free Tier Protected</span>
        </div>
      </form>

      {/* Error / Rate Limit Alert */}
      {error && (
        <div className="ai-studio-error-banner" role="alert">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* Live Agent Stepper */}
      {(isLoading || comparisonData) && (
        <section className="ai-stepper-container" aria-label="Research Progress">
          <div className="ai-stepper-header">
            <h3>Agent Execution Stepper</h3>
            <span className="ai-stepper-status-badge">{statusText}</span>
          </div>

          <div className="ai-stepper-steps">
            {DEFAULT_STEPS.map((step) => {
              const isCompleted = completedSteps.has(step.id);
              const isCurrent = currentStepId === step.id && isLoading;
              
              let stepClass = 'stepper-step pending';
              if (isCompleted) stepClass = 'stepper-step completed';
              if (isCurrent) stepClass = 'stepper-step active';

              return (
                <div key={step.id} className={stepClass}>
                  <div className="stepper-dot">
                    {isCompleted ? '✓' : isCurrent ? '●' : '○'}
                  </div>
                  <div className="stepper-content">
                    <span className="stepper-label">{step.label}</span>
                    <span className="stepper-desc">{step.description}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Self-Correction Wow Moment Badge */}
          {critiqueWarning && (
            <div className="ai-self-correction-banner">
              <span className="badge-icon">🔄</span>
              <div>
                <strong>Editor AI Visible Self-Correction:</strong>
                <p>"{critiqueWarning}" — Rewriting draft to ensure balance and factual rigor.</p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Community vs. Reality Card */}
      {comparisonData && (
        <section className="ai-comparison-card" aria-label="Community vs Reality">
          <div className="comparison-verdict-header">
            <span className="verdict-label">EVIDENCE VERDICT:</span>
            <span className={`verdict-tag ${getVerdictClass(comparisonData.verdict)}`}>
              {comparisonData.verdict || 'Mixed / Nuanced'}
            </span>
          </div>

          <div className="comparison-grid">
            {/* Left: Community Voices */}
            <div className="comparison-column community-column">
              <div className="column-header">
                <h4>👥 SocialFeed Community Voices</h4>
                <span className="source-count">
                  {comparisonData.internal_docs?.length || 0} discussion(s) analyzed
                </span>
              </div>
              <div className="column-content">
                <p className="summary-paragraph">{comparisonData.community_summary}</p>
                {comparisonData.internal_docs && comparisonData.internal_docs.length > 0 && (
                  <div className="citations-list">
                    <span className="citations-title">Referenced Discussions:</span>
                    <ul>
                      {comparisonData.internal_docs.map((doc, idx) => (
                        <li key={idx}>
                          <strong>@{doc.author}</strong>: "{doc.caption?.slice(0, 70)}..."
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Web Reality */}
            <div className="comparison-column web-column">
              <div className="column-header">
                <h4>🌐 Verified Reality & Web Citations</h4>
                <span className="source-count">
                  {comparisonData.web_docs?.length || 0} source(s) verified
                </span>
              </div>
              <div className="column-content">
                <div className="markdown-web-summary">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="agent-search-link"
                        >
                          {children} ↗
                        </a>
                      )
                    }}
                  >
                    {comparisonData.web_summary || ''}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Post Editor & Approval Box */}
      {comparisonData && publishStatus !== 'published' && publishStatus !== 'cancelled' && (
        <section className="ai-publish-box" aria-label="Post Drafting & Human Approval">
          <div className="publish-box-header">
            <h3>📝 Turn Into a Verified Post</h3>
            <p>Review the AI-generated draft, edit as needed, and confirm before anything is published.</p>
          </div>

          <div className="draft-editor-area">
            <label htmlFor="draft-textarea">Post Caption (Editable):</label>
            <textarea
              id="draft-textarea"
              value={editedPost}
              onChange={(e) => setEditedPost(e.target.value)}
              rows={4}
              maxLength={1500}
            />
          </div>

          {selectedImage && (
            <div className="draft-image-preview">
              <div className="image-preview-header">
                <span>AI Generated Visual (Cloudinary Hosted)</span>
                <button
                  type="button"
                  className="remove-img-btn"
                  onClick={() => setSelectedImage(null)}
                >
                  Remove Image
                </button>
              </div>
              <img src={selectedImage} alt="AI Visual Concept" className="preview-img" />
            </div>
          )}

          <div className="publish-actions-row">
            <button
              type="button"
              className="approve-publish-btn"
              onClick={handleApprove}
              disabled={publishStatus === 'publishing' || !editedPost.trim()}
            >
              {publishStatus === 'publishing' ? 'Publishing to Feed...' : '✓ Approve & Publish to Feed'}
            </button>
            <button
              type="button"
              className="cancel-btn"
              onClick={handleCancel}
              disabled={publishStatus === 'publishing'}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* Published Success Notification */}
      {publishStatus === 'published' && (
        <div className="ai-published-banner">
          <div className="success-icon">🎉</div>
          <div className="success-content">
            <h4>Post Successfully Published to Feed!</h4>
            <p>Your fact-checked post is now live with community citations.</p>
          </div>
          {navigateToFeed && (
            <button type="button" className="view-feed-btn" onClick={navigateToFeed}>
              View in Feed ➔
            </button>
          )}
        </div>
      )}

      {publishStatus === 'cancelled' && (
        <div className="ai-cancelled-banner">
          <span>Session cancelled. No changes were made to your feed.</span>
          <button type="button" onClick={() => setPublishStatus('idle')}>Start Over</button>
        </div>
      )}
    </main>
  );
};

export default SearchAgentPage;