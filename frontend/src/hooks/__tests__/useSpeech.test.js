import { describe, it, expect } from 'vitest';
import { cleanMarkdownForSpeech, chunkTextForTTS, isArabicText } from '../useSpeech';

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

  it('chunkTextForTTS strictly chunks all slices to <= 190 characters', () => {
    const longText = 'Artificial intelligence represents a monumental leap in computer science and neural networks. ' +
      'Every sentence in this test must be parsed, cleaned, and partitioned into small chunks that never exceed the strict 190 character threshold required by the Groq Orpheus API endpoint. ' +
      'This guarantees that audio synthesis requests will never trigger 400 Bad Request payload length errors in production.';

    const chunks = chunkTextForTTS(longText, 185);
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(190);
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });

  it('isArabicText correctly detects Arabic characters', () => {
    expect(isArabicText('Hello world')).toBe(false);
    expect(isArabicText('مرحباً بك في تطبيقنا')).toBe(true);
    expect(isArabicText('Mixed text مع العربية')).toBe(true);
  });
});
