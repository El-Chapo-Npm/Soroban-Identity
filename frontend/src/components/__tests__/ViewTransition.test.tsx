import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, it, expect } from 'vitest';
import ViewTransition from '../ViewTransition';

describe('ViewTransition', () => {
  it('renders children correctly', () => {
    render(
      <ViewTransition viewKey="tab-identity">
        <div data-testid="child-content">Identity Content</div>
      </ViewTransition>,
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.getByText('Identity Content')).toBeInTheDocument();
  });

  it('applies the container and caller classes and exposes the view key', () => {
    render(
      <ViewTransition viewKey="tab-credentials" className="custom-class">
        <div>Content</div>
      </ViewTransition>,
    );

    const wrapper = screen.getByTestId('view-transition-wrapper');
    expect(wrapper).toHaveClass('view-transition-container');
    expect(wrapper).toHaveClass('custom-class');
    expect(wrapper).toHaveAttribute('data-view-key', 'tab-credentials');
  });

  it('updates the view key when the route changes', () => {
    const { rerender } = render(
      <ViewTransition viewKey="view-1">
        <div>View 1</div>
      </ViewTransition>,
    );

    expect(screen.getByTestId('view-transition-wrapper')).toHaveAttribute('data-view-key', 'view-1');

    rerender(
      <ViewTransition viewKey="view-2">
        <div>View 2</div>
      </ViewTransition>,
    );

    expect(screen.getByTestId('view-transition-wrapper')).toHaveAttribute('data-view-key', 'view-2');
    expect(screen.getByText('View 2')).toBeInTheDocument();
  });
});
