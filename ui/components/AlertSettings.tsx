"use client";

import { useEffect, useRef, useState } from "react";
import type { NotificationSettings } from "../lib/auth";
import {
  bindExistingSubscription,
  disablePushSubscription,
  enablePushSubscription,
  isIosDevice,
  isStandaloneDisplay,
  registerPushServiceWorker,
  supportsWebPush
} from "../lib/web-push";

type BrowserState =
  | "checking"
  | "unsupported"
  | "ios-install"
  | "ready"
  | "enabled"
  | "blocked"
  | "unavailable";

type AlertSettingsProps = {
  initialSettings: NotificationSettings;
};

type NotificationSwitchProps = {
  checked: boolean;
  disabled: boolean;
  labelId: string;
  saving: boolean;
  onToggle: () => void;
};

function NotificationSwitch({
  checked,
  disabled,
  labelId,
  saving,
  onToggle
}: NotificationSwitchProps) {
  return (
    <button
      type="button"
      className="settings-switch"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-busy={saving}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="settings-switch-thumb" aria-hidden="true" />
    </button>
  );
}

export function AlertSettings({
  initialSettings
}: AlertSettingsProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [browserState, setBrowserState] =
    useState<BrowserState>("checking");
  const [browserBusy, setBrowserBusy] = useState(false);
  const [savingSetting, setSavingSetting] = useState<
    "new_gist" | "edited_gist" | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!savingSetting) setSettings(initialSettings);
  }, [initialSettings]);

  useEffect(() => {
    if (!settings.available) {
      return;
    }
    let active = true;

    async function inspectBrowser() {
      if (isIosDevice() && !isStandaloneDisplay()) {
        setBrowserState("ios-install");
        return;
      }
      if (!supportsWebPush()) {
        setBrowserState("unsupported");
        return;
      }
      try {
        const registration = await registerPushServiceWorker();
        registrationRef.current = registration;
        const subscription = await registration.pushManager.getSubscription();
        if (!active) {
          return;
        }
        if (subscription) {
          setBrowserState("enabled");
          try {
            await bindExistingSubscription(registration);
          } catch {
            if (active) {
              setMessage("Couldn’t sync this browser. Try again.");
            }
          }
        } else if (Notification.permission === "denied") {
          setBrowserState("blocked");
        } else {
          setBrowserState("ready");
        }
      } catch {
        if (active) {
          setBrowserState("unavailable");
        }
      }
    }

    void inspectBrowser();
    return () => {
      active = false;
    };
  }, [settings.available]);

  async function enableAlerts() {
    if (!settings.application_server_key) {
      return;
    }
    setBrowserBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setBrowserState("blocked");
        return;
      }
      const registration =
        registrationRef.current ?? (await registerPushServiceWorker());
      registrationRef.current = registration;
      const subscription = await enablePushSubscription(
        registration,
        settings.application_server_key
      );
      setBrowserState(subscription ? "enabled" : "ready");
    } catch {
      setMessage("Couldn’t enable alerts. Try again.");
    } finally {
      setBrowserBusy(false);
    }
  }

  async function disableAlerts() {
    setBrowserBusy(true);
    setMessage(null);
    try {
      const registration =
        registrationRef.current ?? (await registerPushServiceWorker());
      registrationRef.current = registration;
      const result = await disablePushSubscription(registration);
      setBrowserState(
        Notification.permission === "denied" ? "blocked" : "ready"
      );
      if (!result.backendSynced) {
        setMessage("Alerts are off. Cleanup will retry automatically.");
      }
    } catch {
      setBrowserState("ready");
      setMessage("Alerts are off in this browser.");
    } finally {
      setBrowserBusy(false);
    }
  }

  async function updateSetting(
    field: "new_gist" | "edited_gist",
    value: boolean
  ) {
    const previous = settings;
    const next = { ...settings, [field]: value };
    setSettings(next);
    setSavingSetting(field);
    setMessage(null);
    try {
      const response = await fetch("/api/me/notification-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          new_gist: next.new_gist,
          edited_gist: next.edited_gist
        })
      });
      if (!response.ok) {
        throw new Error(`Settings request failed: ${response.status}`);
      }
      const saved = (await response.json()) as {
        new_gist?: unknown;
        edited_gist?: unknown;
      };
      if (
        typeof saved.new_gist !== "boolean" ||
        typeof saved.edited_gist !== "boolean"
      ) {
        throw new Error("Invalid settings response");
      }
      setSettings((current) => ({
        ...current,
        new_gist: saved.new_gist as boolean,
        edited_gist: saved.edited_gist as boolean
      }));
    } catch {
      setSettings(previous);
      setMessage("Couldn’t save that change. Try again.");
    } finally {
      setSavingSetting(null);
    }
  }

  let browserStatus: string | null = "Checking…";
  if (!settings.available) {
    browserStatus = "Not configured.";
  } else if (browserState === "unsupported") {
    browserStatus = "Not supported in this browser.";
  } else if (browserState === "ios-install") {
    browserStatus = "Add Wavey Gist to your Home Screen to turn on alerts.";
  } else if (browserState === "blocked") {
    browserStatus = "Blocked in system settings.";
  } else if (browserState === "unavailable") {
    browserStatus = "Unavailable right now.";
  } else if (browserState === "ready" || browserState === "enabled") {
    browserStatus = null;
  }
  const enabled = settings.available && browserState === "enabled";
  const canToggle =
    settings.available && (browserState === "ready" || browserState === "enabled");

  return (
    <section className="settings-group" aria-labelledby="alert-settings-title">
      <h2 className="settings-group-label" id="alert-settings-title">
        Notifications
      </h2>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-label" id="device-alert-label">
              Notifications on this device
            </span>
            <span className="settings-row-note">
              {browserStatus ??
                "Get an alert when gists are published or edited."}
            </span>
          </div>
          <NotificationSwitch
            checked={enabled}
            disabled={!canToggle || browserBusy}
            labelId="device-alert-label"
            saving={browserBusy}
            onToggle={() => void (enabled ? disableAlerts() : enableAlerts())}
          />
        </div>

        {enabled ? (
          <>
            <div className="settings-row">
              <div className="settings-row-text">
                <span className="settings-row-label" id="new-gist-alert-label">
                  New gist published
                </span>
              </div>
              <NotificationSwitch
                checked={settings.new_gist}
                disabled={savingSetting !== null}
                labelId="new-gist-alert-label"
                saving={savingSetting === "new_gist"}
                onToggle={() =>
                  void updateSetting("new_gist", !settings.new_gist)
                }
              />
            </div>
            <div className="settings-row">
              <div className="settings-row-text">
                <span
                  className="settings-row-label"
                  id="edited-gist-alert-label"
                >
                  Gist edited
                </span>
              </div>
              <NotificationSwitch
                checked={settings.edited_gist}
                disabled={savingSetting !== null}
                labelId="edited-gist-alert-label"
                saving={savingSetting === "edited_gist"}
                onToggle={() =>
                  void updateSetting("edited_gist", !settings.edited_gist)
                }
              />
            </div>
          </>
        ) : null}

        {message ? (
          <p className="settings-card-note" role="status" aria-live="polite">
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
