# Planning Poker

Browser-based planning poker for teams. No account, database, or self-hosted backend required. The complete application ships as a single [index.html](index.html), with embedded styles, JavaScript, fonts, and cryptographic libraries.

**[Open Planning Poker](https://roski.github.io/planning-poker/)**

## Getting started

1. Open the website or download `index.html` and open it in a modern browser.
2. Enter your name, optionally name the room, and select a deck.
3. Select **Create room**, then **Invite** to share the room link or invitation code.
4. When using a local HTML file, teammates open their own copy and paste the full invitation code into **Join with a code**.
5. Pick a card to vote. Select it again to withdraw your vote, or choose another card to change it.
6. Select **Reveal cards** to reveal votes and **New round** to start again.

An internet connection is required for communication through public Nostr relays. Keep the creator's tab open throughout the session.

## Features

- Animated deck previews, interactive voting cards, and reveal animations.
- Fibonacci, Modified Fibonacci, Powers of 2, Multiples of 3, T-shirt sizes, and Hours decks.
- Custom decks with Enter or comma-separated input, including `?`, `☕`, `∞`, and `½` cards.
- Single and bulk task entry, task links, editing, deletion, and free voting without a task.
- Numeric averages, vote distributions, and agreement indicators. `½` counts as 0.5; other special cards and text labels are excluded from averages.
- Observer mode, editable participant names, invitations, and recent rooms.
- Participants remain visible as offline after two minutes without a signal.
- Creators can remove participants. Removed participants can refresh the page and join again.
- Responsive layout, a collapsible task panel, keyboard controls, and reduced-motion support.
- Automatic reconnection and configurable relays.

## Deployment

This repository uses GitHub Pages with **main / (root)** as its publishing source. Pushing an updated root `index.html` publishes the new version automatically.

To host your own copy, upload `index.html` and `.nojekyll` to a public repository. In **Settings → Pages → Build and deployment**, select **Deploy from a branch**, your branch, and **/(root)**.

Invitations use the `#room=…` URL fragment, so repository subpaths work without server routing. Any static HTTPS host can serve the application. Node.js and the source files are not required to run the built HTML file.

## Communication model

Browsers communicate through public Nostr relays over WSS. The application uses ephemeral event kind **21717**, channel-hash filtering, signature verification, and duplicate suppression.

Default relays are `relay.damus.io`, `nos.lol`, `relay.primal.net`, and `nostr.mom`. Change them in **Connection settings**. Participants need at least one reachable relay in common. Custom relay settings are not included in invitations and must be shared separately.

**The room creator coordinates state changes and must keep their tab open.** Participants can reveal votes, start rounds, and change tasks or decks; the coordinator validates and signs the resulting state. The team must trust the creator. Automatic coordinator transfer is not supported.

A normal refresh restores the participant identity, room state, and private vote data from `sessionStorage`. Temporary disconnections trigger resynchronization. Creator keys and room snapshots are also saved in local browser storage. Reopen the invitation or select a recent room in the same browser profile and on the same site to restore it after closing the tab. Only one creator tab can run a room at a time. Clearing site data, private browsing, or moving to another device or origin can remove access; relays are not a backup. Rooms whose keys were lost before this feature cannot be recovered from an invitation alone.

## Encryption and hidden votes

- Each room has a random 256-bit secret in the invitation's URL fragment. Browsers do not send that fragment to the HTTP host when loading the page.
- Messages use AES-256-GCM through Web Crypto, with a fresh random 96-bit IV per message and the channel identifier as additional authenticated data.
- Events use Schnorr/secp256k1 signatures through the embedded `nostr-tools` library. Invitations pin the creator's public key.
- Before reveal, participants send a SHA-256 commitment covering the round, participant, vote, and random 256-bit salt. The vote and salt remain on the participant's device.
- On reveal, participants send the vote and salt for verification. An offline participant's vote remains unrevealed until they return.
- Relays can observe network metadata and channel identifiers. Ephemeral delivery is a protocol convention, not a guarantee against third-party logging. Anyone with the invitation can access the room.
- Names, custom decks, and recent invitations use `localStorage`; active participant sessions use `sessionStorage`. Creator recovery keys and room snapshots also persist in `localStorage`. Share invitations only with intended participants.

## Limitations and troubleshooting

- Public relays are third-party services and may become unavailable, impose rate limits, or require authentication.
- A relay's **Sending & receiving** status indicates that it accepted a publication. Seeing another participant confirms communication between people.
- Corporate network filters may block the site or relay addresses, including on port 443. Test within your network; the application does not bypass corporate controls.
- If joining fails, check the full invitation, the creator's open tab, shared reachable relays, and system clocks. Events are accepted within a five-minute window.
- Application limits are 50 participants, 100 tasks, and 24 cards per deck. These are not relay throughput guarantees.
- The application is intended for trusted teams. It does not provide a permanent archive or protection against a malicious room participant. Removing someone is not a permanent ban.

## Development

Requires Node.js 22 or later. Source files are bundled into the root `index.html`.

```sh
npm ci
npm test
npm run build
npm start
```

`npm start` serves a local preview at `http://localhost:4173`. The preview server does not coordinate rooms.

- `src/app.js`: UI and interactions.
- `src/style.css`: layout, styling, and animation.
- `src/core.js`: room state and commit/reveal protocol.
- `src/transport.js`: Nostr transport, signatures, encryption, and reconnection.
- `src/connection.js`: connection status presentation.
- `test/`: unit tests and integration tests using a local WebSocket relay.
- `THIRD_PARTY_LICENSES.txt`: dependency licenses, also embedded in the built HTML.

Tests use synthetic names and tasks and communicate with a local relay rather than public relays.

After changing application sources, run the build and commit the updated `index.html` along with the source changes before pushing to `main`.

## License

[MIT](LICENSE). Third-party license notices are retained in the repository and built application.
