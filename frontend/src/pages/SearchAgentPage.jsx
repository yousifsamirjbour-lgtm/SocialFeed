import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Cropper from 'react-easy-crop';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, CheckCircle2 } from 'lucide-react';
import './SearchAgentPage.css';

const DEFAULT_STEPS = [
  { id: 'retrieve_internal', label: '1. Community', fullLabel: 'Community Search' },
  { id: 'grade_documents', label: '2. Relevance', fullLabel: 'Relevance Check' },
  { id: 'web_search', label: '3. Web Facts', fullLabel: 'Web Verification' },
  { id: 'draft', label: '4. Drafting', fullLabel: 'Synthesis & Drafting' },
  { id: 'critique', label: '5. Critique', fullLabel: 'Editor Critique' },
  { id: 'approval_ready', label: '6. Approval', fullLabel: 'Human Approval' }
];

const cardTransition = {
  type: 'spring',
  damping: 24,
  stiffness: 260
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08
    }
  }
};

const staggerItem = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25 } }
};

const getCroppedImg = async (imageSrc, pixelCrop) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = imageSrc;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = (e) => reject(new Error('Failed to load image for cropping: ' + e));
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(pixelCrop.width);
  canvas.height = Math.round(pixelCrop.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    image,
    pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
    0, 0, pixelCrop.width, pixelCrop.height
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas export failed'));
        return;
      }
      resolve(new File([blob], 'ai-studio-cropped.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  });
};

const SearchAgentPage = ({ initialQuery = '', initialPostId = null, navigateToFeed, onPostPublished }) => {
  const safeInitialQuery = typeof initialQuery === 'string' ? initialQuery : '';
  const [searchInput, setSearchInput] = useState(safeInitialQuery);
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
  const [aiImageUrl, setAiImageUrl] = useState(null);
  const [webImageUrl, setWebImageUrl] = useState(null);
  const [customImageUrl, setCustomImageUrl] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [isUploadingCustom, setIsUploadingCustom] = useState(false);
  const [publishStatus, setPublishStatus] = useState('idle'); // 'idle' | 'publishing' | 'published' | 'cancelled'
  const [error, setError] = useState('');
  const abortControllerRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  const handleDeviceUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingCustom(true);
    setError('');
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/agent/research/upload-image', {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: formData
      });

      if (!response.ok) {
        let errText = 'Failed to upload image from device.';
        try {
          const d = await response.json();
          errText = d.detail || d.message || errText;
        } catch {
          // ignore
        }
        throw new Error(errText);
      }

      const data = await response.json();
      if (data.image_url) {
        setCustomImageUrl(data.image_url);
        setSelectedImage(data.image_url);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setCroppedAreaPixels(null);
      }
    } catch (err) {
      setError(err.message || 'Error uploading image from device.');
    } finally {
      setIsUploadingCustom(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleStartResearch = async (event) => {
    if (event) event.preventDefault();
    const query = (typeof searchInput === 'string' ? searchInput : '').trim();
    if (!query || isLoading) return;

    setIsLoading(true);
    setError('');
    setCritiqueWarning('');
    setComparisonData(null);
    setThreadId('');
    setAiImageUrl(null);
    setWebImageUrl(null);
    setCustomImageUrl(null);
    setSelectedImage(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
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
        let errDetail = 'Failed to start research.';
        try {
          const errorData = await response.json();
          errDetail = errorData.detail || errorData.message || errDetail;
        } catch {
          // Response body was not JSON
        }
        throw new Error(errDetail);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (!part.trim()) continue;

          let eventType = 'message';
          let dataStr = '';

          const lines = part.split('\n');
          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataStr += line.slice(5).trim();
            }
          }

          if (dataStr) {
            try {
              const parsed = JSON.parse(dataStr);

              if (eventType === 'step') {
                setCurrentStepId(parsed.name || '');
                if (parsed.status) {
                  setStatusText(parsed.status);
                }

                if (parsed.warning && parsed.partial?.critique_feedback) {
                  setCritiqueWarning(parsed.partial.critique_feedback);
                }

                if (parsed.name) {
                  const stepIndex = DEFAULT_STEPS.findIndex(s => s.id === parsed.name);
                  const nextSet = new Set(completedSteps);
                  for (let i = 0; i < stepIndex; i++) {
                    nextSet.add(DEFAULT_STEPS[i].id);
                  }
                  setCompletedSteps(nextSet);
                }
              } else if (eventType === 'approval_ready') {
                setThreadId(parsed.thread_id || '');
                setComparisonData({
                  query: parsed.query,
                  community_summary: parsed.community_summary,
                  web_summary: parsed.web_summary,
                  verdict: parsed.verdict,
                  internal_docs: parsed.internal_docs || [],
                  web_docs: parsed.web_docs || []
                });
                setEditedPost(parsed.draft_post || '');
                
                // Set images if provided
                const aiImg = parsed.ai_image_url || parsed.image_url || null;
                const webImg = parsed.web_image_url || null;
                setAiImageUrl(aiImg);
                setWebImageUrl(webImg);
                // Default selection to AI visual if present, otherwise web visual
                setSelectedImage(aiImg || webImg || null);

                setStatusText('Synthesis verified. Ready for your review & publication.');
                setCurrentStepId('approval_ready');
                setCompletedSteps(new Set(DEFAULT_STEPS.map(s => s.id)));
              } else if (eventType === 'error') {
                throw new Error(parsed.message || 'An error occurred during agent execution.');
              }
            } catch (jsonErr) {
              console.warn('Could not parse SSE payload:', jsonErr, dataStr);
            }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Network error occurred during research.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 240)}px`;
    }
  }, [searchInput]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isLoading && typeof searchInput === 'string' && searchInput.trim()) {
        handleStartResearch(e);
      }
    }
  };

  const handleApprove = async () => {
    if (!threadId) return;
    setPublishStatus('publishing');
    setError('');

    let finalImageUrl = selectedImage;

    // If an image was selected and cropped by the user, export the cropped image and upload to Cloudinary
    if (selectedImage && croppedAreaPixels && (zoom > 1 || crop.x !== 0 || crop.y !== 0)) {
      try {
        const croppedFile = await getCroppedImg(selectedImage, croppedAreaPixels);
        const token = localStorage.getItem('token');
        const formData = new FormData();
        formData.append('file', croppedFile);
        const uploadRes = await fetch('/api/agent/research/upload-image', {
          method: 'POST',
          headers: {
            'Authorization': token ? `Bearer ${token}` : ''
          },
          body: formData
        });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          if (uploadData.image_url) {
            finalImageUrl = uploadData.image_url;
          }
        }
      } catch (cropErr) {
        console.warn('Could not process cropped image, falling back to original:', cropErr);
      }
    }

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
          selected_image_url: finalImageUrl
        })
      });

      if (!response.ok) {
        let errText = 'Failed to publish post.';
        try {
          const errData = await response.json();
          errText = errData.detail || errData.message || errText;
        } catch {
          // ignore
        }
        throw new Error(errText);
      }

      setPublishStatus('published');
      if (onPostPublished) {
        onPostPublished();
      }
    } catch (err) {
      setError(err.message || 'Error occurred while approving post.');
      setPublishStatus('idle');
    }
  };

  const handleCancel = async () => {
    if (!threadId) {
      setPublishStatus('cancelled');
      return;
    }

    const token = localStorage.getItem('token');
    try {
      await fetch(`/api/agent/research/${threadId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        }
      });
    } catch (err) {
      console.warn('Failed to notify backend of cancellation:', err);
    } finally {
      setPublishStatus('cancelled');
    }
  };

  const getVerdictClass = (verdict) => {
    if (!verdict) return 'verdict-neutral';
    const lower = verdict.toLowerCase();
    if (lower.includes('verified') || lower.includes('true')) return 'verdict-true';
    if (lower.includes('debunked') || lower.includes('false')) return 'verdict-false';
    if (lower.includes('mixed') || lower.includes('nuanced')) return 'verdict-mixed';
    return 'verdict-unverified';
  };

  return (
    <main className="ai-studio-page">
      {/* Ambient background glow elements */}
      <div className="ambient-glow-top-left" />
      <div className="ambient-glow-top-right" />

      {/* Header with Ambient Gradient Eyebrow */}
      <motion.header
        className="ai-studio-header"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="ai-studio-eyebrow">
          <Sparkles className="ai-sparkle-icon" size={15} />
          <span>SOCIALFEED AI STUDIO</span>
        </div>
        <h1>Research Assistant & Fact-Checker</h1>
        <p className="ai-studio-subtitle">
          Connect what people on SocialFeed are saying with live facts from the web.
          Watch the AI research, cross-reference, and self-correct with full human approval.
        </p>
      </motion.header>

      {/* Modern Floating Command Bar */}
      <motion.form
        className="ai-studio-query-card"
        onSubmit={handleStartResearch}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={cardTransition}
        layout
      >
        <label htmlFor="ai-studio-input" className="ai-studio-label">
          What claim or topic would you like to research?
        </label>
        <div className="ai-studio-input-area">
          <textarea
            id="ai-studio-input"
            ref={textareaRef}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What are you wondering about?..."
            disabled={isLoading}
            maxLength={500}
            rows={1}
            aria-label="What are you wondering about?"
          />
        </div>

        <div className="ai-studio-options-row">
          <label className="ai-studio-checkbox-label">
            <input
              type="checkbox"
              checked={wantImage}
              onChange={(e) => setWantImage(e.target.checked)}
              disabled={isLoading}
              aria-label="Generate Photo"
            />
            <span className="checkbox-custom-indicator" />
            <span className="checkbox-label-text">Generate Photo</span>
          </label>
          <motion.button
            type="submit"
            className="ai-studio-submit-btn"
            disabled={isLoading || !(typeof searchInput === 'string' && searchInput.trim())}
            whileHover={!isLoading && (typeof searchInput === 'string' && searchInput.trim()) ? { scale: 1.02 } : {}}
            whileTap={!isLoading && (typeof searchInput === 'string' && searchInput.trim()) ? { scale: 0.98 } : {}}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          >
            {isLoading ? (
              <span className="btn-loading-flex">
                <span className="btn-spinner" />
                <span>Researching...</span>
              </span>
            ) : (
              'Start Research'
            )}
          </motion.button>
        </div>
      </motion.form>

      {/* Error / Rate Limit Alert */}
      {error && (
        <motion.div
          className="ai-studio-error-banner"
          role="alert"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
        </motion.div>
      )}

      {/* Dynamic Next-Gen Execution Stepper */}
      {(isLoading || comparisonData) && (
        <motion.section
          className="ai-stepper-container"
          aria-label="Research Progress"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={cardTransition}
          layout
        >
          <div className="ai-stepper-header">
            <h3>Agent Execution Stepper</h3>
            <span className="ai-stepper-status-badge">{statusText}</span>
          </div>

          {/* Dynamic Next-Gen Animated Status Pill */}
          <div className="ai-status-pill-card">
            <div className="status-pill-glow-orb" />
            <div className="status-pill-inner">
              <div className="status-pill-indicator">
                {isLoading ? (
                  <span className="status-pill-pulse-dot" />
                ) : (
                  <CheckCircle2 size={16} className="status-pill-check-icon" />
                )}
              </div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={statusText || (isLoading ? 'researching' : 'done')}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="status-pill-text-wrapper"
                >
                  <span className="status-pill-live-text">{statusText || 'Ready'}</span>
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="status-pill-track">
              <motion.div
                className="status-pill-fill"
                initial={{ width: '0%' }}
                animate={{
                  width: `${Math.min(100, Math.max(6, (completedSteps.size / (DEFAULT_STEPS.length - 1)) * 100))}%`
                }}
                transition={{ type: 'spring', damping: 22, stiffness: 120 }}
              />
            </div>
          </div>

          {/* Desktop Stepper: Single Row */}
          <div className="stepper-desktop-row" aria-label="Desktop Stepper">
            <div className="stepper-track-bg" />
            <motion.div
              className="stepper-track-fill"
              initial={{ width: '0%' }}
              animate={{
                width: `${Math.min(100, Math.max(0, (completedSteps.size / (DEFAULT_STEPS.length - 1)) * 100))}%`
              }}
              transition={{ type: 'spring', damping: 22, stiffness: 120 }}
            />
            {DEFAULT_STEPS.map((step, idx) => {
              const isCompleted = completedSteps.has(step.id);
              const isCurrent = currentStepId === step.id && isLoading;
              let stepClass = 'mini-step pending';
              if (isCompleted) stepClass = 'mini-step completed';
              if (isCurrent) stepClass = 'mini-step active';

              return (
                <div key={step.id} className={stepClass}>
                  <div className="mini-step-dot" title={step.fullLabel || step.label}>
                    {isCompleted ? '✓' : isCurrent ? '●' : idx + 1}
                  </div>
                  <span className="mini-step-label">{step.label}</span>
                </div>
              );
            })}
          </div>

          {/* Mobile Stepper: Compact Single-Line Progress Bar */}
          <div className="stepper-mobile-view" aria-label="Mobile Stepper">
            <div className="stepper-mobile-header">
              <span className="stepper-mobile-step-title">
                {currentStepId ? (
                  <>
                    Step {Math.max(1, DEFAULT_STEPS.findIndex(s => s.id === currentStepId) + 1)} of 6: {' '}
                    <strong>{DEFAULT_STEPS.find(s => s.id === currentStepId)?.label || 'Researching'}</strong>
                  </>
                ) : (
                  'Step 1 of 6: 1. Community'
                )}
              </span>
              <span className="stepper-mobile-pct">
                {Math.round((completedSteps.size / DEFAULT_STEPS.length) * 100)}%
              </span>
            </div>
            <div className="stepper-mobile-progress-track">
              <div
                className="stepper-mobile-progress-fill"
                style={{ width: `${(completedSteps.size / DEFAULT_STEPS.length) * 100}%` }}
              />
            </div>
            {statusText && <div className="stepper-mobile-status-text">{statusText}</div>}
          </div>

          {/* Self-Correction Wow Moment Badge */}
          {critiqueWarning && (
            <motion.div
              className="ai-self-correction-banner"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
            >
              <span className="badge-icon">🔄</span>
              <div>
                <strong>Editor AI Visible Self-Correction:</strong>
                <p>"{critiqueWarning}" — Rewriting draft to ensure balance and factual rigor.</p>
              </div>
            </motion.div>
          )}
        </motion.section>
      )}

      {/* Community vs. Reality Card */}
      {comparisonData && (
        <motion.section
          className="ai-comparison-card"
          aria-label="Community vs Reality"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={cardTransition}
          layout
        >
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
                <p className="summary-paragraph">{comparisonData.community_summary || 'No direct community discussions found on this topic.'}</p>
                {comparisonData.internal_docs && comparisonData.internal_docs.length > 0 && (
                  <div className="sources-list">
                    <span className="sources-title">Key SocialFeed Posts:</span>
                    {comparisonData.internal_docs.map((doc, idx) => (
                      <div key={idx} className="source-item internal-source">
                        <span className="source-author">@{doc.author || 'member'}:</span>
                        <span className="source-snippet">"{doc.caption ? (doc.caption.length > 120 ? doc.caption.slice(0, 120) + '...' : doc.caption) : 'Post'}"</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Web Sources */}
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
        </motion.section>
      )}

      {/* Post Editor & Approval Box */}
      {comparisonData && publishStatus !== 'published' && publishStatus !== 'cancelled' && (
        <motion.section
          className="ai-publish-box"
          aria-label="Post Drafting & Human Approval"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={cardTransition}
          layout
        >
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

          {/* Media Selection Section */}
          <div className="ai-media-selection-section" aria-label="Media Selection">
            <div className="media-section-header">
              <div className="media-title-group">
                <span className="media-header-icon">🖼️</span>
                <div>
                  <h4 className="media-header-title">Post Visual Attachment (Optional)</h4>
                  <p className="media-header-subtitle">
                    Select your preferred visual, upload from your device, or publish as text-only.
                  </p>
                </div>
              </div>
              <div className="media-header-actions">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleDeviceUpload}
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  style={{ display: 'none' }}
                  aria-label="Upload image from device"
                />
                <button
                  type="button"
                  className="upload-device-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingCustom || publishStatus === 'publishing'}
                >
                  {isUploadingCustom ? 'Uploading...' : '📁 Upload from Device'}
                </button>
                {selectedImage && (
                  <button
                    type="button"
                    className="remove-visual-btn"
                    onClick={() => setSelectedImage(null)}
                    disabled={publishStatus === 'publishing'}
                  >
                    ✕ Remove Visual (Text-Only)
                  </button>
                )}
              </div>
            </div>

            {/* Split-Screen Visual Cards */}
            {(aiImageUrl || webImageUrl || customImageUrl) ? (
              <motion.div
                className="media-split-grid"
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
              >
                {/* Left: AI Generated Visual */}
                {aiImageUrl && (
                  <motion.div
                    variants={staggerItem}
                    whileHover={{ y: -3, scale: 1.01 }}
                    transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                    className={`media-option-card ${selectedImage === aiImageUrl ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedImage(aiImageUrl);
                      setCrop({ x: 0, y: 0 });
                      setZoom(1);
                      setCroppedAreaPixels(null);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setSelectedImage(aiImageUrl);
                        setCrop({ x: 0, y: 0 });
                        setZoom(1);
                        setCroppedAreaPixels(null);
                      }
                    }}
                    aria-label="Select AI Generated Visual"
                  >
                    <div className="media-card-badge">
                      <span className="badge-tag ai-tag">✨ AI Generated Visual</span>
                      <span className="badge-status">
                        {selectedImage === aiImageUrl ? '✓ Selected' : 'Select'}
                      </span>
                    </div>
                    <img src={aiImageUrl} alt="AI Generated Concept" className="media-preview-img" />
                  </motion.div>
                )}

                {/* Right: Web-Sourced Visual */}
                {webImageUrl && (
                  <motion.div
                    variants={staggerItem}
                    whileHover={{ y: -3, scale: 1.01 }}
                    transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                    className={`media-option-card ${selectedImage === webImageUrl ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedImage(webImageUrl);
                      setCrop({ x: 0, y: 0 });
                      setZoom(1);
                      setCroppedAreaPixels(null);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setSelectedImage(webImageUrl);
                        setCrop({ x: 0, y: 0 });
                        setZoom(1);
                        setCroppedAreaPixels(null);
                      }
                    }}
                    aria-label="Select Web-Sourced Visual"
                  >
                    <div className="media-card-badge">
                      <span className="badge-tag web-tag">🌐 Web-Sourced Visual</span>
                      <span className="badge-status">
                        {selectedImage === webImageUrl ? '✓ Selected' : 'Select'}
                      </span>
                    </div>
                    <img src={webImageUrl} alt="Web Sourced Reference" className="media-preview-img" />
                  </motion.div>
                )}

                {/* Custom Device Upload (if present) */}
                {customImageUrl && (
                  <motion.div
                    variants={staggerItem}
                    whileHover={{ y: -3, scale: 1.01 }}
                    transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                    className={`media-option-card ${selectedImage === customImageUrl ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedImage(customImageUrl);
                      setCrop({ x: 0, y: 0 });
                      setZoom(1);
                      setCroppedAreaPixels(null);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setSelectedImage(customImageUrl);
                        setCrop({ x: 0, y: 0 });
                        setZoom(1);
                        setCroppedAreaPixels(null);
                      }
                    }}
                    aria-label="Select Device Uploaded Visual"
                  >
                    <div className="media-card-badge">
                      <span className="badge-tag custom-tag">📱 Device Upload</span>
                      <span className="badge-status">
                        {selectedImage === customImageUrl ? '✓ Selected' : 'Select'}
                      </span>
                    </div>
                    <img src={customImageUrl} alt="Device Upload Preview" className="media-preview-img" />
                  </motion.div>
                )}
              </motion.div>
            ) : null}

            {/* Interactive Crop & Framing Workspace with Floating Glass Toolbar */}
            <AnimatePresence>
              {selectedImage && (
                <motion.div
                  className="crop-preview-wrapper"
                  aria-label="Image Cropping Workspace"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 16 }}
                  transition={cardTransition}
                  layout
                >
                  <div className="crop-preview-header">
                    <div className="crop-header-left">
                      <span className="crop-header-title">📐 Adjust Framing & Zoom</span>
                      <span className="crop-header-desc">
                        Drag to position and adjust framing before publishing.
                      </span>
                    </div>
                  </div>

                  <div className="crop-viewport-container">
                    <Cropper
                      image={selectedImage}
                      crop={crop}
                      zoom={zoom}
                      aspect={aspect}
                      onCropChange={setCrop}
                      onZoomChange={setZoom}
                      onCropComplete={(croppedArea, pixels) => setCroppedAreaPixels(pixels)}
                      showGrid={true}
                    />

                    {/* Sleek Floating Glass Toolbar Overlay */}
                    <div className="crop-floating-toolbar" aria-label="Cropper Controls Toolbar">
                      <div className="crop-aspect-buttons">
                        <button
                          type="button"
                          className={`aspect-btn ${aspect === 1 ? 'active' : ''}`}
                          onClick={() => setAspect(1)}
                        >
                          1:1 Square
                        </button>
                        <button
                          type="button"
                          className={`aspect-btn ${aspect === 4 / 3 ? 'active' : ''}`}
                          onClick={() => setAspect(4 / 3)}
                        >
                          4:3 Classic
                        </button>
                        <button
                          type="button"
                          className={`aspect-btn ${aspect === 16 / 9 ? 'active' : ''}`}
                          onClick={() => setAspect(16 / 9)}
                        >
                          16:9 Wide
                        </button>
                      </div>

                      <div className="crop-controls-row">
                        <div className="zoom-slider-group">
                          <label htmlFor="crop-zoom-slider">Zoom:</label>
                          <input
                            id="crop-zoom-slider"
                            type="range"
                            min={1}
                            max={3}
                            step={0.05}
                            value={zoom}
                            onChange={(e) => setZoom(Number(e.target.value))}
                            aria-label="Zoom Image"
                          />
                          <span className="zoom-value">{zoom.toFixed(1)}x</span>
                        </div>
                        <button
                          type="button"
                          className="reset-framing-btn"
                          onClick={() => {
                            setCrop({ x: 0, y: 0 });
                            setZoom(1);
                          }}
                        >
                          Reset Framing
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!selectedImage && (
              <div className="text-only-notice">
                ℹ️ <strong>Text-only post:</strong> No visual is currently selected. This post will be published to the feed without an image.
              </div>
            )}
          </div>

          <div className="publish-actions-row">
            <motion.button
              type="button"
              className="approve-publish-btn"
              onClick={handleApprove}
              disabled={publishStatus === 'publishing' || !editedPost.trim()}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            >
              {publishStatus === 'publishing' ? 'Publishing to Feed...' : '✓ Approve & Publish to Feed'}
            </motion.button>
            <motion.button
              type="button"
              className="cancel-btn"
              onClick={handleCancel}
              disabled={publishStatus === 'publishing'}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              Cancel
            </motion.button>
          </div>
        </motion.section>
      )}

      {/* Published Success Notification */}
      {publishStatus === 'published' && (
        <motion.div
          className="ai-published-banner"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={cardTransition}
        >
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
        </motion.div>
      )}

      {publishStatus === 'cancelled' && (
        <motion.div
          className="ai-cancelled-banner"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={cardTransition}
        >
          <span>Session cancelled. No changes were made to your feed.</span>
          <button type="button" onClick={() => setPublishStatus('idle')}>Start Over</button>
        </motion.div>
      )}
    </main>
  );
};

export default SearchAgentPage;