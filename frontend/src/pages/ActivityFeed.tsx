import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useContractEvents } from '../hooks/useContractEvents';
import CredentialTimeline from '../components/CredentialTimeline';

export type ActivityType = 'issued' | 'verified' | 'revoked';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  credentialId?: string;
  did?: string;
  timestamp: number;
  transactionHash?: string;
  gasCost?: string | number;
  actor?: string;
  details?: string;
}

const EXPLORER_BASE_URL =
  (typeof import.meta !== 'undefined' &&
    (import.meta as any).env &&
    (import.meta as any).env.VITE_EXPLORER_URL) ||
  'https://etherscan.io/tx/';

const ACTIVITY_TYPES: ActivityType[] = ['issued', 'verified', 'revoked'];

const formatTimestamp = (ts: number): string => {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
};

const formatGasCost = (gasCost?: string | number): string => {
  if (gasCost === undefined || gasCost === null || gasCost === '') return '—';
  if (typeof gasCost === 'number') {
    return `${gasCost} gas`;
  }
  return String(gasCost);
};

const toDateInputValue = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const escapeCsvValue = (value: unknown): string => {
  const str = value === undefined || value === null ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const downloadFile = (content: string, filename: string, mimeType: string): void => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const ActivityFeed: React.FC = () => {
  const {
    events,
    loading,
    error,
    hasMore,
    loadMore,
  } = useContractEvents() as {
    events: ActivityItem[];
    loading: boolean;
    error?: string | null;
    hasMore: boolean;
    loadMore: () => void;
  };

  const [selectedTypes, setSelectedTypes] = useState<ActivityType[]>([...ACTIVITY_TYPES]);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const toggleType = useCallback((type: ActivityType) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }, []);

  const filteredActivities = useMemo<ActivityItem[]>(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const startTs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const endTs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : null;

    return (events || [])
      .filter((item) => selectedTypes.includes(item.type))
      .filter((item) => {
        if (startTs !== null && item.timestamp < startTs) return false;
        if (endTs !== null && item.timestamp > endTs) return false;
        return true;
      })
      .filter((item) => {
        if (!normalizedSearch) return true;
        const haystack = [
          item.credentialId,
          item.did,
          item.transactionHash,
          item.actor,
          item.details,
          item.type,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedSearch);
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [events, selectedTypes, searchTerm, startDate, endDate]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && hasMore && !loading) {
          loadMore();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadMore]);

  const handleExportCsv = useCallback(() => {
    const headers = [
      'id',
      'type',
      'credentialId',
      'did',
      'timestamp',
      'transactionHash',
      'gasCost',
      'actor',
      'details',
    ];
    const rows = filteredActivities.map((item) =>
      [
        item.id,
        item.type,
        item.credentialId,
        item.did,
        new Date(item.timestamp).toISOString(),
        item.transactionHash,
        item.gasCost,
        item.actor,
        item.details,
      ]
        .map(escapeCsvValue)
        .join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    downloadFile(csv, `activity-feed-${Date.now()}.csv`, 'text/csv;charset=utf-8;');
  }, [filteredActivities]);

  const handleExportJson = useCallback(() => {
    const json = JSON.stringify(filteredActivities, null, 2);
    downloadFile(json, `activity-feed-${Date.now()}.json`, 'application/json;charset=utf-8;');
  }, [filteredActivities]);

  const renderActivity = useCallback((item: ActivityItem) => {
    const explorerUrl = item.transactionHash
      ? `${EXPLORER_BASE_URL}${item.transactionHash}`
      : null;

    return (
      <div className="activity-item" data-activity-type={item.type}>
        <div className="activity-item__header">
          <span className={`activity-item__badge activity-item__badge--${item.type}`}>
            {item.type}
          </span>
          <span className="activity-item__timestamp">{formatTimestamp(item.timestamp)}</span>
        </div>
        <div className="activity-item__body">
          {item.credentialId && (
            <div className="activity-item__row">
              <span className="activity-item__label">Credential:</span>{' '}
              <span className="activity-item__value">{item.credentialId}</span>
            </div>
          )}
          {item.did && (
            <div className="activity-item__row">
              <span className="activity-item__label">DID:</span>{' '}
              <span className="activity-item__value">{item.did}</span>
            </div>
          )}
          {item.actor && (
            <div className="activity-item__row">
              <span className="activity-item__label">Actor:</span>{' '}
              <span className="activity-item__value">{item.actor}</span>
            </div>
          )}
          {item.details && (
            <div className="activity-item__row">
              <span className="activity-item__label">Details:</span>{' '}
              <span className="activity-item__value">{item.details}</span>
            </div>
          )}
          {item.transactionHash && (
            <div className="activity-item__row">
              <span className="activity-item__label">Tx:</span>{' '}
              {explorerUrl ? (
                <a
                  className="activity-item__tx-link"
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.transactionHash}
                </a>
              ) : (
                <span className="activity-item__value">{item.transactionHash}</span>
              )}
            </div>
          )}
          <div className="activity-item__row">
            <span className="activity-item__label">Gas:</span>{' '}
            <span className="activity-item__value">{formatGasCost(item.gasCost)}</span>
          </div>
        </div>
      </div>
    );
  }, []);

  return (
    <div className="activity-feed">
      <header className="activity-feed__header">
        <h1>Activity Feed</h1>
        <p className="activity-feed__subtitle">
          Recent credential and DID operations
        </p>
      </header>

      <section className="activity-feed__controls" aria-label="Activity filters">
        <div className="activity-feed__filter-group">
          <span className="activity-feed__filter-label">Type</span>
          <div className="activity-feed__type-filters">
            {ACTIVITY_TYPES.map((type) => (
              <label key={type} className="activity-feed__type-filter">
                <input
                  type="checkbox"
                  checked={selectedTypes.includes(type)}
                  onChange={() => toggleType(type)}
                />
                <span>{type}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="activity-feed__filter-group">
          <label className="activity-feed__filter-label" htmlFor="activity-search">
            Search
          </label>
          <input
            id="activity-search"
            type="search"
            className="activity-feed__search"
            placeholder="Search by credential, DID, tx hash..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="activity-feed__filter-group">
          <label className="activity-feed__filter-label" htmlFor="activity-start-date">
            From
          </label>
          <input
            id="activity-start-date"
            type="date"
            className="activity-feed__date"
            value={startDate}
            max={endDate || undefined}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        <div className="activity-feed__filter-group">
          <label className="activity-feed__filter-label" htmlFor="activity-end-date">
            To
          </label>
          <input
            id="activity-end-date"
            type="date"
            className="activity-feed__date"
            value={endDate}
            min={startDate || undefined}
            max={toDateInputValue(new Date())}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        <div className="activity-feed__export">
          <button
            type="button"
            className="activity-feed__export-btn"
            onClick={handleExportCsv}
            disabled={filteredActivities.length === 0}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="activity-feed__export-btn"
            onClick={handleExportJson}
            disabled={filteredActivities.length === 0}
          >
            Export JSON
          </button>
        </div>
      </section>

      {error && (
        <div className="activity-feed__error" role="alert">
          {error}
        </div>
      )}

      <section className="activity-feed__timeline" aria-label="Activity timeline">
        {filteredActivities.length === 0 && !loading ? (
          <div className="activity-feed__empty">No activity matches your filters.</div>
        ) : (
          <CredentialTimeline
            activities={filteredActivities}
            renderItem={renderActivity}
          />
        )}
      </section>

      <div ref={sentinelRef} className="activity-feed__sentinel" aria-hidden="true" />

      {loading && (
        <div className="activity-feed__loading" role="status">
          Loading activity…
        </div>
      )}

      {!hasMore && filteredActivities.length > 0 && (
        <div className="activity-feed__end">End of activity history</div>
      )}
    </div>
  );
};

export default ActivityFeed;