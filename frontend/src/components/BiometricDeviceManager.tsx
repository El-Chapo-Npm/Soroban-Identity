import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useBiometricAuth } from '../hooks/useBiometricAuth';

export interface BiometricDevice {
  id: string;
  name: string;
  createdAt?: string | number;
  lastUsedAt?: string | number;
  platform?: string;
}

export interface BiometricDeviceManagerProps {
  className?: string;
  onDevicesChanged?: (devices: BiometricDevice[]) => void;
}

const formatDate = (value?: string | number): string => {
  if (value === undefined || value === null || value === '') {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString();
};

const BiometricDeviceManager: React.FC<BiometricDeviceManagerProps> = ({
  className,
  onDevicesChanged,
}) => {
  const {
    devices,
    isSupported,
    isPlatformAuthenticatorAvailable,
    isLoading,
    error,
    registerDevice,
    renameDevice,
    removeDevice,
    refreshDevices,
  } = useBiometricAuth();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState<boolean>(false);

  const deviceList: BiometricDevice[] = useMemo(
    () => (Array.isArray(devices) ? devices : []),
    [devices],
  );

  useEffect(() => {
    if (typeof refreshDevices === 'function') {
      refreshDevices().catch(() => {
        /* errors surfaced via hook state */
      });
    }
  }, [refreshDevices]);

  useEffect(() => {
    if (typeof onDevicesChanged === 'function') {
      onDevicesChanged(deviceList);
    }
  }, [deviceList, onDevicesChanged]);

  const handleRegister = useCallback(async () => {
    setActionError(null);
    setIsRegistering(true);
    try {
      await registerDevice();
      if (typeof refreshDevices === 'function') {
        await refreshDevices();
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to register this device.';
      setActionError(message);
    } finally {
      setIsRegistering(false);
    }
  }, [registerDevice, refreshDevices]);

  const handleStartRename = useCallback((device: BiometricDevice) => {
    setActionError(null);
    setEditingId(device.id);
    setEditingName(device.name ?? '');
  }, []);

  const handleCancelRename = useCallback(() => {
    setEditingId(null);
    setEditingName('');
  }, []);

  const handleSaveRename = useCallback(
    async (device: BiometricDevice) => {
      const trimmed = editingName.trim();
      if (!trimmed) {
        setActionError('Device name cannot be empty.');
        return;
      }
      if (trimmed === device.name) {
        handleCancelRename();
        return;
      }
      setActionError(null);
      setBusyId(device.id);
      try {
        await renameDevice(device.id, trimmed);
        if (typeof refreshDevices === 'function') {
          await refreshDevices();
        }
        handleCancelRename();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to rename device.';
        setActionError(message);
      } finally {
        setBusyId(null);
      }
    },
    [editingName, renameDevice, refreshDevices, handleCancelRename],
  );

  const handleRemove = useCallback(
    async (device: BiometricDevice) => {
      const confirmed =
        typeof window === 'undefined' ||
        typeof window.confirm !== 'function' ||
        window.confirm(`Remove biometric device "${device.name}"?`);
      if (!confirmed) {
        return;
      }
      setActionError(null);
      setBusyId(device.id);
      try {
        await removeDevice(device.id);
        if (typeof refreshDevices === 'function') {
          await refreshDevices();
        }
        if (editingId === device.id) {
          handleCancelRename();
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to remove device.';
        setActionError(message);
      } finally {
        setBusyId(null);
      }
    },
    [removeDevice, refreshDevices, editingId, handleCancelRename],
  );

  const supportLabel = isSupported
    ? 'WebAuthn is supported in this browser'
    : 'WebAuthn is not supported in this browser';

  const platformLabel = isPlatformAuthenticatorAvailable
    ? 'Platform authenticator available (Touch ID / Face ID / Windows Hello)'
    : 'No platform authenticator detected';

  const canRegister = isSupported && isPlatformAuthenticatorAvailable && !isRegistering;

  return (
    <section
      className={className}
      aria-labelledby="biometric-device-manager-title"
      data-testid="biometric-device-manager"
    >
      <header>
        <h2 id="biometric-device-manager-title">Biometric Devices</h2>
        <p>
          Manage the devices registered for biometric sign-in using your
          fingerprint or face recognition.
        </p>
      </header>

      <div role="status" aria-live="polite">
        <p data-testid="biometric-support-status">
          <strong>Browser support:</strong> {supportLabel}
        </p>
        <p data-testid="biometric-platform-status">
          <strong>Platform authenticator:</strong> {platformLabel}
        </p>
      </div>

      {error ? (
        <p role="alert" data-testid="biometric-hook-error">
          {error instanceof Error ? error.message : String(error)}
        </p>
      ) : null}

      {actionError ? (
        <p role="alert" data-testid="biometric-action-error">
          {actionError}
        </p>
      ) : null}

      <div>
        <button
          type="button"
          onClick={handleRegister}
          disabled={!canRegister}
          aria-busy={isRegistering}
          data-testid="biometric-register-button"
        >
          {isRegistering ? 'Registering…' : 'Register this device'}
        </button>
        {!isSupported ? (
          <p>
            Biometric registration is unavailable. You can continue to sign in
            with your password.
          </p>
        ) : null}
        {isSupported && !isPlatformAuthenticatorAvailable ? (
          <p>
            This device does not expose a platform authenticator. You can
            continue to sign in with your password.
          </p>
        ) : null}
      </div>

      <div>
        <h3>Registered devices</h3>
        {isLoading && deviceList.length === 0 ? (
          <p data-testid="biometric-devices-loading">Loading devices…</p>
        ) : null}
        {!isLoading && deviceList.length === 0 ? (
          <p data-testid="biometric-devices-empty">
            No biometric devices registered yet.
          </p>
        ) : null}
        {deviceList.length > 0 ? (
          <ul data-testid="biometric-devices-list">
            {deviceList.map((device) => {
              const isEditing = editingId === device.id;
              const isBusy = busyId === device.id;
              return (
                <li key={device.id} data-testid={`biometric-device-${device.id}`}>
                  {isEditing ? (
                    <div>
                      <label htmlFor={`rename-${device.id}`}>
                        Device name
                      </label>
                      <input
                        id={`rename-${device.id}`}
                        type="text"
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        disabled={isBusy}
                        maxLength={64}
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveRename(device)}
                        disabled={isBusy}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelRename}
                        disabled={isBusy}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div>
                      <span data-testid={`biometric-device-name-${device.id}`}>
                        {device.name}
                      </span>
                      {device.platform ? (
                        <span> ({device.platform})</span>
                      ) : null}
                      <div>
                        <small>
                          Registered: {formatDate(device.createdAt)} · Last used:{' '}
                          {formatDate(device.lastUsedAt)}
                        </small>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleStartRename(device)}
                        disabled={isBusy}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemove(device)}
                        disabled={isBusy}
                      >
                        {isBusy ? 'Removing…' : 'Remove'}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
};

export default BiometricDeviceManager;