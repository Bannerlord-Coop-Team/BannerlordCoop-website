# Server directory and address visibility

## Required behavior

- Every existing and newly created server is private by default.
- Public servers appear in the anonymous `/servers` directory with their game IP and port.
- Private server addresses are returned only to callers already authorized for that server. A hidden button is not an authorization boundary.
- Authorized users can copy the game endpoint as `IP:port` (bracketed IPv6).
- Changing visibility does not change game connection permissions, firewall rules, passwords, or player allowlists.
- Publishing requires an explicit authorized mutation, not discovery of a running server or the presence of an IP.
- Removing a server from public listing cannot erase addresses that visitors previously copied.

## Minimal boundaries

The control plane owns visibility persistence, authorization, and public projection. The website never fetches an administrative inventory to filter it into public data. Missing visibility is private; missing endpoints disable Join. Public reads use a dedicated read-only endpoint, with a bounded allowlisted response and no caching. Private inventory retains its current authentication boundary.

Owner-facing visibility updates use the authenticated user API and optimistic concurrency. Only the current owner may change visibility; manager, support, and administrator rows remain read-only in this user API. Private endpoint disclosure follows the paired CP contract: owner/manager summaries receive connection details, while support/admin summaries receive null/empty endpoints. UI hiding is only presentation, not authorization.

Public data is limited to the server identity/name, friendly region, observed game state, and game endpoint. No owner identities, infrastructure identifiers, agent ports, credentials, or invented player counts are published. Public pages must not fall back to sample or private server data on failure.

```mermaid
classDiagram
    class Server {
        serverId
        visibility: private | public
        connectionIp
        gamePorts
    }
    class AuthorizedServerSummary {
        serverId
        accessRole
        visibility
        connectionIp
        gamePorts
    }
    class PublicServerSummary {
        serverId
        displayName
        friendlyRegion
        observedGameState
        connectionIp
        gamePorts
    }
    Server --> AuthorizedServerSummary : authorized projection
    Server --> PublicServerSummary : public only
```

```mermaid
flowchart LR
    Visitor --> Website[Website public directory]
    Website --> PublicEdge[Read-only public Edge proxy]
    PublicEdge --> PublicCP[CP public directory endpoint]
    Owner --> Settings[Visibility setting / server actions]
    Settings --> PrivateEdge[Authenticated my-servers Edge proxy]
    PrivateEdge --> PrivateCP[CP user API / authorization]
    PublicCP --> DB[(Server visibility)]
    PrivateCP --> DB
```

## API contract

- Anonymous Edge `GET /functions/v1/public-servers?limit=100&cursor=...` calls only CP `POST /v1/public/control-plane`, operation `public-servers`, input `{cursor, limit}`. The normal version-1 correlated success envelope uses `result: {items, nextCursor}`. Public cursor length is capped at 2048, page size at 100, and game port arrays at 32. This does not alter the existing private API cursor limit.
- Authenticated Edge `POST /functions/v1/my-servers` accepts action `set-server-visibility` with `serverId`, `visibility`, and `expectedUpdatedAt`, plus the caller's UUID `x-request-id`. It forwards the unchanged bearer to CP `/v1/user/control-plane`, operation `set-server-visibility`. Success is synchronous `{serverId, visibility, updatedAt}` in the normal `result` envelope, not a job. CP must enforce durable idempotency and current ownership.
- The new public Edge function deliberately has `verify_jwt = false`; `my-servers` retains `verify_jwt = true`. Both reuse the existing `CONTROL_PLANE_ADMIN_URL` origin and `CONTROL_PLANE_WEB_ORIGINS` allowlist. No service-role key or user session is sent to the public endpoint.

## Verification and rollout

Required tests cover private-by-default persistence, unauthorized update rejection, private endpoint non-disclosure, public-to-private removal, strict public response projection, no-store responses, missing-field rollout, clipboard failures, and optimistic-concurrency failures. Public information already delivered to a browser cannot be recalled; no-store prevents intentional shared caching but is not a revocation mechanism for previously learned addresses.

The website PR remains draft until the paired CP contract and implementation are reviewed. Migration files, if required, are reviewed source changes only. Production deployment and live SQL are not part of this implementation authorization.
