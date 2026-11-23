import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../styles/transitions.css';

export interface ViewTransitionProps {
  viewKey: string;
  children: React.ReactNode;
  className?: string;
}

const FADE_SLIDE = {
  initial: { opacity: 0, y: 12 },
  enter: { opacity: 1, y: 0 },
};

/**
 * Animates route-like tab changes with a Framer Motion fade/slide. Keying the
 * element by `viewKey` remounts it on navigation so the enter animation runs
 * for each new view. Users who prefer reduced motion get an instant swap.
 */
export default function ViewTransition({ viewKey, children, className = '' }: ViewTransitionProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      key={viewKey}
      data-view-key={viewKey}
      data-testid="view-transition-wrapper"
      className={['view-transition-container', className].filter(Boolean).join(' ')}
      initial={prefersReducedMotion ? false : 'initial'}
      animate={prefersReducedMotion ? undefined : 'enter'}
      variants={FADE_SLIDE}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
