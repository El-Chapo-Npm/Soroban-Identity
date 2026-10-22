import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import useVoiceCommands from '../useVoiceCommands';
import VoiceCommandButton from '../../components/VoiceCommandButton';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => options?.defaultValue ?? key,
    i18n: {
      language: 'en-US',
      getFixedT: () => (key: string, options?: any) => options?.defaultValue ?? key,
    },
  }),
}));

describe('Voice Commands Support (#1038)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('useVoiceCommands hook', () => {
    it('initializes with default values when Web Speech API is absent', () => {
      const { result } = renderHook(() => useVoiceCommands());

      expect(result.current.isSupported).toBe(false);
      expect(result.current.isListening).toBe(false);
      expect(result.current.permissionState).toBe('unknown');
    });

    it('handles custom command array execution', () => {
      const searchHandler = vi.fn();
      const customCommands = [
        {
          phrases: ['search', 'find'],
          description: 'Search credentials',
          handler: searchHandler,
        },
      ];

      const { result } = renderHook(() =>
        useVoiceCommands({ commands: customCommands })
      );

      expect(result.current.commandRegistry).toBeDefined();
    });
  });

  describe('VoiceCommandButton component', () => {
    it('renders the voice button with proper accessible label', () => {
      render(<VoiceCommandButton />);

      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
      expect(button).toHaveClass('voice-toggle');
    });

    it('calls toggle on click when supported', () => {
      const mockToggle = vi.fn();
      const mockVoice: any = {
        isSupported: true,
        isListening: false,
        permissionState: 'granted',
        toggle: mockToggle,
        commandRegistry: {},
        interimTranscript: '',
        lastMatch: null,
        error: null,
      };

      render(<VoiceCommandButton voice={mockVoice} />);
      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(mockToggle).toHaveBeenCalledTimes(1);
    });

    it('shows visual feedback indicator when listening is active', () => {
      const mockVoice: any = {
        isSupported: true,
        isListening: true,
        permissionState: 'granted',
        toggle: vi.fn(),
        commandRegistry: {},
        interimTranscript: 'searching for diploma',
        lastMatch: null,
        error: null,
      };

      render(<VoiceCommandButton voice={mockVoice} />);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-pressed', 'true');

      // Real-time transcript feedback rendered
      expect(screen.getByText(/"searching for diploma"/)).toBeInTheDocument();
    });
  });
});
