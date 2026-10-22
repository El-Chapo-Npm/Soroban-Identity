import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  searchCredentials,
  getAutocompleteSuggestions,
  getSearchHistory,
  addSearchHistoryEntry,
  clearSearchHistory,
  getSavedSearches,
  saveSearch,
  deleteSavedSearch,
  highlightMatches,
  type SearchableCredential,
  type SearchFilters,
  type SearchResult,
  type AutocompleteSuggestion,
  type SavedSearch,
  type SearchHistoryEntry,
} from '../search';

export interface AdvancedSearchProps {
  credentials: SearchableCredential[];
  onResultsChange?: (results: SearchResult[]) => void;
  debounceMs?: number;
  placeholder?: string;
  className?: string;
}

const DEFAULT_DEBOUNCE_MS = 300;

const CREDENTIAL_TYPES = [
  'degree',
  'certificate',
  'license',
  'badge',
  'diploma',
  'other',
];

const STATUS_OPTIONS = ['valid', 'expired', 'revoked', 'pending'];

const EMPTY_FILTERS: SearchFilters = {
  credentialType: [],
  status: [],
  issuer: '',
  dateFrom: '',
  dateTo: '',
};

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);

  return debounced;
}

function formatDate(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

export const AdvancedSearch: React.FC<AdvancedSearchProps> = ({
  credentials,
  onResultsChange,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  placeholder = 'Search credentials… (supports AND, OR, NOT)',
  className,
}) => {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLUListElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebouncedValue(query, debounceMs);

  const issuers = useMemo(() => {
    const set = new Set<string>();
    credentials.forEach((c) => {
      if (c.issuer) set.add(c.issuer);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [credentials]);

  // Load persisted history and saved searches on mount.
  useEffect(() => {
    setHistory(getSearchHistory());
    setSavedSearches(getSavedSearches());
  }, []);

  // Run the debounced search whenever query or filters change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const run = async () => {
      try {
        const searchResults = await searchCredentials(
          credentials,
          debouncedQuery,
          filters,
        );
        if (cancelled) return;
        setResults(searchResults);
        onResultsChange?.(searchResults);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [credentials, debouncedQuery, filters, onResultsChange]);

  // Compute autocomplete suggestions for the current (non-debounced) input.
  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    const next = getAutocompleteSuggestions(credentials, query);
    setSuggestions(next);
    setActiveSuggestion(-1);
  }, [credentials, query]);

  // Commit a search to history when a debounced query settles.
  useEffect(() => {
    if (!debouncedQuery.trim()) return;
    const next = addSearchHistoryEntry(debouncedQuery);
    setHistory(next);
  }, [debouncedQuery]);

  // Close dropdowns on outside click.
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (suggestionsRef.current && !suggestionsRef.current.contains(target)) {
        setShowSuggestions(false);
      }
      if (historyRef.current && !historyRef.current.contains(target)) {
        setShowHistory(false);
      }
      if (savedRef.current && !savedRef.current.contains(target)) {
        setShowSaved(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const applySuggestion = useCallback((suggestion: AutocompleteSuggestion) => {
    setQuery(suggestion.value);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
    inputRef.current?.focus();
  }, []);

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      if (suggestions.length > 0) {
        event.preventDefault();
        setShowSuggestions(true);
        setActiveSuggestion((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : prev,
        );
      }
    } else if (event.key === 'ArrowUp') {
      if (suggestions.length > 0) {
        event.preventDefault();
        setActiveSuggestion((prev) => (prev > 0 ? prev - 1 : -1));
      }
    } else if (event.key === 'Enter') {
      if (showSuggestions && activeSuggestion >= 0 && suggestions[activeSuggestion]) {
        event.preventDefault();
        applySuggestion(suggestions[activeSuggestion]);
      } else {
        setShowSuggestions(false);
        setActiveSuggestion(-1);
      }
    } else if (event.key === 'Escape') {
      if (showSuggestions) {
        event.preventDefault();
        setShowSuggestions(false);
        setActiveSuggestion(-1);
      } else if (query) {
        event.preventDefault();
        setQuery('');
      }
    }
  };

  const handleClear = () => {
    setQuery('');
    setFilters(EMPTY_FILTERS);
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
    inputRef.current?.focus();
  };

  const toggleArrayFilter = (
    key: 'credentialType' | 'status',
    value: string,
  ) => {
    setFilters((prev) => {
      const current = prev[key];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [key]: next };
    });
  };

  const updateFilter = <K extends keyof SearchFilters>(
    key: K,
    value: SearchFilters[K],
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveSearch = () => {
    const name = saveName.trim();
    if (!name) return;
    const next = saveSearch(name, query, filters);
    setSavedSearches(next);
    setSaveName('');
    setShowSaveForm(false);
  };

  const handleLoadSaved = (saved: SavedSearch) => {
    setQuery(saved.query);
    setFilters({ ...EMPTY_FILTERS, ...saved.filters });
    setShowSaved(false);
    inputRef.current?.focus();
  };

  const handleDeleteSaved = (id: string) => {
    const next = deleteSavedSearch(id);
    setSavedSearches(next);
  };

  const handleHistorySelect = (entry: SearchHistoryEntry) => {
    setQuery(entry.query);
    setShowHistory(false);
    inputRef.current?.focus();
  };

  const handleClearHistory = () => {
    const next = clearSearchHistory();
    setHistory(next);
  };

  const activeFilterCount =
    filters.credentialType.length +
    filters.status.length +
    (filters.issuer ? 1 : 0) +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0);

  return (
    <div className={`advanced-search ${className ?? ''}`.trim()}>
      <div className="advanced-search__bar">
        <div className="advanced-search__input-wrap">
          <input
            ref={inputRef}
            type="text"
            className="advanced-search__input"
            value={query}
            placeholder={placeholder}
            aria-label="Search credentials"
            aria-autocomplete="list"
            aria-expanded={showSuggestions}
            aria-controls="advanced-search-suggestions"
            role="combobox"
            onChange={(e) => {
              setQuery(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => {
              if (suggestions.length > 0) setShowSuggestions(true);
            }}
            onKeyDown={handleInputKeyDown}
          />

          {loading && (
            <span
              className="advanced-search__spinner"
              role="status"
              aria-live="polite"
              aria-label="Searching"
            />
          )}

          {query && (
            <button
              type="button"
              className="advanced-search__clear"
              onClick={handleClear}
              aria-label="Clear search"
            >
              ×
            </button>
          )}

          {showSuggestions && suggestions.length > 0 && (
            <ul
              ref={suggestionsRef}
              id="advanced-search-suggestions"
              className="advanced-search__suggestions"
              role="listbox"
            >
              {suggestions.map((suggestion, index) => (
                <li
                  key={`${suggestion.type}-${suggestion.value}`}
                  role="option"
                  aria-selected={index === activeSuggestion}
                  className={
                    index === activeSuggestion
                      ? 'advanced-search__suggestion advanced-search__suggestion--active'
                      : 'advanced-search__suggestion'
                  }
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applySuggestion(suggestion);
                  }}
                  onMouseEnter={() => setActiveSuggestion(index)}
                >
                  <span className="advanced-search__suggestion-type">
                    {suggestion.type}
                  </span>
                  <span className="advanced-search__suggestion-value">
                    {suggestion.value}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          className="advanced-search__help-toggle"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((v) => !v)}
        >
          Operators
        </button>

        <div className="advanced-search__dropdown" ref={historyRef}>
          <button
            type="button"
            className="advanced-search__history-toggle"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((v) => !v)}
          >
            History
          </button>
          {showHistory && (
            <div className="advanced-search__history-panel">
              {history.length === 0 ? (
                <p className="advanced-search__empty">No search history.</p>
              ) : (
                <>
                  <ul className="advanced-search__history-list">
                    {history.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          className="advanced-search__history-item"
                          onClick={() => handleHistorySelect(entry)}
                        >
                          {entry.query}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="advanced-search__history-clear"
                    onClick={handleClearHistory}
                  >
                    Clear history
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="advanced-search__dropdown" ref={savedRef}>
          <button
            type="button"
            className="advanced-search__saved-toggle"
            aria-expanded={showSaved}
            onClick={() => setShowSaved((v) => !v)}
          >
            Saved ({savedSearches.length})
          </button>
          {showSaved && (
            <div className="advanced-search__saved-panel">
              {savedSearches.length === 0 ? (
                <p className="advanced-search__empty">No saved searches.</p>
              ) : (
                <ul className="advanced-search__saved-list">
                  {savedSearches.map((saved) => (
                    <li key={saved.id} className="advanced-search__saved-item">
                      <button
                        type="button"
                        className="advanced-search__saved-load"
                        onClick={() => handleLoadSaved(saved)}
                      >
                        {saved.name}
                      </button>
                      <button
                        type="button"
                        className="advanced-search__saved-delete"
                        aria-label={`Delete saved search ${saved.name}`}
                        onClick={() => handleDeleteSaved(saved.id)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {showSaveForm ? (
                <div className="advanced-search__save-form">
                  <input
                    type="text"
                    value={saveName}
                    placeholder="Name this search"
                    aria-label="Saved search name"
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveSearch();
                      if (e.key === 'Escape') setShowSaveForm(false);
                    }}
                  />
                  <button type="button" onClick={handleSaveSearch}>
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSaveForm(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="advanced-search__save-trigger"
                  onClick={() => setShowSaveForm(true)}
                >
                  Save current search
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {showHelp && (
        <div className="advanced-search__help" role="note">
          <p>
            Combine terms with boolean operators: <code>AND</code> (all terms),{' '}
            <code>OR</code> (any term), <code>NOT</code> (exclude a term).
          </p>
          <p>
            Example: <code>degree AND computer NOT expired</code>. Fuzzy matching
            tolerates minor typos.
          </p>
        </div>
      )}

      <div className="advanced-search__body">
        <aside className="advanced-search__facets" aria-label="Search filters">
          <div className="advanced-search__facet">
            <h4>Credential type</h4>
            {CREDENTIAL_TYPES.map((type) => (
              <label key={type} className="advanced-search__facet-option">
                <input
                  type="checkbox"
                  checked={filters.credentialType.includes(type)}
                  onChange={() => toggleArrayFilter('credentialType', type)}
                />
                {type}
              </label>
            ))}
          </div>

          <div className="advanced-search__facet">
            <h4>Status</h4>
            {STATUS_OPTIONS.map((status) => (
              <label key={status} className="advanced-search__facet-option">
                <input
                  type="checkbox"
                  checked={filters.status.includes(status)}
                  onChange={() => toggleArrayFilter('status', status)}
                />
                {status}
              </label>
            ))}
          </div>

          <div className="advanced-search__facet">
            <h4>Issuer</h4>
            <select
              value={filters.issuer}
              aria-label="Filter by issuer"
              onChange={(e) => updateFilter('issuer', e.target.value)}
            >
              <option value="">All issuers</option>
              {issuers.map((issuer) => (
                <option key={issuer} value={issuer}>
                  {issuer}
                </option>
              ))}
            </select>
          </div>

          <div className="advanced-search__facet">
            <h4>Date range</h4>
            <label className="advanced-search__facet-option">
              From
              <input
                type="date"
                value={filters.dateFrom}
                aria-label="Issued from date"
                onChange={(e) => updateFilter('dateFrom', e.target.value)}
              />
            </label>
            <label className="advanced-search__facet-option">
              To
              <input
                type="date"
                value={filters.dateTo}
                aria-label="Issued to date"
                onChange={(e) => updateFilter('dateTo', e.target.value)}
              />
            </label>
          </div>

          {activeFilterCount > 0 && (
            <button
              type="button"
              className="advanced-search__reset-filters"
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              Reset filters ({activeFilterCount})
            </button>
          )}
        </aside>

        <section className="advanced-search__results" aria-live="polite">
          {loading ? (
            <div className="advanced-search__loading" role="status">
              Searching…
            </div>
          ) : results.length === 0 ? (
            <p className="advanced-search__no-results">No results found.</p>
          ) : (
            <ul className="advanced-search__result-list">
              {results.map((result) => (
                <li key={result.id} className="advanced-search__result">
                  <h3
                    className="advanced-search__result-title"
                    dangerouslySetInnerHTML={{
                      __html: highlightMatches(result.title, result.highlights),
                    }}
                  />
                  <p
                    className="advanced-search__result-description"
                    dangerouslySetInnerHTML={{
                      __html: highlightMatches(
                        result.description ?? '',
                        result.highlights,
                      ),
                    }}
                  />
                  <div className="advanced-search__result-meta">
                    {result.credentialType && (
                      <span className="advanced-search__result-tag">
                        {result.credentialType}
                      </span>
                    )}
                    {result.status && (
                      <span className="advanced-search__result-tag">
                        {result.status}
                      </span>
                    )}
                    {result.issuer && (
                      <span className="advanced-search__result-issuer">
                        {result.issuer}
                      </span>
                    )}
                    {result.issuedAt && (
                      <span className="advanced-search__result-date">
                        {formatDate(result.issuedAt)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};

export default AdvancedSearch;