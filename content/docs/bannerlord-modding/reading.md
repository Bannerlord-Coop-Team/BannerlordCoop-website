+++
title = "Reading"
date = 2021-05-01T08:00:00+00:00
updated = 2021-05-01T08:00:00+00:00
draft = false
weight = 10
sort_by = "weight"
template = "docs/page.html"

[extra]
lead = 'TaleWorlds did not provide us with technical documentation so we have to find a way to understand what is going on.'
toc = true
top = false
+++

That's why we use [dnSpy](https://github.com/0xd4d/dnSpy/releases) to view Bannerlord code as it can **decompile, analyze, and debug dlls**.

Bannerlord dlls can be opened using dnspy and are found in `{Bannerlord Directory}\bin\Win64_Shipping_Client`.

## Using dnSpy

You can analyze existing code by right clicking on an *object/method/variable* and selecting **Analyze**.

This allows you to know where this code is used and what is using it.

![dnSpy Analyse](/dnspy_analyze.jpg)