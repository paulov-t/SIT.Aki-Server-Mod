<div align=center style="text-align: center;">
<h1> Stay in Tarkov </h1>
A SPT-Aki mod to be used with SPT-Aki Server to allow the Coop Module to communicate with the SPT-Aki Server.
</div>

<div align=center style="text-align: center;">
<h1> Stay in Tarkov has moved </h1>
Please use the [new repository](https://github.com/stayintarkov/SIT.Aki-Server-Mod) which is managed by a group of Contributors of the original Stay In Tarkov
</div>

---

<div align=center>

![GitHub all releases](https://img.shields.io/github/downloads/paulov-t/SIT.Aki-Server-Mod/total) ![GitHub release (latest by date)](https://img.shields.io/github/downloads/paulov-t/SIT.Aki-Server-Mod/latest/total)

</div>

---

## Summary

This is the SERVER modification of [SPT-Aki](https://www.sp-tarkov.com/) to allow the [Coop Module](https://github.com/paulov-t/SIT.Core) to communicate with the SPT-Aki Server.

## How to use this Repo?

* Install SIT via the Launcher (or manually)
* Download and Install the latest SPT-Aki Server
* Download the [latest "Source code" release](https://github.com/paulov-t/SIT.Aki-Server-Mod/releases) (preferred) or use the code clone above (if you are feeling brave and like bugs)
* Install this repo into the server /user/mods/ folder
* Rename the folder SITCoop

## How do I set up this mod?

### Coop Config JSON
* You must configure the file called coopConfig.json in your SITCoop/config folder. This file is auto generated on first run of the mod.

#### IF you are using PORT FORWARDING
* In the file you must use the following config, replacing `127.0.0.1` with your own IPv4 from https://www.whatismyip.com and set useExternalIPFinder to false 
* OR set useExternalIPFinder to true

#### IF you are using HAMACHI or other VPN service
* set useExternalIPFinder to false
* set externalIP to your desired IP from the service

### Http.json

* Open Aki_Data\Server\configs\http.json with your favourite text editor
* Change the `ip` setting to your internal network IP of your Computer Primary Network (Ethernet or Wi-Fi)
* Change the `logRequests` setting to `false` to prevent log spam


## Installing SPT-Aki to Azure Web Services
https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs
