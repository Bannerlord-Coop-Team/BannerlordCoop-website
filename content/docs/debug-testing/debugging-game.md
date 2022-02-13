+++
title = "Debugging tools"
date = 2021-05-01T08:00:00+00:00
updated = 2021-05-01T08:00:00+00:00
draft = false
weight = 10
sort_by = "weight"
template = "docs/page.html"

[extra]
lead = "One day you will need to debug your code."
+++

If you know methods to debug C# applications, you are free to use this one otherwise we present you some here. 
present you some of them here.

## Visual studio way

One of the classic ways to debug an application is to put [breakpoint](https://docs.microsoft.com/en-us/visualstudio/debugger/using-breakpoints?view=vs-2022) on specific part of your project and to check what you want.

![Breakpoint](https://docs.microsoft.com/en-us/visualstudio/debugger/media/vs-2022/breakpoint-execution.png?view=vs-2022)


## Mod utilities

We have added [an interface](https://github.com/Bannerlord-Coop-Team/BannerlordCoop/blob/development/source/Coop/Mod/DebugUtil/DebugUI.cs) based on the ``imgui`` library within the game to simply visualize the important data of the mod.

You can access it by using the keys ``leftCtrl + ~``.

![Debug UI](/debug_ui.jpg)

## Logging

We use the [NLog](https://github.com/nlog/nlog/wiki) library to log specific information during the application, the configuration that we are using (that you can find on the [`Logging`](https://github.com/Bannerlord-Coop-Team/BannerlordCoop/blob/development/source/Coop/Mod/Logging.cs) class) is the following:

- File: available on Bannerlord source `bin\Win64_Shipping_Client\`
    - For the server (Coop_0.log)
    - For the client (Coop_1.log)
- UDP through `NLogViewerTarget`
- Debugger (*disabled by default)*