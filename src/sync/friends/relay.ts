/**
 * Relay transport for the friends sync engine.
 *
 * A deliberately small surface over `nostr-tools`' `SimplePool`: every
 * round-trip is bounded, per-relay outcomes are reported instead of thrown,
 * and nothing here knows about envelopes, storage or React.
 */

import type { Filter } from "nostr-tools/filter";
import { SimplePool } from "nostr-tools/pool";
import type { NostrEvent } from "nostr-tools/pure";

import { resourceUrlFor } from "./protocol";

/** A stuck relay must never wedge a publish; treat it as failed instead. */
const PUBLISH_TIMEOUT_MS = 10_000;
/** Reads return whatever arrived inside this window. */
const QUERY_TIMEOUT_MS = 8_000;

export type RelayPublishResult = { ok: string[]; failed: string[] };

/**
 * What one read actually achieved. `ok` and `failed` are per relay, so the
 * caller can tell "the relays answered and had nothing new" (`ok` set, no
 * events) from "nobody answered at all" (every relay in `failed`).
 */
export type RelayQueryResult = {
  events: NostrEvent[];
  ok: string[];
  failed: string[];
};

export type RelaySubscriptionHandlers = {
  onEvent(event: NostrEvent): void;
  onEose?(): void;
  onClose?(reasons: string[]): void;
};

export interface RelayPort {
  publish(
    relays: string[],
    event: NostrEvent
  ): Promise<{ ok: string[]; failed: string[] }>;
  subscribe(
    relays: string[],
    filters: Filter[],
    handlers: {
      onEvent(event: NostrEvent): void;
      onEose?(): void;
      onClose?(reasons: string[]): void;
    }
  ): { close(): void };
  query(relays: string[], filter: Filter): Promise<RelayQueryResult>;
}

/**
 * Canonical, de-duplicated websocket URLs. `resourceUrlFor` (from the wire
 * protocol) already rejects non-ws(s) schemes and strips a trailing slash, so
 * the same relay can never be dialled twice under two spellings.
 */
function normalizeRelays(relays: string[]): string[] {
  const urls: string[] = [];
  for (const relay of relays || []) {
    const url = resourceUrlFor(relay);
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

export function createRelayPort(): RelayPort {
  // The pool is created on first use: importing this module (or constructing
  // the engine) must not open a socket in a test or a non-Tauri dev build.
  let pool: SimplePool | null = null;
  const getPool = (): SimplePool => {
    if (!pool) pool = new SimplePool();
    return pool;
  };

  return {
    publish(relays, event) {
      const urls = normalizeRelays(relays);
      const ok: string[] = [];
      const failed: string[] = [];
      if (urls.length === 0) return Promise.resolve({ ok, failed });

      const outstanding = new Set(urls);
      return new Promise<RelayPublishResult>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          // Anything still outstanding hit the ceiling.
          outstanding.forEach((url) => failed.push(url));
          outstanding.clear();
          resolve({ ok, failed });
        };
        const timer = setTimeout(finish, PUBLISH_TIMEOUT_MS);

        try {
          const results = getPool().publish(urls, event, {
            maxWait: PUBLISH_TIMEOUT_MS,
          });
          results.forEach((result, index) => {
            const url = urls[index];
            Promise.resolve(result).then(
              () => {
                if (settled || !outstanding.delete(url)) return;
                ok.push(url);
                if (outstanding.size === 0) finish();
              },
              () => {
                if (settled || !outstanding.delete(url)) return;
                failed.push(url);
                if (outstanding.size === 0) finish();
              }
            );
          });
        } catch {
          finish();
        }
      });
    },

    subscribe(relays, filters, handlers) {
      const urls = normalizeRelays(relays);
      let closed = false;
      const requests = urls.flatMap((url) =>
        (filters || []).map((filter) => ({ url, filter }))
      );

      // No relays or no filters: report a close on the next tick so the
      // caller backs off instead of waiting on a subscription that can
      // never deliver.
      if (requests.length === 0) {
        const timer = setTimeout(() => {
          if (closed) return;
          closed = true;
          handlers.onClose?.(["no-relays"]);
        }, 0);
        return {
          close: () => {
            closed = true;
            clearTimeout(timer);
          },
        };
      }

      let closer: { close: (reason?: string) => void } | null = null;
      try {
        closer = getPool().subscribeMap(requests, {
          onevent(event) {
            if (closed) return;
            try {
              handlers.onEvent(event);
            } catch {
              // A broken handler must not tear down the subscription.
            }
          },
          oneose() {
            if (closed) return;
            try {
              handlers.onEose?.();
            } catch {
              /* ignore */
            }
          },
          onclose(reasons) {
            if (closed) return;
            closed = true;
            try {
              handlers.onClose?.(
                reasons.map((reason) => `${reason.url}: ${reason.reason}`)
              );
            } catch {
              /* ignore */
            }
          },
        });
      } catch (err) {
        const timer = setTimeout(() => {
          if (closed) return;
          closed = true;
          handlers.onClose?.([String(err)]);
        }, 0);
        return {
          close: () => {
            closed = true;
            clearTimeout(timer);
          },
        };
      }

      return {
        close: () => {
          if (closed) return;
          closed = true;
          try {
            closer?.close("closed by client");
          } catch {
            /* ignore */
          }
        },
      };
    },

    query(relays, filter) {
      const urls = normalizeRelays(relays);
      const events: NostrEvent[] = [];
      const seen = new Set<string>();
      const ok: string[] = [];
      const failed: string[] = [];
      if (urls.length === 0) return Promise.resolve({ events, ok, failed });

      return new Promise<RelayQueryResult>((resolve) => {
        const pending = new Set(urls);
        const closers: Array<{ close(reason?: string): void }> = [];
        let settled = false;

        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          closers.forEach((closer) => {
            try {
              closer.close("closed by client");
            } catch {
              /* ignore */
            }
          });
          // Anything still outstanding never answered inside the window.
          pending.forEach((url) => failed.push(url));
          pending.clear();
          resolve({ events, ok, failed });
        };
        const timer = setTimeout(finish, QUERY_TIMEOUT_MS);

        const settleRelay = (url: string, answered: boolean) => {
          if (settled || !pending.delete(url)) return;
          if (answered) ok.push(url);
          else failed.push(url);
          if (pending.size === 0) finish();
        };

        // One subscription per relay: the pool's shared callbacks cannot say
        // *which* relay answered, and that distinction is the whole point of
        // reporting outcomes. A socket that connects accepted the REQ, so it
        // counts as answered even when it has nothing newer to send.
        urls.forEach((url) => {
          void (async () => {
            let relay;
            try {
              relay = await getPool().ensureRelay(url, {
                connectionTimeout: QUERY_TIMEOUT_MS,
              });
            } catch {
              settleRelay(url, false);
              return;
            }
            if (settled) return;
            try {
              const subscription = relay.subscribe([filter], {
                onevent(event) {
                  if (settled || seen.has(event.id)) return;
                  seen.add(event.id);
                  events.push(event);
                },
                oneose() {
                  settleRelay(url, true);
                },
                onclose() {
                  settleRelay(url, true);
                },
                eoseTimeout: QUERY_TIMEOUT_MS,
              });
              closers.push(subscription);
            } catch {
              settleRelay(url, false);
            }
          })();
        });
      });
    },
  };
}
