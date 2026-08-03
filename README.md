# BannerlordCoop Website

The Zola source for the BannerlordCoop website.

## Nightly installer

`static/server/install.ps1` is published as:

```powershell
irm https://bannerlordcoop.com/server/install.ps1 | iex
```

The installer reads the completed client/server pair from the public R2
`nightly/release.json` manifest. The dedicated-server nightly workflow uploads
both archives and publishes that manifest last, so a client and server from
different builds are never presented as a completed release.

The custom domain must also be configured under this repository's GitHub Pages
settings and in DNS before the command is usable.

