// Options page script for the credential verification browser extension.
// Handles API server configuration, sign in/sync with the web app, and
// management of locally stored credentials.

(function () {
  'use strict';

  var DEFAULT_API_URL = 'https://app.example.com';
  var STORAGE_KEYS = {
    apiUrl: 'apiUrl',
    authToken: 'authToken',
    userEmail: 'userEmail',
    credentials: 'credentials',
    lastSync: 'lastSync'
  };

  // ---------------------------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------------------------

  function getStorage(keys) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(keys, function (result) {
        resolve(result || {});
      });
    });
  }

  function setStorage(items) {
    return new Promise(function (resolve) {
      chrome.storage.local.set(items, function () {
        resolve();
      });
    });
  }

  function removeStorage(keys) {
    return new Promise(function (resolve) {
      chrome.storage.local.remove(keys, function () {
        resolve();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------

  function $(id) {
    return document.getElementById(id);
  }

  function showStatus(el, message, type) {
    if (!el) return;
    el.textContent = message;
    el.className = 'status' + (type ? ' status-' + type : '');
    el.hidden = false;
    if (type === 'success') {
      window.setTimeout(function () {
        el.hidden = true;
      }, 4000);
    }
  }

  function normalizeApiUrl(url) {
    if (!url) return '';
    var trimmed = url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(trimmed)) {
      trimmed = 'https://' + trimmed;
    }
    return trimmed;
  }

  function isValidApiUrl(url) {
    try {
      var parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  function formatDate(value) {
    if (!value) return 'Never';
    var date = new Date(value);
    if (isNaN(date.getTime())) return 'Never';
    return date.toLocaleString();
  }

  // ---------------------------------------------------------------------------
  // API server configuration
  // ---------------------------------------------------------------------------

  function loadApiUrl() {
    return getStorage([STORAGE_KEYS.apiUrl]).then(function (result) {
      var url = result[STORAGE_KEYS.apiUrl] || DEFAULT_API_URL;
      $('apiUrl').value = url;
      return url;
    });
  }

  function saveApiUrl() {
    var statusEl = $('apiUrlStatus');
    var url = normalizeApiUrl($('apiUrl').value);

    if (!isValidApiUrl(url)) {
      showStatus(statusEl, 'Please enter a valid http(s) URL.', 'error');
      return Promise.resolve(false);
    }

    return setStorage({ apiUrl: url }).then(function () {
      $('apiUrl').value = url;
      showStatus(statusEl, 'API server URL saved.', 'success');
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Authentication / sync
  // ---------------------------------------------------------------------------

  function getAuthState() {
    return getStorage([
      STORAGE_KEYS.authToken,
      STORAGE_KEYS.userEmail,
      STORAGE_KEYS.lastSync
    ]);
  }

  function renderAuthState(state) {
    var signedIn = !!state[STORAGE_KEYS.authToken];
    var signedOutEl = $('signedOutSection');
    var signedInEl = $('signedInSection');

    if (signedIn) {
      signedOutEl.hidden = true;
      signedInEl.hidden = false;
      $('userEmail').textContent = state[STORAGE_KEYS.userEmail] || 'Unknown user';
      $('lastSync').textContent = formatDate(state[STORAGE_KEYS.lastSync]);
    } else {
      signedOutEl.hidden = false;
      signedInEl.hidden = true;
    }
  }

  function refreshAuthState() {
    return getAuthState().then(function (state) {
      renderAuthState(state);
      return state;
    });
  }

  function signIn() {
    var statusEl = $('authStatus');
    var email = ($('email').value || '').trim();
    var password = $('password').value || '';

    if (!email || !password) {
      showStatus(statusEl, 'Email and password are required.', 'error');
      return Promise.resolve();
    }

    var apiUrl = normalizeApiUrl($('apiUrl').value);
    if (!isValidApiUrl(apiUrl)) {
      showStatus(statusEl, 'Configure a valid API server URL first.', 'error');
      return Promise.resolve();
    }

    showStatus(statusEl, 'Signing in...', 'info');

    fetch(apiUrl + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Sign in failed (' + response.status + ')');
        }
        return response.json();
      })
      .then(function (data) {
        var token = data && (data.token || data.accessToken);
        if (!token) {
          throw new Error('No authentication token returned.');
        }
        return setStorage({
          authToken: token,
          userEmail: email
        }).then(function () {
          $('password').value = '';
          showStatus(statusEl, 'Signed in successfully.', 'success');
          return refreshAuthState();
        });
      })
      .then(function () {
        return syncCredentials();
      })
      .catch(function (err) {
        showStatus(statusEl, err.message || 'Sign in failed.', 'error');
      });
  }

  function signOut() {
    var statusEl = $('authStatus');
    return removeStorage([
      STORAGE_KEYS.authToken,
      STORAGE_KEYS.userEmail
    ]).then(function () {
      showStatus(statusEl, 'Signed out.', 'success');
      return refreshAuthState();
    });
  }

  function syncCredentials() {
    var statusEl = $('syncStatus');
    return getStorage([
      STORAGE_KEYS.apiUrl,
      STORAGE_KEYS.authToken
    ]).then(function (state) {
      var apiUrl = normalizeApiUrl(state[STORAGE_KEYS.apiUrl]);
      var token = state[STORAGE_KEYS.authToken];

      if (!token) {
        showStatus(statusEl, 'Sign in to sync credentials.', 'error');
        return;
      }
      if (!isValidApiUrl(apiUrl)) {
        showStatus(statusEl, 'Configure a valid API server URL first.', 'error');
        return;
      }

      showStatus(statusEl, 'Syncing...', 'info');

      return fetch(apiUrl + '/api/credentials', {
        headers: { Authorization: 'Bearer ' + token }
      })
        .then(function (response) {
          if (response.status === 401) {
            throw new Error('Session expired. Please sign in again.');
          }
          if (!response.ok) {
            throw new Error('Sync failed (' + response.status + ')');
          }
          return response.json();
        })
        .then(function (data) {
          var credentials = Array.isArray(data) ? data : (data && data.credentials) || [];
          return setStorage({
            credentials: credentials,
            lastSync: new Date().toISOString()
          }).then(function () {
            showStatus(statusEl, 'Synced ' + credentials.length + ' credential(s).', 'success');
            return renderCredentials();
          });
        })
        .then(function () {
          return refreshAuthState();
        })
        .catch(function (err) {
          showStatus(statusEl, err.message || 'Sync failed.', 'error');
        });
    });
  }

  // ---------------------------------------------------------------------------
  // Local credential storage management
  // ---------------------------------------------------------------------------

  function getCredentials() {
    return getStorage([STORAGE_KEYS.credentials]).then(function (result) {
      var credentials = result[STORAGE_KEYS.credentials];
      return Array.isArray(credentials) ? credentials : [];
    });
  }

  function credentialLabel(credential) {
    if (!credential) return 'Unnamed credential';
    return credential.name || credential.title || credential.issuer || credential.id || 'Unnamed credential';
  }

  function renderCredentials() {
    var listEl = $('credentialList');
    var emptyEl = $('credentialEmpty');
    var countEl = $('credentialCount');

    return getCredentials().then(function (credentials) {
      listEl.innerHTML = '';
      countEl.textContent = String(credentials.length);

      if (credentials.length === 0) {
        emptyEl.hidden = false;
        return;
      }
      emptyEl.hidden = true;

      credentials.forEach(function (credential, index) {
        var li = document.createElement('li');
        li.className = 'credential-item';

        var info = document.createElement('div');
        info.className = 'credential-info';

        var name = document.createElement('span');
        name.className = 'credential-name';
        name.textContent = credentialLabel(credential);
        info.appendChild(name);

        if (credential.expiresAt || credential.expiryDate) {
          var expiry = document.createElement('span');
          expiry.className = 'credential-expiry';
          expiry.textContent = 'Expires: ' + formatDate(credential.expiresAt || credential.expiryDate);
          info.appendChild(expiry);
        }

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-danger';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', function () {
          removeCredential(index);
        });

        li.appendChild(info);
        li.appendChild(removeBtn);
        listEl.appendChild(li);
      });
    });
  }

  function removeCredential(index) {
    return getCredentials().then(function (credentials) {
      if (index < 0 || index >= credentials.length) return;
      credentials.splice(index, 1);
      return setStorage({ credentials: credentials }).then(function () {
        return renderCredentials();
      });
    });
  }

  function clearCredentials() {
    var statusEl = $('storageStatus');
    return removeStorage([STORAGE_KEYS.credentials]).then(function () {
      showStatus(statusEl, 'Local credentials cleared.', 'success');
      return renderCredentials();
    });
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  function bindEvents() {
    $('saveApiUrl').addEventListener('click', function () {
      saveApiUrl();
    });

    $('signIn').addEventListener('click', function () {
      signIn();
    });

    $('signOut').addEventListener('click', function () {
      signOut();
    });

    $('syncNow').addEventListener('click', function () {
      syncCredentials();
    });

    $('clearCredentials').addEventListener('click', function () {
      clearCredentials();
    });

    $('password').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        signIn();
      }
    });
  }

  function init() {
    bindEvents();
    loadApiUrl()
      .then(function () {
        return refreshAuthState();
      })
      .then(function () {
        return renderCredentials();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();