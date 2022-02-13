+++
title = "Architecture"
date = 2021-05-01T08:00:00+00:00
updated = 2021-05-01T08:00:00+00:00
draft = false
weight = 10
sort_by = "weight"
template = "docs/page.html"

[extra]
lead = "Nobody understands that, neither do I."
toc = true
top = false
+++

![Architecture](/architecture.jpg)

## Components

### Network

- Offers basic network connection handling for server and clients.
- Defines a protocol for client-server communication.
- Implementation of protocol packet handlers.
- Connection state transitions for client & server.


### Protocol

The protocol describes communication between client and server in multiple stages:

1. Establish a connection.
2. Exchange initial world state.
3. Keep the state in sync. Detailed documentation about the protocol can be found in Network.Protocol.


### Sync

Library to declare fields whose values are supposed to be synchronized.

- Watches for local changes to registered fields.
- Offers callbacks for local change requests.
- Offers generic interface to read & write values.


### Mod

Handles everything interacting directly with game state or logic.


### Issues

Persistence should be refactored into a separate layer.