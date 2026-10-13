import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SearchAgentPage from '../SearchAgentPage';

describe('SearchAgentPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders search form in initial idle state', () => {
    render(<SearchAgentPage />);

    expect(screen.getByText('Search the web')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ask a question or enter a topic')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  });

  it('displays loading state and successfully renders search response with Markdown', async () => {
    const fakeResponse = { response: 'Here is info with [Docs](https://docs.com).' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeResponse
    }));

    render(<SearchAgentPage />);

    const input = screen.getByPlaceholderText('Ask a question or enter a topic');
    fireEvent.change(input, { target: { value: 'quantum computing' } });

    const searchBtn = screen.getByRole('button', { name: 'Search' });
    expect(searchBtn).toBeEnabled();
    fireEvent.click(searchBtn);

    // Verify loading status
    expect(screen.getByText('Searching the web...')).toBeInTheDocument();

    // Verify rendered markdown result and link attributes
    await waitFor(() => {
      expect(screen.getByText('Docs')).toBeInTheDocument();
    });

    const link = screen.getByRole('link', { name: 'Docs' });
    expect(link).toHaveAttribute('href', 'https://docs.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('displays error state when search request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ detail: 'AI model temporarily unavailable' })
    }));

    render(<SearchAgentPage />);

    const input = screen.getByPlaceholderText('Ask a question or enter a topic');
    fireEvent.change(input, { target: { value: 'failing query' } });

    const searchBtn = screen.getByRole('button', { name: 'Search' });
    fireEvent.click(searchBtn);

    await waitFor(() => {
      expect(screen.getByText('AI model temporarily unavailable')).toBeInTheDocument();
    });
  });
});
