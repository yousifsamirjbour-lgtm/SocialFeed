import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SearchAgentPage from '../SearchAgentPage';

describe('SearchAgentPage (AI Studio)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const createMockSseStream = (events) => {
    const streamText = events
      .map(e => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
      .join('');
    
    const encoder = new TextEncoder();
    const uint8Array = encoder.encode(streamText);

    return new ReadableStream({
      start(controller) {
        controller.enqueue(uint8Array);
        controller.close();
      }
    });
  };

  it('renders initial idle AI Studio state with input and cost protection badge', () => {
    render(<SearchAgentPage />);

    expect(screen.getByText('Research Assistant & Fact-Checker')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Is Python or JavaScript better for beginners in 2026/i)).toBeInTheDocument();
    expect(screen.getByText('$0.00 Free Tier Protected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Research' })).toBeDisabled();
  });

  it('enables Start Research button when query is entered and updates input', () => {
    render(<SearchAgentPage />);

    const input = screen.getByPlaceholderText(/Is Python or JavaScript better for beginners in 2026/i);
    fireEvent.change(input, { target: { value: 'Is Earth flat or round?' } });

    const submitBtn = screen.getByRole('button', { name: 'Start Research' });
    expect(submitBtn).toBeEnabled();
  });

  it('consumes SSE stream, shows stepper, self-correction, and renders Community vs Reality card', async () => {
    const mockEvents = [
      {
        event: 'step',
        data: { name: 'retrieve_internal', status: 'Reading what people on SocialFeed said about this...' }
      },
      {
        event: 'step',
        data: {
          name: 'critique',
          status: 'Self-Correction: Editor AI requested revisions (iteration 1/2). Rewriting...',
          warning: true,
          partial: { critique_feedback: 'Include specific citations for claims.' }
        }
      },
      {
        event: 'approval_ready',
        data: {
          thread_id: 'test-thread-123',
          query: 'Quantum Computing facts',
          community_summary: 'Community members discussed quantum supremacy.',
          web_summary: 'Verified research from [Qiskit Docs](https://qiskit.org).',
          verdict: 'Verified / True',
          draft_post: 'Quantum computing is rapidly advancing in 2026.',
          image_url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
          internal_docs: [{ author: 'Alice', caption: 'Quantum algorithms are exciting' }],
          web_docs: [{ title: 'Qiskit Docs', url: 'https://qiskit.org' }]
        }
      },
      {
        event: 'complete',
        data: { thread_id: 'test-thread-123', status: 'ready_for_approval' }
      }
    ];

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: createMockSseStream(mockEvents)
    }));

    render(<SearchAgentPage initialQuery="Quantum Computing" />);

    const submitBtn = screen.getByRole('button', { name: 'Start Research' });
    fireEvent.click(submitBtn);

    // Verify stepper rendered
    await waitFor(() => {
      expect(screen.getByText('Agent Execution Stepper')).toBeInTheDocument();
    });

    // Verify self-correction visible notice
    await waitFor(() => {
      expect(screen.getByText(/Editor AI Visible Self-Correction/i)).toBeInTheDocument();
      expect(screen.getByText(/Include specific citations for claims/i)).toBeInTheDocument();
    });

    // Verify Community vs. Reality Card
    await waitFor(() => {
      expect(screen.getByText('EVIDENCE VERDICT:')).toBeInTheDocument();
      expect(screen.getByText('Verified / True')).toBeInTheDocument();
      expect(screen.getByText(/Community members discussed quantum supremacy/i)).toBeInTheDocument();
      expect(screen.getByText(/Qiskit Docs/i)).toBeInTheDocument();
    });

    // Verify markdown link has security attributes
    const link = screen.getByRole('link', { name: /Qiskit Docs/i });
    expect(link).toHaveAttribute('href', 'https://qiskit.org');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    // Verify draft editor and approve button
    const textarea = screen.getByLabelText(/Post Caption \(Editable\)/i);
    expect(textarea).toHaveValue('Quantum computing is rapidly advancing in 2026.');
    expect(screen.getByRole('button', { name: /✓ Approve & Publish to Feed/i })).toBeInTheDocument();
  });

  it('submits human approval and renders publication success banner', async () => {
    const mockEvents = [
      {
        event: 'approval_ready',
        data: {
          thread_id: 'test-thread-456',
          query: 'AI Progress',
          community_summary: 'Community summary text',
          web_summary: 'Web summary text',
          verdict: 'Mixed / Nuanced',
          draft_post: 'Initial AI draft text',
          image_url: null,
          internal_docs: [],
          web_docs: []
        }
      }
    ];

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        body: createMockSseStream(mockEvents)
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Post published successfully!', post_id: 'new-post-id' })
      });

    vi.stubGlobal('fetch', fetchMock);

    const onPostPublished = vi.fn();
    render(<SearchAgentPage initialQuery="AI Progress" onPostPublished={onPostPublished} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start Research' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /✓ Approve & Publish to Feed/i })).toBeInTheDocument();
    });

    // Edit the text before approval
    const textarea = screen.getByLabelText(/Post Caption \(Editable\)/i);
    fireEvent.change(textarea, { target: { value: 'User edited final verified post.' } });

    // Click Approve & Publish
    fireEvent.click(screen.getByRole('button', { name: /✓ Approve & Publish to Feed/i }));

    await waitFor(() => {
      expect(screen.getByText('Post Successfully Published to Feed!')).toBeInTheDocument();
    });

    expect(onPostPublished).toHaveBeenCalled();
  });

  it('displays rate-limit error banner when response is 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ detail: 'You have reached your limit of 5 AI research queries per hour.' })
    }));

    render(<SearchAgentPage initialQuery="Rate limit query" />);

    fireEvent.click(screen.getByRole('button', { name: 'Start Research' }));

    await waitFor(() => {
      expect(screen.getByText(/limit of 5 AI research queries per hour/i)).toBeInTheDocument();
    });
  });

  it('gracefully handles non-string initialQuery (e.g. SyntheticEvent) without throwing or crashing', () => {
    const mockSyntheticEvent = { target: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    expect(() => {
      render(<SearchAgentPage initialQuery={mockSyntheticEvent} />);
    }).not.toThrow();

    const input = screen.getByPlaceholderText(/Is Python or JavaScript better for beginners in 2026/i);
    expect(input.value).toBe('');
    expect(screen.getByRole('button', { name: 'Start Research' })).toBeDisabled();
  });

  it('renders split-screen AI and Web media cards and allows user selection, device upload, and text-only removal', async () => {
    const mockEvents = [
      {
        event: 'approval_ready',
        data: {
          thread_id: 'thread-media-split',
          query: 'Mbappe vs Yamal',
          community_summary: 'Community discussions.',
          web_summary: 'Web citations.',
          verdict: 'Mixed / Nuanced',
          draft_post: 'Football comparison 2026.',
          ai_image_url: 'https://res.cloudinary.com/test/ai_generated.jpg',
          web_image_url: 'https://res.cloudinary.com/test/web_sourced.jpg',
          internal_docs: [],
          web_docs: []
        }
      }
    ];

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        body: createMockSseStream(mockEvents)
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ image_url: 'https://res.cloudinary.com/test/device_custom.jpg' })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Post published successfully!', post_id: 'post-123' })
      });

    vi.stubGlobal('fetch', fetchMock);

    render(<SearchAgentPage initialQuery="Mbappe vs Yamal" />);
    fireEvent.click(screen.getByRole('button', { name: 'Start Research' }));

    // 1. Verify both cards render
    await waitFor(() => {
      expect(screen.getByText('✨ AI Generated Visual')).toBeInTheDocument();
      expect(screen.getByText('🌐 Web-Sourced Visual')).toBeInTheDocument();
      expect(screen.getByText('📁 Upload from Device')).toBeInTheDocument();
    });

    // 2. Select Web-sourced visual
    const webCard = screen.getByLabelText('Select Web-Sourced Visual');
    fireEvent.click(webCard);
    expect(webCard).toHaveClass('selected');

    // 3. Click remove visual (text-only)
    const removeBtn = screen.getByRole('button', { name: /Remove Visual \(Text-Only\)/i });
    fireEvent.click(removeBtn);
    expect(screen.getByText(/Text-only post:/i)).toBeInTheDocument();

    // 4. Test upload from device
    const fileInput = screen.getByLabelText('Upload image from device');
    const fakeFile = new File(['fake-png-content'], 'phone_photo.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [fakeFile] } });

    await waitFor(() => {
      expect(screen.getByText('📱 Device Upload')).toBeInTheDocument();
    });

    // 5. Approve & Publish
    fireEvent.click(screen.getByRole('button', { name: /✓ Approve & Publish to Feed/i }));
    await waitFor(() => {
      expect(screen.getByText('Post Successfully Published to Feed!')).toBeInTheDocument();
    });
  });
});

