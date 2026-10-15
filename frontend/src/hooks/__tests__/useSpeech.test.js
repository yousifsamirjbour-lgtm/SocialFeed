import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { cleanMarkdownForSpeech, chunkTextForTTS, isArabicText, useSpeech } from '../useSpeech';

describe('useSpeech utilities', () => {
  it('cleanMarkdownForSpeech removes markdown syntax for natural speech', () => {
    const rawMarkdown = '# Header\nThis is **bold** text and `inline code`.\n```js\nconst x = 1;\n```\nCheck out [OpenAI](https://openai.com) and > quotes.';
    const cleaned = cleanMarkdownForSpeech(rawMarkdown);

    expect(cleaned).not.toContain('#');
    expect(cleaned).not.toContain('**');
    expect(cleaned).not.toContain('```');
    expect(cleaned).not.toContain('https://openai.com');
    expect(cleaned).toContain('This is bold text and inline code.');
    expect(cleaned).toContain('Check out OpenAI and quotes.');
  });

  it('cleanMarkdownForSpeech strips citations and converts markdown tables naturally', () => {
    const markdownWithTableAndCitations =
      '### AI Policy Summary\n\n' +
      '| Policy | Requirement | Impact |\n' +
      '|---|---|---|\n' +
      '| **Zero Cost** | Must spend exactly $0.00 | Free tier only |\n' +
      '| **Recall** | Achieved 98.4% recall | Zero loss |\n\n' +
      'Here are key findings [company_policy.md, page 1] and another citation 【research_findings.txt, page 1】 (p. 2). ' +
      'Visit [Documentation](https://docs.example.com) or contact support directly.';

    const cleaned = cleanMarkdownForSpeech(markdownWithTableAndCitations);

    expect(cleaned).not.toContain('|');
    expect(cleaned).not.toContain('company_policy.md');
    expect(cleaned).not.toContain('research_findings.txt');
    expect(cleaned).not.toContain('https://docs.example.com');
    expect(cleaned).toContain('98.4% recall');
    expect(cleaned).toContain('Zero Cost. Must spend exactly $0.00. Free tier only');
    expect(cleaned).toContain('Visit Documentation or contact support directly');
  });

  it('chunkTextForTTS strictly chunks all slices to <= 190 characters', () => {
    const longText = 'Artificial intelligence represents a monumental leap in computer science and neural networks. ' +
      'Every sentence in this test must be parsed, cleaned, and partitioned into small chunks that never exceed the strict 190 character threshold required by the Groq Orpheus API endpoint. ' +
      'This guarantees that audio synthesis requests will never trigger 400 Bad Request payload length errors in production.';

    const chunks = chunkTextForTTS(longText, 175);
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(190);
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });

  it('chunkTextForTTS respects Arabic sentence boundaries and questions', () => {
    const arabicText = 'هل تم تحديث واجهة الصوت بنجاح؟ نعم، تم اختبار كل جملة بدقة عالية. وفيما يلي التفاصيل الكاملة للتحديث.';
    const chunks = chunkTextForTTS(arabicText, 60);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toContain('هل تم تحديث واجهة الصوت بنجاح؟');
  });

  it('isArabicText correctly detects Arabic characters', () => {
    expect(isArabicText('Hello world')).toBe(false);
    expect(isArabicText('مرحباً بك في تطبيقنا')).toBe(true);
    expect(isArabicText('Mixed text مع العربية')).toBe(true);
  });
});

describe('useSpeech hook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with default idle state and supports cancelRecording', () => {
    const { result } = renderHook(() => useSpeech('mock-token'));

    expect(result.current.isSpeaking).toBe(false);
    expect(result.current.isRecording).toBe(false);
    expect(result.current.recordingSeconds).toBe(0);

    // Cancel recording when not recording should be safe no-op
    act(() => {
      result.current.cancelRecording();
    });
    expect(result.current.isRecording).toBe(false);
  });
});
