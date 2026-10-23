import { useEffect, useMemo, useReducer, useState, useSyncExternalStore } from "react";
import { syncSecretFrom } from "../../lib/keyring";
import { passkeysAvailable } from "../../lib/passkey";
import { browserRecentSync, syncErrorText } from "../../lib/recent-sync";

// "Keep these on all your devices": opt-in, end to end encrypted sync of the
// recent-documents list (lib/recent-sync.ts). Closed by default: one quiet link.

const NOTICE =
  "Keeps an encrypted copy of this list, including your admin links, on mdshare, so you can open your documents on your other devices. mdshare can't read it and doesn't know whose it is. It's deleted after 12 months without use, or as soon as you turn sync off.";

const button =
  "w-full py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50";

// The page is rendered on the server first; sync exists only in the browser.
const subscribeNothing = () => () => {};

export function RecentSync({ hasDocs }: { hasDocs: boolean }) {
  const inBrowser = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const sync = useMemo(() => (inBrowser ? browserRecentSync() : null), [inBrowser]);
  const passkeys = inBrowser && passkeysAvailable();
  // The sync state lives in localStorage; re-render after anything that may change it.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const st = sync?.state() ?? null;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [armed, setArmed] = useState(false);

  // Join from a #sync= link (taking the secret out of the address bar), or sync if it is on.
  useEffect(() => {
    if (!sync) return;
    const secret = syncSecretFrom(location.hash);
    if (secret) history.replaceState(null, "", location.pathname + location.search);
    if (!secret && !sync.state()) return;
    let live = true;
    void (async () => {
      try {
        await (secret ? sync.join(secret) : sync.syncNow());
      } catch (e) {
        if (live) setNote(syncErrorText(e, navigator.onLine));
      }
      if (!live) return;
      if (secret) setOpen(true);
      refresh();
    })();
    return () => {
      live = false;
    };
  }, [sync]);

  if (!sync) return null;

  const run = (action: () => Promise<void>) => async () => {
    setBusy(true);
    setNote("");
    try {
      await action();
    } catch (e) {
      setNote(syncErrorText(e, navigator.onLine));
    }
    refresh();
    setBusy(false);
    setArmed(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        id="recent-sync-open"
        onClick={() => setOpen(true)}
        className="mt-2 text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
      >
        {st ? "Synced across your devices" : hasDocs ? "Keep these on all your devices" : "Bring your documents from another device"}
      </button>
    );
  }

  const when = st?.synced_at
    ? new Date(st.synced_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "not yet";

  return (
    <div id="recent-sync" className="mt-3 p-3 rounded-lg bg-neutral-900/50 space-y-2 text-xs text-neutral-400">
      {!st ? (
        <>
          <p className="text-sm text-neutral-200">Keep these on all your devices <span className="text-neutral-500">(optional)</span></p>
          <p>{NOTICE}</p>
          <button type="button" id="recent-sync-on" disabled={busy} onClick={run(() => sync.turnOn())}
            className={`${button} bg-white text-black hover:bg-neutral-200`}>
            Turn on sync
          </button>
          {passkeys && (
            <>
              <button type="button" id="recent-pk-unlock" disabled={busy} onClick={run(() => sync.unlockWithPasskey())}
                className={`${button} border border-neutral-700 text-neutral-200 hover:bg-neutral-800`}>
                Unlock with your passkey
              </button>
              <p>Already synced on another device? Use the passkey you added there, or open your sync link.</p>
            </>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-neutral-200">Sync is on <span className="text-neutral-500">(last synced {when})</span></p>
          <label htmlFor="recent-sync-link" className="block">
            Your sync link (keep it private). Open it on your other device to bring this list there. Anyone with it can open your documents as you.
          </label>
          <input id="recent-sync-link" readOnly value={sync.link(location.origin) ?? ""} onFocus={(e) => e.currentTarget.select()}
            className="w-full px-2 py-1.5 rounded bg-neutral-950 border border-neutral-800 text-neutral-300 font-mono text-[11px]" />
          {passkeys &&
            (st.passkey ? (
              <p>Passkey added. On a new device, choose <strong>Unlock with your passkey</strong> instead of opening the link.</p>
            ) : (
              <>
                <button type="button" id="recent-pk-add" disabled={busy} onClick={run(() => sync.addPasskey())}
                  className={`${button} border border-neutral-700 text-neutral-200 hover:bg-neutral-800`}>
                  Add a passkey
                </button>
                <p>Unlock on a new device with Face ID or fingerprint, no link needed.</p>
              </>
            ))}
          <button type="button" id="recent-sync-off" disabled={busy}
            onClick={armed ? run(() => sync.turnOff()) : () => setArmed(true)}
            className={`${button} text-red-400 hover:bg-red-950/40`}>
            {armed ? "Tap again: this turns sync off on all your devices" : "Turn off sync and delete the synced copy"}
          </button>
        </>
      )}
      <p id="recent-sync-note" role="status" className="text-red-400">{note}</p>
    </div>
  );
}
