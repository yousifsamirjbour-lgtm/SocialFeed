import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChatAgentPage from '../ChatAgentPage';

describe('ChatAgentPage Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/chat/attachments')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([])
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });
  });

  it('renders initial ChatAgentPage with header, mode buttons, and empty state', async () => {
    render(<ChatAgentPage navigateToFeed={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /AI STUDIO CHATBOT/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Auto \(Hybrid\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Docs Only/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New Session/i })).toBeInTheDocument();

    expect(screen.getByText(/What would you like to explore\?/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Ask about your documents, live web facts, or anything else\.\.\./i)).toBeInTheDocument();
  });

  it('toggles mode between Auto and Docs Only', async () => {
    render(<ChatAgentPage navigateToFeed={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/AI STUDIO CHATBOT/i)).toBeInTheDocument();
    });

    const docsOnlyBtn = screen.getByRole('button', { name: /Docs Only/i });
    fireEvent.click(docsOnlyBtn);

    expect(docsOnlyBtn).toHaveClass('active');
    expect(screen.getByPlaceholderText(/Ask anything strictly from your attached documents\.\.\./i)).toBeInTheDocument();

    const autoBtn = screen.getByRole('button', { name: /Auto \(Hybrid\)/i });
    fireEvent.click(autoBtn);
    expect(autoBtn).toHaveClass('active');
  });

  it('populates query when clicking a suggestion pill', async () => {
    render(<ChatAgentPage navigateToFeed={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/AI STUDIO CHATBOT/i)).toBeInTheDocument();
    });

    const suggestionBtn = screen.getByText(/Summarize key findings from the uploaded document/i);
    fireEvent.click(suggestionBtn);

    const textarea = screen.getByDisplayValue(/Summarize key findings from the uploaded document/i);
    expect(textarea).toBeInTheDocument();
  });

  it('consumes SSE stream and renders assistant response with document citations and source badge', async () => {
    const sseChunks = [
      'event: step\ndata: {"name": "route_mode", "status": "Checking document attachments..."}\n\n',
      'event: step\ndata: {"name": "retrieve_docs", "status": "Found 2 matching excerpt(s)..."}\n\n',
      'event: answer\ndata: {"answer": "**Key Findings:**\\n- Revenue grew by 25%\\n- Operating margin expanded", "sources_used": "Documents", "citations": [{"type": "document", "filename": "financials.pdf", "page": 3}], "mode": "docs_only"}\n\n',
      'event: complete\ndata: {"status": "done"}\n\n'
    ];

    const encoder = new TextEncoder();
    let chunkIndex = 0;

    const mockReader = {
      read: vi.fn().mockImplementation(() => {
        if (chunkIndex < sseChunks.length) {
          const chunk = encoder.encode(sseChunks[chunkIndex++]);
          return Promise.resolve({ value: chunk, done: false });
        }
        return Promise.resolve({ value: undefined, done: true });
      })
    };

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/chat/attachments')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { filename: 'financials.pdf', chunk_count: 5, uploaded_at: '2026-10-15T12:00:00Z' }
          ])
        });
      }
      if (url.includes('/chat/stream')) {
        return Promise.resolve({
          ok: true,
          body: {
            getReader: () => mockReader
          }
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<ChatAgentPage navigateToFeed={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('financials.pdf')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/Ask about your documents, live web facts, or anything else\.\.\./i);
    fireEvent.change(textarea, { target: { value: 'Summarize financial performance' } });

    const sendBtn = screen.getByRole('button', { name: /Send query/i });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(screen.getByText(/Key Findings:/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/financials.pdf \(p\. 3\)/i)).toBeInTheDocument();
    expect(screen.getByText('Documents')).toBeInTheDocument();

    // Test Read Aloud Toggle
    const speakBtn = screen.getByRole('button', { name: /Read aloud/i });
    expect(speakBtn).toBeInTheDocument();
    fireEvent.click(speakBtn);

    // Stop speaking
    fireEvent.click(speakBtn);
  });

  it('renders microphone button and allows triggering dictation mode', async () => {
    render(<ChatAgentPage navigateToFeed={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /AI STUDIO CHATBOT/i })).toBeInTheDocument();
    });

    const micBtn = screen.getByRole('button', { name: /Record voice query/i });
    expect(micBtn).toBeInTheDocument();
  });
});
