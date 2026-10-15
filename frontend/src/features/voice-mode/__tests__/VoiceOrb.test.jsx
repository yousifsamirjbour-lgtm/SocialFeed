import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import VoiceOrb from '../VoiceOrb';

describe('VoiceOrb Component', () => {
  it('renders with idle state class by default', () => {
    const { container } = render(<VoiceOrb voiceState="idle" amplitude={0} />);
    const orb = container.querySelector('.voice-orb-container');
    expect(orb).toHaveClass('state-idle');
  });

  it('renders listening and user_speaking states', () => {
    const { container, rerender } = render(<VoiceOrb voiceState="listening" amplitude={0} />);
    expect(container.querySelector('.voice-orb-container')).toHaveClass('state-listening');

    rerender(<VoiceOrb voiceState="user_speaking" amplitude={0.5} />);
    expect(container.querySelector('.voice-orb-container')).toHaveClass('state-user_speaking');
  });

  it('renders thinking state with orbital spinner dots', () => {
    const { container } = render(<VoiceOrb voiceState="thinking" amplitude={0} />);
    expect(container.querySelector('.voice-orb-container')).toHaveClass('state-thinking');
    expect(container.querySelector('.voice-orb-spinner')).toBeInTheDocument();
  });

  it('renders assistant_speaking state', () => {
    const { container } = render(<VoiceOrb voiceState="assistant_speaking" amplitude={0.2} />);
    expect(container.querySelector('.voice-orb-container')).toHaveClass('state-assistant_speaking');
    expect(container.querySelector('.voice-orb-spinner')).toBeNull();
  });
});
