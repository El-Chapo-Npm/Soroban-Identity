import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useKeyboardShortcuts, useSequentialShortcuts, formatShortcut, getModifierKey } from './useKeyboardShortcuts';

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should trigger handler when matching key is pressed', () => {
    const handler = vi.fn();
    
    renderHook(() =>
      useKeyboardShortcuts({
        shortcuts: [
          {
            key: 'k',
            ctrl: true,
            description: 'Test shortcut',
            category: 'actions',
            handler,
          },
        ],
      })
    );

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })
      );
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should not trigger handler when ctrl modifier is missing', () => {
    const handler = vi.fn();
    
    renderHook(() =>
      useKeyboardShortcuts({
        shortcuts: [
          {
            key: 'k',
            ctrl: true,
            description: 'Test shortcut',
            category: 'actions',
            handler,
          },
        ],
      })
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should work with shift modifier', () => {
    const handler = vi.fn();
    
    renderHook(() =>
      useKeyboardShortcuts({
        shortcuts: [
          {
            key: 't',
            ctrl: true,
            shift: true,
            description: 'Test shortcut',
            category: 'ui',
            handler,
          },
        ],
      })
    );

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 't', ctrlKey: true, shiftKey: true })
      );
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should not trigger when typing in input element', () => {
    const handler = vi.fn();
    
    renderHook(() =>
      useKeyboardShortcuts({
        shortcuts: [
          {
            key: 'k',
            ctrl: true,
            description: 'Test shortcut',
            category: 'actions',
            handler,
          },
        ],
      })
    );

    const input = document.createElement('input');
    document.body.appendChild(input);

    act(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: input, enumerable: true });
      window.dispatchEvent(event);
    });

    expect(handler).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it('should allow Escape key in input elements', () => {
    const handler = vi.fn();
    
    renderHook(() =>
      useKeyboardShortcuts({
        shortcuts: [
          {
            key: 'Escape',
            description: 'Close',
            category: 'ui',
            handler,
          },
        ],
      })
    );

    const input = document.createElement('input');
    document.body.appendChild(input);

    act(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: input, enumerable: true });
      window.dispatchEvent(event);
    });

    expect(handler).toHaveBeenCalledTimes(1);

    document.body.removeChild(input);
  });

  it('should respect enabled flag', () => {
    const handler = vi.fn();
    
    const { rerender } = renderHook(
      ({ enabled }) =>
        useKeyboardShortcuts({
          enabled,
          shortcuts: [
            {
              key: 'k',
              ctrl: true,
              description: 'Test shortcut',
              category: 'actions',
              handler,
            },
          ],
        }),
      { initialProps: { enabled: false } }
    );

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })
      );
    });

    expect(handler).not.toHaveBeenCalled();

    rerender({ enabled: true });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })
      );
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should respect shortcut enabled flag', () => {
    const handler = vi.fn();
    
    renderHook(() =>
      useKeyboardShortcuts({
        shortcuts: [
          {
            key: 'k',
            ctrl: true,
            description: 'Test shortcut',
            category: 'actions',
            handler,
            enabled: false,
          },
        ],
      })
    );

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })
      );
    });

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('useSequentialShortcuts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should trigger handler for sequential keys', () => {
    const handler = vi.fn();
    
    renderHook(() =>
      useSequentialShortcuts({
        'g,d': handler,
      })
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should reset sequence after timeout', () => {
    const handler = vi.fn();
    
    renderHook(() =>
      useSequentialShortcuts(
        {
          'g,d': handler,
        },
        { timeout: 1000 }
      )
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    });

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should not trigger for wrong sequence', () => {
    const handler = vi.fn();
    
    renderHook(() =>
      useSequentialShortcuts({
        'g,d': handler,
      })
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should ignore modifier keys', () => {
    const handler = vi.fn();
    
    renderHook(() =>
      useSequentialShortcuts({
        'g,d': handler,
      })
    );

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'g', ctrlKey: true })
      );
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    });

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('formatShortcut', () => {
  it('should format single key', () => {
    expect(formatShortcut({ key: 'k' })).toBe('K');
  });

  it('should format ctrl+key', () => {
    const result = formatShortcut({ key: 'k', ctrl: true });
    expect(result).toMatch(/^(Ctrl|Cmd)\+K$/);
  });

  it('should format ctrl+shift+key', () => {
    const result = formatShortcut({ key: 't', ctrl: true, shift: true });
    expect(result).toMatch(/^(Ctrl|Cmd)\+Shift\+T$/);
  });

  it('should format alt+key', () => {
    const result = formatShortcut({ key: 'a', alt: true });
    expect(result).toBe('Alt+A');
  });
});

describe('getModifierKey', () => {
  it('should return Cmd for Mac', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });
    expect(getModifierKey()).toBe('Cmd');
  });

  it('should return Ctrl for Windows', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });
    expect(getModifierKey()).toBe('Ctrl');
  });
});
