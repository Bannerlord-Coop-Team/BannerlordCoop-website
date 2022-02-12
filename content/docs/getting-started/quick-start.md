+++
title = "Quick Start"
description = "One page summary of how to start developing the core mod."
date = 2021-05-01T08:20:00+00:00
updated = 2021-05-01T08:20:00+00:00
draft = false
weight = 20
sort_by = "weight"
template = "docs/page.html"

[extra]
lead = "One page summary of how to start a developing."
toc = true
top = false
+++

## Requirements

Before getting started with modding we need to install some software.

- [Visual Studio](https://docs.microsoft.com/en-us/visualstudio/releases/2019/release-notes) *2019*
- [Github Desktop](https://desktop.github.com/) *(optional)*
- [dnSpy](https://github.com/0xd4d/dnSpy/releases)
- [.NET Framework](https://dotnet.microsoft.com/download/dotnet-framework/net472) *4.7.2*
 

## Download repository

```bash
git clone https://github.com/Bannerlord-Coop-Team/BannerlordCoop.git
cd BannerlordCoop
git submodule init && git submodule update --recursive --force
```

## Installation

To work properly with Bannerlord, you will need to dynamically attach your Bannerlord path and resolve references.

### Attach Bannerlord path & resolve refs

To do this, run the file ``runmefirst.cmd``


#### In case of issue

If references in projects did not resolved automatically do the following. 

1. This can be done in Visual Studio by right-clicking references, going to browse, navigating to your Bannerlord directory through the mb2 shortcut, and selecting all TaleWorld.* .dlls. There are additional .dlls in the Modules folder, being the Native and StoryMode.
2. Click start external program and browse to your Bannerlord path. You should select the executable for Bannerlord normally located at ``bin\Win64_Shipping_Client\Bannerlord.exe``
3. For the command line arguments enter this ``/singleplayer /server _MODULES_*Native*SandBoxCore*CustomBattle*SandBox*StoryMode*Coop*_MODULES_``
4. Now we need to enter the working directory. NOTE: This will select a folder, not a file. The folder you need to select for this is ``bin\Win64_Shipping_Client``. The same path that ``Bannerlord.exe`` is located.


### Setup a second client 

If you want two clients (one that acts as a server, and a simple client) follow the instructions below:

1. Open the ClientDebug properties
    1. Go to debug 
    2. External program: ``bin\Win64_Shipping_Client\Bannerlord.exe`` 
    2. Command line arguments: ``/singleplayer /client _MODULES_*Native*SandBoxCore*CustomBattle*SandBox*StoryMode*Coop*_MODULES_.``
<br/>
2. Open the Solution 'Coop' properties 
    1. Select the Startup Projects tab
    2. Select "Multiple startup projects" and make sure Coop and ClientDebug are set to start.


### Start a game server

For the moment, it is not possible to select a backup to play on, the one used by default by the mod is the backup named ``MP``.
If you do not have one, follow these instructions:

1. Create a new game and save it as "MP"
2. Click on "host game" at the menu and the game will load the "MP" save file on the host.

