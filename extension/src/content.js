// Content script for the credential verification browser extension.
// Detects credential forms on third-party pages, auto-fills them from
// locally stored credentials, and handles messages from the background
// script (verification results, badge state, etc.).

(function () {
  'use strict';

  if (window.__credVerifyContentScriptLoaded) {
    return;
  }
  window.__credVerifyContentScriptLoaded = true;

  const MESSAGE_SOURCE = 'cred-verify-extension';
  const HIGHLIGHT_CLASS = 'cred-verify-highlight';
  const BADGE_CLASS = 'cred-verify-badge';

  // Heuristics for identifying credential input fields.
  const USERNAME_HINTS = [
    'user',
    'username',
    'email',
    'login',
    'identifier',
    'account',
    'handle',
  ];
  const PASSWORD_HINTS = ['pass', 'pwd', 'secret', 'passwd'];
  const SUBMIT_HINTS = ['login', 'log in', 'sign in', 'signin', 'submit', 'continue'];

  let cachedCredentials = [];
  let autoFillEnabled = true;

  /**
   * Normalize a string for fuzzy matching.
   */
  function normalize(value) {
    return (value || '').toString().trim().toLowerCase();
  }

  /**
   * Determine whether an input element looks like a username/email field.
   */
  function isUsernameField(input) {
    if (!input || input.type === 'password') return false;
    const haystack = [
      input.name,
      input.id,
      input.getAttribute('autocomplete'),
      input.getAttribute('placeholder'),
      input.getAttribute('aria-label'),
    ]
      .map(normalize)
      .join(' ');
    return USERNAME_HINTS.some((hint) => haystack.includes(hint));
  }

  /**
   * Determine whether an input element looks like a password field.
   */
  function isPasswordField(input) {
    if (!input) return false;
    if (input.type === 'password') return true;
    const haystack = [
      input.name,
      input.id,
      input.getAttribute('autocomplete'),
      input.getAttribute('placeholder'),
      input.getAttribute('aria-label'),
    ]
      .map(normalize)
      .join(' ');
    return PASSWORD_HINTS.some((hint) => haystack.includes(hint));
  }

  /**
   * Find the closest form (or container) for a given input.
   */
  function findFormContainer(input) {
    if (!input) return null;
    return input.closest('form') || input.parentElement;
  }

  /**
   * Detect credential forms present on the current page.
   * Returns an array of { form, username, password, submit } descriptors.
   */
  function detectCredentialForms() {
    const forms = [];
    const seen = new Set();
    const passwordInputs = Array.from(document.querySelectorAll('input')).filter(
      isPasswordField
    );

    passwordInputs.forEach((passwordInput) => {
      const container = findFormContainer(passwordInput);
      if (!container || seen.has(container)) return;
      seen.add(container);

      const inputs = Array.from(container.querySelectorAll('input'));
      const usernameInput =
        inputs.find((input) => isUsernameField(input)) ||
        inputs.find(
          (input) =>
            input !== passwordInput &&
            (input.type === 'text' || input.type === 'email')
        ) ||
        null;

      const submit =
        container.querySelector(
          'button[type="submit"], input[type="submit"], button'
        ) || null;

      forms.push({
        form: container,
        username: usernameInput,
        password: passwordInput,
        submit,
      });
    });

    return forms;
  }

  /**
   * Match a credential to the current page based on hostname.
   */
  function matchCredentialForPage(credentials) {
    const host = normalize(window.location.hostname);
    if (!host || !Array.isArray(credentials)) return null;

    const exact = credentials.find((cred) => {
      const credHost = normalize(cred && (cred.host || cred.domain || cred.url));
      return credHost && (host === credHost || host.endsWith('.' + credHost));
    });
    if (exact) return exact;

    // Fall back to a loose match on the registrable-ish name.
    const hostParts = host.split('.');
    const base = hostParts.length > 1 ? hostParts[hostParts.length - 2] : host;
    return (
      credentials.find((cred) => {
        const credHost = normalize(cred && (cred.host || cred.domain || cred.url));
        return credHost && credHost.includes(base);
      }) || null
    );
  }

  /**
   * Set the value of an input in a way that frameworks (React/Vue) notice.
   */
  function setInputValue(input, value) {
    if (!input || value == null) return;
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Auto-fill detected credential forms using the matched credential.
   */
  function autoFillForms() {
    if (!autoFillEnabled) return 0;
    const credential = matchCredentialForPage(cachedCredentials);
    if (!credential) return 0;

    const forms = detectCredentialForms();
    let filled = 0;

    forms.forEach(({ username, password }) => {
      if (username && credential.username) {
        setInputValue(username, credential.username);
        filled += 1;
      }
      if (password && credential.password) {
        setInputValue(password, credential.password);
        filled += 1;
      }
    });

    return filled;
  }

  /**
   * Highlight a form to indicate a verification result.
   */
  function highlightForm(form, status) {
    if (!form) return;
    form.classList.add(HIGHLIGHT_CLASS);
    form.setAttribute('data-cred-verify-status', status || 'unknown');
    window.setTimeout(() => {
      form.classList.remove(HIGHLIGHT_CLASS);
    }, 4000);
  }

  /**
   * Render a small badge near a form with verification status text.
   */
  function renderBadge(form, text, status) {
    if (!form) return;
    let badge = form.querySelector('.' + BADGE_CLASS);
    if (!badge) {
      badge = document.createElement('div');
      badge.className = BADGE_CLASS;
      badge.style.cssText = [
        'position:absolute',
        'z-index:2147483647',
        'padding:2px 6px',
        'border-radius:4px',
        'font-size:11px',
        'font-family:sans-serif',
        'color:#fff',
        'pointer-events:none',
      ].join(';');
      if (getComputedStyle(form).position === 'static') {
        form.style.position = 'relative';
      }
      form.appendChild(badge);
    }
    badge.textContent = text || '';
    badge.style.background =
      status === 'valid' ? '#2e7d32' : status === 'expiring' ? '#ef6c00' : '#c62828';
  }

  /**
   * Handle messages from the background script.
   */
  function handleMessage(message, sender, sendResponse) {
    if (!message || message.source !== MESSAGE_SOURCE) {
      return false;
    }

    switch (message.type) {
      case 'CREDENTIALS_UPDATED': {
        cachedCredentials = Array.isArray(message.credentials)
          ? message.credentials
          : [];
        autoFillEnabled = message.autoFillEnabled !== false;
        const filled = autoFillForms();
        sendResponse({ ok: true, filled });
        return true;
      }

      case 'AUTO_FILL': {
        const filled = autoFillForms();
        sendResponse({ ok: true, filled });
        return true;
      }

      case 'VERIFICATION_RESULT': {
        const forms = detectCredentialForms();
        forms.forEach(({ form }) => {
          highlightForm(form, message.status);
          renderBadge(
            form,
            message.status === 'valid'
              ? 'Verified'
              : message.status === 'expiring'
              ? 'Expiring soon'
              : 'Invalid',
            message.status
          );
        });
        sendResponse({ ok: true, count: forms.length });
        return true;
      }

      case 'PING': {
        sendResponse({ ok: true, forms: detectCredentialForms().length });
        return true;
      }

      default:
        return false;
    }
  }

  /**
   * Observe DOM mutations so dynamically inserted forms get auto-filled.
   */
  function observeDom() {
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(() => {
        scheduled = false;
        autoFillForms();
      }, 500);
    });
    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true,
    });
  }

  function init() {
    // Ask the background script for the current credential set.
    try {
      chrome.runtime.sendMessage(
        { source: MESSAGE_SOURCE, type: 'GET_CREDENTIALS' },
        (response) => {
          if (chrome.runtime.lastError) return;
          if (response && Array.isArray(response.credentials)) {
            cachedCredentials = response.credentials;
            autoFillEnabled = response.autoFillEnabled !== false;
            autoFillForms();
          }
        }
      );
    } catch (err) {
      // Extension context may be unavailable; ignore.
    }

    chrome.runtime.onMessage.addListener(handleMessage);
    observeDom();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();