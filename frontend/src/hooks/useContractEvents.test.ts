import { renderHook } from '@testing-library/react';
import { useContractEvents } from './useContractEvents';

describe('useContractEvents', () => {
  let mockEventSourceInstances: any[] = [];

  class MockEventSource {
    url: string;
    listeners: Record<string, Function[]> = {};
    closed = false;

    constructor(url: string) {
      this.url = url;
      mockEventSourceInstances.push(this);
    }

    addEventListener(event: string, handler: Function) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(handler);
    }

    removeEventListener(event: string, handler: Function) {
      if (this.listeners[event]) {
        this.listeners[event] = this.listeners[event].filter((h) => h !== handler);
      }
    }

    close() {
      this.closed = true;
    }

    emit(event: string, data?: any) {
      if (this.listeners[event]) {
        this.listeners[event].forEach((h) => h({ data: JSON.stringify(data) }));
      }
    }
  }

  beforeEach(() => {
    mockEventSourceInstances = [];
    (global as any).EventSource = MockEventSource;
  });

  afterEach(() => {
    delete (global as any).EventSource;
  });

  it('closes SSE connection on unmount', () => {
    const { unmount } = renderHook(() => useContractEvents());
    expect(mockEventSourceInstances.length).toBe(1);
    const instance = mockEventSourceInstances[0];
    expect(instance.closed).toBe(false);

    unmount();
    expect(instance.closed).toBe(true);
  });

  it('closes SSE connection on beforeunload and pagehide events', () => {
    renderHook(() => useContractEvents());
    expect(mockEventSourceInstances.length).toBe(1);
    const instance = mockEventSourceInstances[0];
    expect(instance.closed).toBe(false);

    window.dispatchEvent(new Event('beforeunload'));
    expect(instance.closed).toBe(true);
  });
});
