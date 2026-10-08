import type { SessionDeviceDto } from "@holon/contracts/dashboard";
import { Button } from "@holon/ui/button";
import { Dialog } from "@holon/ui/dialog";
import { useLingui } from "@lingui/react";
import { useEffect, useRef, useState } from "react";

import { githubSignIn, readDevices, revokeDevice } from "./session-client.js";

export function SignIn({ reconnect = false }: { reconnect?: boolean }) {
  const { i18n } = useLingui();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div>
      {reconnect && (
        <p role="status">
          {i18n._({
            id: "session.expired",
            message: "Your session is unavailable. Sign in again to continue.",
          })}
        </p>
      )}
      <Button
        busy={busy}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          setFailed(false);
          const url = await githubSignIn(window.location.href);
          if (url) {
            window.location.assign(url);
            return;
          }
          setBusy(false);
          setFailed(true);
        }}
      >
        {i18n._({ id: "session.signin", message: "Sign in with GitHub" })}
      </Button>
      {failed && (
        <p role="alert">
          {i18n._({
            id: "session.failed",
            message: "Unable to confirm the session. Please try again.",
          })}
        </p>
      )}
    </div>
  );
}

type Props = {
  sessionId: string;
  csrf: string;
  onSessionLost: (sessionId: string) => void;
};
export function SessionControls({ sessionId, csrf, onSessionLost }: Props) {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<SessionDeviceDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "failed">(
    "idle",
  );
  const active = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
    };
  }, [sessionId, onSessionLost]);
  async function reload(cursor?: string) {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setStatus("loading");
    const result = await readDevices(request.signal, sessionId, cursor);
    if (!active.current || request.signal.aborted) return;
    if (result.status === "lost") {
      setDevices([]);
      onSessionLost(sessionId);
      return;
    }
    if (result.status === "unavailable") {
      setDevices([]);
      setStatus("failed");
      return;
    }
    setDevices(result.sessions);
    setNextCursor(result.nextCursor);
    setStatus("ready");
  }
  async function revoke(path: string, endsCurrent: boolean) {
    if (pending.current) return;
    pending.current = true;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const result = await revokeDevice(path, csrf, request.signal);
    pending.current = false;
    if (!active.current || request.signal.aborted) return;
    if (result === "lost" || (result === "done" && endsCurrent)) {
      setDevices([]);
      onSessionLost(sessionId);
      return;
    }
    if (result === "unavailable") {
      setStatus("failed");
      return;
    }
    await reload();
  }
  const browserNames = {
    chrome: "Chrome",
    firefox: "Firefox",
    safari: "Safari",
    edge: "Edge",
    other: i18n._({ id: "session.other", message: "Other browser" }),
  };
  const title = i18n._({ id: "session.devices", message: "Active sessions" });
  return (
    <>
      <Button
        variant="quiet"
        onClick={() => {
          setOpen(true);
          void reload();
        }}
      >
        {title}
      </Button>
      <Button
        variant="quiet"
        onClick={() => {
          void revoke("/api/auth/sign-out", true);
        }}
      >
        {i18n._({ id: "session.signout", message: "Sign out" })}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            controller.current?.abort();
            setDevices([]);
          }
        }}
        title={title}
        description={i18n._({
          id: "session.deviceDescription",
          message:
            "Only your sessions are listed. Browser names are approximate.",
        })}
        closeLabel={i18n._({
          id: "session.close",
          message: "Close active sessions",
        })}
      >
        {status === "loading" && (
          <p role="status">
            {i18n._({ id: "session.loading", message: "Loading sessions…" })}
          </p>
        )}
        {status === "failed" && (
          <p role="alert">
            {i18n._({
              id: "session.failed",
              message: "Unable to confirm the session. Please try again.",
            })}
          </p>
        )}
        {status === "ready" && (
          <ul>
            {devices.map((device) => (
              <li key={device.id}>
                <span>
                  {browserNames[device.label]}{" "}
                  {device.isCurrent &&
                    i18n._({ id: "session.current", message: "(this device)" })}
                </span>
                <Button
                  variant="quiet"
                  onClick={() => {
                    void revoke(
                      `/api/auth/sessions/${encodeURIComponent(device.id)}/revoke`,
                      device.isCurrent,
                    );
                  }}
                >
                  {i18n._({ id: "session.revoke", message: "Revoke session" })}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {status === "ready" && nextCursor !== null && (
          <Button
            variant="quiet"
            onClick={() => {
              void reload(nextCursor);
            }}
          >
            {i18n._({
              id: "session.nextPage",
              message: "Next sessions",
            })}
          </Button>
        )}
        <Button
          variant="danger"
          onClick={() => {
            void revoke("/api/auth/sign-out/all", true);
          }}
        >
          {i18n._({
            id: "session.signoutAll",
            message: "Sign out on all devices",
          })}
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            void reload();
          }}
        >
          {i18n._({ id: "session.refresh", message: "Refresh sessions" })}
        </Button>
      </Dialog>
    </>
  );
}
