import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect, vi } from 'vitest';
import ViewTransition from '../ViewTransition';

describe('ViewTransition', () => {
  it('renders children correctly', () => {
    render(
      <ViewTransition viewKey="tab-identity">
        <div data-testid="child-content">Identity Content</div>
      </ViewTransition>
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.getByText('Identity Content')).toBeInTheDocument();
  });

  it('applies view-transition-container and fade-in classes', () => {
    const { container } = render(
      <ViewTransition viewKey="tab-credentials" className="custom-class">
        <div>Content</div>
      </ViewTransition>
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass('view-transition-container');
    expect(wrapper).toHaveClass('fade-in');
    expect(wrapper).toHaveClass('custom-class');
  });

  it('triggers view-transition-enter on viewKey change', () => {
    vi.useFakeTimers();

    const { container, rerender } = render(
      <ViewTransition viewKey="view-1">
        <div>View 1</div>
      </ViewTransition>
    );

    const wrapper1 = container.firstChild as HTMLElement;
    expect(wrapper1).toHaveClass('view-transition-enter');

    act(() => {
      vi.advanceTimersByTime(250);
    });
    // After timeout transition finishes
    expect(wrapper1).not.toHaveClass('view-transition-enter');

    rerender(
      <ViewTransition viewKey="view-2">
        <div>View 2</div>
      </ViewTransition>
    );

    const wrapper2 = container.firstChild as HTMLElement;
    expect(wrapper2).toHaveClass('view-transition-container');

    vi.useRealTimers();
  });
});
