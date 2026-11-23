import { renderHook, act } from '@testing-library/react';
import { useTheme, cycleTheme, getThemeIcon, getThemeLabel } from './useTheme';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
  };
})();

// Mock matchMedia
const mockMatchMedia = (matches: boolean) => {
  return vi.fn().mockImplementation((query) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

describe('useTheme', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    // Default to light mode for system preference
    window.matchMedia = mockMatchMedia(false);
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should default to system theme when no preference is stored', () => {
    const { result } = renderHook(() => useTheme());
    const [theme] = result.current;
    
    expect(theme).toBe('system');
    expect(mockLocalStorage.getItem).toHaveBeenCalledWith('theme-preference');
  });

  it('should load stored theme preference from localStorage', () => {
    mockLocalStorage.getItem.mockReturnValue('dark');
    
    const { result } = renderHook(() => useTheme());
    const [theme] = result.current;
    
    expect(theme).toBe('dark');
  });

  it('should update theme and persist to localStorage', () => {
    const { result } = renderHook(() => useTheme());
    const [, setTheme] = result.current;
    
    act(() => {
      setTheme('light');
    });
    
    const [theme] = result.current;
    expect(theme).toBe('light');
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('theme-preference', 'light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('should apply dark class when theme is dark', () => {
    const { result } = renderHook(() => useTheme());
    const [, setTheme] = result.current;
    
    act(() => {
      setTheme('dark');
    });
    
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('should apply light class when theme is light', () => {
    const { result } = renderHook(() => useTheme());
    const [, setTheme] = result.current;
    
    act(() => {
      setTheme('light');
    });
    
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('should resolve the system theme from matchMedia when returning to system', () => {
    // First set to dark
    const { result } = renderHook(() => useTheme());
    const [, setTheme] = result.current;
    
    act(() => {
      setTheme('dark');
    });
    
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    
    // Then change to system
    act(() => {
      setTheme('system');
    });
    
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('updates the effective theme when the operating system preference changes', () => {
    let listener: (() => void) | undefined;
    const query = {
      matches: false,
      addEventListener: vi.fn((_event: string, callback: () => void) => { listener = callback; }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    window.matchMedia = vi.fn(() => query) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => useTheme());
    expect(result.current[2]).toBe(false);
    act(() => {
      query.matches = true;
      listener?.();
    });
    expect(result.current[2]).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('should set data-theme attribute', () => {
    const { result } = renderHook(() => useTheme());
    const [, setTheme] = result.current;
    
    act(() => {
      setTheme('light');
    });
    
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

describe('cycleTheme', () => {
  it('should cycle from system to light', () => {
    expect(cycleTheme('system')).toBe('light');
  });

  it('should cycle from light to dark', () => {
    expect(cycleTheme('light')).toBe('dark');
  });

  it('should cycle from dark to system', () => {
    expect(cycleTheme('dark')).toBe('system');
  });

  it('should default to system for unknown theme', () => {
    expect(cycleTheme('unknown' as any)).toBe('system');
  });
});

describe('getThemeIcon', () => {
  it('should return sun icon for light theme', () => {
    expect(getThemeIcon('light', false)).toBe('☀');
  });

  it('should return moon icon for dark theme', () => {
    expect(getThemeIcon('dark', true)).toBe('☾');
  });

  it('should return sun icon for system theme when not in dark mode', () => {
    expect(getThemeIcon('system', false)).toBe('☀');
  });

  it('should return moon icon for system theme when in dark mode', () => {
    expect(getThemeIcon('system', true)).toBe('☾');
  });
});

describe('getThemeLabel', () => {
  const mockT = (key: string) => {
    const translations: Record<string, string> = {
      'app.lightMode': 'Light Mode',
      'app.darkMode': 'Dark Mode',
    };
    return translations[key] || key;
  };

  it('should return light mode label for light theme', () => {
    expect(getThemeLabel('light', false, mockT)).toBe('Light Mode');
  });

  it('should return dark mode label for dark theme', () => {
    expect(getThemeLabel('dark', true, mockT)).toBe('Dark Mode');
  });

  it('should return light mode label for system theme when not in dark mode', () => {
    expect(getThemeLabel('system', false, mockT)).toBe('Light Mode');
  });

  it('should return dark mode label for system theme when in dark mode', () => {
    expect(getThemeLabel('system', true, mockT)).toBe('Dark Mode');
  });
});
