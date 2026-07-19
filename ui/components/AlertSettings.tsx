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
  descriptionId: string;
  saving: boolean;
  onToggle: () => void;
};

function NotificationSwitch({
  checked,
  disabled,
  labelId,
  descriptionId,
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
      aria-describedby={descriptionId}
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
              setMessage(
                "Alerts are enabled here, but account sync failed. Try again shortly."
              );
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
      setMessage("Alerts could not be enabled. Please try again.");
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
        setMessage(
          "Alerts are disabled in this browser. Server cleanup will finish automatically."
        );
      }
    } catch {
      setBrowserState("ready");
      setMessage("Alerts are disabled in this browser.");
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
      setMessage("That alert setting could not be saved. Please try again.");
    } finally {
      setSavingSetting(null);
    }
  }

  if (!settings.available) {
    return (
      <section className="alert-settings" aria-labelledby="alert-settings-title">
        <h2 id="alert-settings-title">Notifications</h2>
        <p className="alert-status">Alerts are not configured.</p>
      </section>
    );
  }

  let browserStatus = "Checking this browser…";
  if (browserState === "unsupported") {
    browserStatus = "Alerts are not supported in this browser.";
  } else if (browserState === "ios-install") {
    browserStatus =
      "Add waveygist to your Home Screen, reopen it, then enable alerts.";
  } else if (browserState === "blocked") {
    browserStatus =
      "Notifications are blocked in system or browser settings.";
  } else if (browserState === "unavailable") {
    browserStatus = "Alerts are unavailable right now.";
  } else if (browserState === "ready") {
    browserStatus = "Enable this browser to receive your selected alerts.";
  } else if (browserState === "enabled") {
    browserStatus = "Alerts are enabled on this browser.";
  }

  return (
    <section className="alert-settings" aria-labelledby="alert-settings-title">
      <div className="alert-settings-heading">
        <div>
          <h2 id="alert-settings-title">Notifications</h2>
          <p>Choose which publication events should alert you.</p>
        </div>
      </div>

      <div className="alert-browser-row">
        <div className="alert-preference-copy">
          <span className="alert-preference-label">This browser</span>
          <span className="alert-preference-description">{browserStatus}</span>
        </div>
        <div className="alert-enrollment">
          {browserState === "ready" ? (
            <button
              className="alert-enrollment-button"
              type="button"
              onClick={() => void enableAlerts()}
              disabled={browserBusy}
            >
              {browserBusy ? "Enabling…" : "Enable alerts"}
            </button>
          ) : null}
          {browserState === "enabled" ? (
            <button
              className="alert-enrollment-button"
              type="button"
              onClick={() => void disableAlerts()}
              disabled={browserBusy}
            >
              {browserBusy ? "Disabling…" : "Disable"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="alert-preferences" aria-label="Alert types">
        <div className="alert-preference-row">
          <div className="alert-preference-copy">
            <span
              className="alert-preference-label"
              id="new-gist-alert-label"
            >
              New gist published
            </span>
            <span
              className="alert-preference-description"
              id="new-gist-alert-description"
            >
              Alert when this account publishes a new gist.
            </span>
          </div>
          <NotificationSwitch
            checked={settings.new_gist}
            disabled={savingSetting !== null}
            labelId="new-gist-alert-label"
            descriptionId="new-gist-alert-description"
            saving={savingSetting === "new_gist"}
            onToggle={() =>
              void updateSetting("new_gist", !settings.new_gist)
            }
          />
        </div>
        <div className="alert-preference-row">
          <div className="alert-preference-copy">
            <span
              className="alert-preference-label"
              id="edited-gist-alert-label"
            >
              Gist edited
            </span>
            <span
              className="alert-preference-description"
              id="edited-gist-alert-description"
            >
              Alert when one of your gists gets a new revision.
            </span>
          </div>
          <NotificationSwitch
            checked={settings.edited_gist}
            disabled={savingSetting !== null}
            labelId="edited-gist-alert-label"
            descriptionId="edited-gist-alert-description"
            saving={savingSetting === "edited_gist"}
            onToggle={() =>
              void updateSetting("edited_gist", !settings.edited_gist)
            }
          />
        </div>
      </div>

      {message ? (
        <p className="alert-message" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
    </section>
  );
}
