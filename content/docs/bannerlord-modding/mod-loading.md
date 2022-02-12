+++
title = "How mods are loaded"
date = 2021-05-01T08:00:00+00:00
updated = 2021-05-01T08:00:00+00:00
draft = false
weight = 10
sort_by = "weight"
template = "docs/page.html"

[extra]
lead = "Where's the entry point of my mod ? what defines it."
toc = true
top = false
+++

Mods are packaged in the *Modules* folder (where your Bannerlord game is saved) with along with a respective [`SubModule.xml` file](https://github.com/Bannerlord-Coop-Team/BannerlordCoop/blob/development/template/SubModule.xml) *(just below)* where the variable `${name}` is the name of the module folder.

```xml
<?xml version="1.0" encoding="utf-8"?>
<Module>
    <Name value="${name}"/>
    <Id value="${name}"/>
    <Version value="${version}"/>
    <SingleplayerModule value="true"/>
    <MultiplayerModule value="false"/>
    <DependedModules>
        <DependedModule Id="Native" DependentVersion="${game_version}"/>
        <DependedModule Id="SandBoxCore" DependentVersion="${game_version}"/>
        <DependedModule Id="Sandbox" DependentVersion="${game_version}"/>
        <DependedModule Id="CustomBattle" DependentVersion="${game_version}"/>
        <DependedModule Id="StoryMode" DependentVersion="${game_version}"/>
    </DependedModules>
    <SubModules>
        <SubModule>
            <Name value="${name}"/>
            <DLLName value="${name}.dll"/>
            <SubModuleClassType value="${name}.Mod.Main"/>
            <Tags>
                <Tag key="DedicatedServerType" value="none" />
                <Tag key="IsNoRenderModeElement" value="false" />
            </Tags>
        </SubModule>
    </SubModules>
</Module>
```

The `SubModuleClassType` tag represents the main input class that Bannerlord will initialize. In our case, the mod entry point is the class ``Main`` from the project ``Coop.Mod``.