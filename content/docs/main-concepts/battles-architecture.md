+++
title = "Battles architecture"
date = 2021-05-01T08:00:00+00:00
updated = 2021-05-01T08:00:00+00:00
draft = false
weight = 10
sort_by = "weight"
template = "docs/page.html"

[extra]
lead = 'To manage state synchronization, we use the Railgun library as follows.'
toc = true
top = false
+++

## Server Architecture

### Overview

The server is responsible for efficiently providing multi-agent syncing for battles, places players can visit, and the output of said battles. The server would need to provide real time synchronization for a total of floor(N / 2) places where N is the number of players in a server. For example, in a server where there are 7 people, sync would only happen when 2+ people are in a battle. Thus, assuming worst case, we would have 3 1v1, and 1 idle player. This would verifies that floor(7/2) = 3. In a server architecture, a single instance of a server can technically handle all the clients on 1 process. This allows for the server to be scaled horizontally rather than vertically. Here is a diagram that describes the process: ServerArchitecture The server keeps track of 3 distinct things:

![Battle server architecture](/battle_architecture.png)

1. Unique battles IDs
2. Unique client IDs
3. Notable Place IDs (static)

- Client ID maps to a Battle ID
- Battle ID maps to a list of Client IDs
- Notable Place IDs loaded from the server. Clients are expected to send the correct ID.

### Encounters

Players can encounter other players on the map, or players that are in a battle with AI. These are custom encounters that need to be generated, and the interactions between the players are specific. For the initial release, encounters with players in battles (to reinforce or fight against) could be disabled. Such encounters need to be limited to prevent grieving; in the case where a player might interrupt another player and keep the dialog open, or the player constantly interacts with another player. This is true for notable places as well.

#### Player, NPC, Player Interaction
In the case where a player runs into an NPC (say a lord), an encounter is created. This encounter will be associated with the player that initiated it. No server syncing is needed so far. If another player decides to join this encounter before a battle start, they can. This will lead to a custom encounter for the joining player. The joining player can choose which side to help and wait for the player that created the encounter to start the battle. The custom encounter ensures the joining player waits for the other player to start the battle or cancel the encounter all together. The joining player will send the following message to the server.\

`MessageType | PartySideToJoin | Num of Encountered Lords | List of Encounter Lords IDs`

#### Player, Player Interaction

Player/Player interaction is a custom interaction that will result in an encounter. The server will load the character’s data, and show each player two options:

1. Offer to Trade
2. Battle!

### Notable Places

Notable places get loaded from the server’s game instance. Each notable place is a pair of IDs. One that describes the location on the map, and the second describes a place in that location. Example: (Sargot, Arena) or (Charas, Tavern) When a player visit an Arena, the values get sent as follows:

`MessageType | ClientI | LocationPlacePair`

This lets the server know someone visited a notable place. The server will add this client to a list and check if the # of clients for the LocationPlacePair is > 1. If yes, the server will send updates of the other client(s) to each other.

### Battles/Scenes
One client asks to battle another client
Server generates a batteID, and based on their location, a scene ID.

The server passes the following tuples to each client:\
`BatteID | SceneID`

Each client will spawn its troops, then send the data about each agent to the server:\
`BatteID | SceneID | ListOfAgenet`

List of Agents will contain the following:\
`AgentIndex | AgentVisuals`

The server will keep a mapping between an internal index and the client’s index. For any client, the other clients first agent index will start from be CLIENT_A_LAST_INDEX + 1 and will end at CLIENT_A_LAST_INDEX + CLIENT_B_COUNT. Thus if client A sends an update for its second agent movement, it would be AGENTS[CLIENT_A_LAST_INDEX + 2]. The server will keep an internal order of parties and perform these conversions before sending updates.

### Battle Results
TBD

## Character Synchronization

### Movements

Character movements will be sent to the server at n ticks. Each client will send the information about its main hero and all its units. The server will verify this information and pass it back to all clients If the location doesn’t make sense, the server will teleport the player/character to its last known location.

### Events/Actions

When a character swings, the swing is sent to the server. If the client claims the swing did damage, the damage information will be sent to the server for verification. If it passes, the damage will be registered and sent to all the clients. Therefore, all actions that cause feedback (swing, release arrow, block) need to be animated and not actual actions that cause any change. The change will be supplied by the server and applied to all clients. If it doesn’t no damage will be recorded on any of the clients. Events need guarantee of arrival (unlike movement) so a reliable UDP connection is required. An example of events / actions:\

`ActionType | AgentID | AgentLocationDirection`