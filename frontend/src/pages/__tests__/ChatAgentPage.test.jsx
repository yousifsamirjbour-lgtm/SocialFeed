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
      expect(screen.getByText(/AI STUDIO CHATBOT/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Hybrid RAG & Research Assistant/i)).toBeInTheDocument();
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
});
