import { DependencyContainer, injectable } from "tsyringe";

import { LocationCallbacks } from "@spt-aki/callbacks/LocationCallbacks";
import { DialogueController } from "@spt-aki/controllers/DialogueController";
import { GameController } from "@spt-aki/controllers/GameController";
import { LocationController } from "@spt-aki/controllers/LocationController";
import { AkiHttpListener } from "@spt-aki/servers/http/AkiHttpListener";
import { SaveServer } from "@spt-aki/servers/SaveServer";
import { HttpResponseUtil } from "@spt-aki/utils/HttpResponseUtil";


import { Friend, IGetFriendListDataResponse } from "@spt-aki/models/eft/dialog/IGetFriendListDataResponse";
import { IGameConfigResponse } from "@spt-aki/models/eft/game/IGameConfigResponse";
import { MemberCategory } from "@spt-aki/models/enums/MemberCategory";

import type { IPreAkiLoadMod } from "@spt-aki/models/external/IPreAkiLoadMod";
import type { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { HttpBufferHandler } from "@spt-aki/servers/http/HttpBufferHandler";
import type { DynamicRouterModService } from "@spt-aki/services/mod/dynamicRouter/DynamicRouterModService";
import type { StaticRouterModService } from "@spt-aki/services/mod/staticRouter/StaticRouterModService";

import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { IncomingMessage, ServerResponse } from "http";
import zlib from "zlib";

import { IEmptyRequestData } from "@spt-aki/models/eft/common/IEmptyRequestData";
import { IGetLocationRequestData } from "@spt-aki/models/eft/location/IGetLocationRequestData";
import { CoopConfig } from "./CoopConfig";
import { CoopMatch, CoopMatchEndSessionMessages, CoopMatchStatus } from "./CoopMatch";
import { ExternalIPFinder } from "./ExternalIPFinder";
import { WebSocketHandler } from "./WebSocketHandler";

import { RouteAction } from "@spt-aki/di/Router";
import { IPostDBLoadMod } from "@spt-aki/models/external/IPostDBLoadMod";
import moment from "moment";

@injectable()
export class Mod implements IPreAkiLoadMod, IPostDBLoadMod
{
    
    private static container: DependencyContainer;

    saveServer: SaveServer;
    locationController: LocationController;
    httpBufferHandler: HttpBufferHandler;
    protected httpResponse: HttpResponseUtil;
    databaseServer: DatabaseServer;
    public webSocketHandler: WebSocketHandler;
    public externalIPFinder: ExternalIPFinder;
    public coopConfig: CoopConfig;
    locationData: object = {};
    locationData2: object = {};

    public getCoopMatch(serverId: string) : CoopMatch {

        if(serverId === undefined) {
            console.error("getCoopMatch -- no serverId provided");
            return undefined;
        }

        if(CoopMatch.CoopMatches[serverId] === undefined) {
            console.error(`getCoopMatch -- no server of ${serverId} exists`);
            return undefined;
        }

        return CoopMatch.CoopMatches[serverId];
    } 

    public preAkiLoad(container: DependencyContainer): void {

        Mod.container = container;
        const logger = container.resolve<ILogger>("WinstonLogger");
        const dynamicRouterModService = container.resolve<DynamicRouterModService>("DynamicRouterModService");
        const staticRouterModService = container.resolve<StaticRouterModService>("StaticRouterModService");
        this.saveServer = container.resolve<SaveServer>("SaveServer");
        CoopMatch.saveServer = this.saveServer;
        this.locationController = container.resolve<LocationController>("LocationController");
        this.httpBufferHandler  = container.resolve<HttpBufferHandler>("HttpBufferHandler");
        this.databaseServer = container.resolve<DatabaseServer>("DatabaseServer");
        this.httpResponse = container.resolve<HttpResponseUtil>("HttpResponseUtil");

        
        this.coopConfig = new CoopConfig();
        this.webSocketHandler = new WebSocketHandler(this.coopConfig.webSocketPort, logger);

        // 
        this.externalIPFinder = new ExternalIPFinder();

        // ----------------------------------------------------------------
        // TODO: Coop server needs to save and send same loot pools!

        dynamicRouterModService.registerDynamicRouter(
            "sit-coop-loot",
            [
                new RouteAction(
                    "/coop/server/spawnPoint",
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    (url: string, info: any, sessionID: string, output: string): any =>
                    {

                        const splitUrl = url.split("/");
                        const matchId = splitUrl.pop();

                        var spawnPoint = { x: 0, y: 0, z: 0 };
                        if(matchId !== undefined) {
                            // console.log("matchId:" + matchId);
                            spawnPoint = this.getCoopMatch(matchId).SpawnPoint;
                        }


                        output = JSON.stringify(spawnPoint);
                        return output;
                    }
                ),
            ]
            ,"aki"
        )

        staticRouterModService.registerStaticRouter(
            "MyStaticModRouter",
            [
                {
                    url: "/coop/server/create",
                    action: (url, info: any, sessionId, output) => {
                        logger.info(`Start a Coop Server ${sessionId}`);
                        // logger.info("Coop Data:_________");
                        // logger.info(info);
                        // logger.info("___________________");
                        let currentCoopMatch = CoopMatch.CoopMatches[info.serverId];
                        if(currentCoopMatch !== undefined && currentCoopMatch !== null) {
                            currentCoopMatch.endSession(CoopMatchEndSessionMessages.HOST_SHUTDOWN_MESSAGE);
                            delete CoopMatch.CoopMatches[info.serverId];
                            currentCoopMatch = undefined;
                        }

                        CoopMatch.CoopMatches[info.serverId] = new CoopMatch(info);
                        // this.CoopMatches[info.serverId].Settings = info.settings;
                        CoopMatch.CoopMatches[info.serverId].Location = info.settings.location;
                        CoopMatch.CoopMatches[info.serverId].Time = info.settings.timeVariant;
                        CoopMatch.CoopMatches[info.serverId].WeatherSettings = info.settings.timeAndWeatherSettings;
                        output = JSON.stringify({ serverId:  info.serverId });
                        return output;
                    }
                },
                {
                    url: "/coop/server/exist",
                    action: (url, info, sessionId, output) => {
                        
                        let coopMatch: CoopMatch = null;
                        for (let cm in CoopMatch.CoopMatches)
                        {
                            // logger.info(JSON.stringify(this.CoopMatches[cm]));

                            if (CoopMatch.CoopMatches[cm].Location != info.location)
                                continue;

                            if(CoopMatch.CoopMatches[cm].Time != info.timeVariant)
                                continue;

                            if (CoopMatch.CoopMatches[cm].Status == CoopMatchStatus.Complete)
                                continue;

                            if (CoopMatch.CoopMatches[cm].LastUpdateDateTime < new Date(Date.now() - (1000 * 5)))
                                continue;

                            coopMatch = CoopMatch.CoopMatches[cm];
                        }
                        logger.info(coopMatch !== null ? "match exists" : "match doesn't exist!");

                        output = JSON.stringify(coopMatch !== null ? { ServerId: coopMatch.ServerId } : null);
                        return output;
                    }
                },
                {
                    url: "/coop/server/read/players",
                    action: (url, info, sessionId, output) => {
                        
                        // ---------------------------------------------------------------------------------------------------
                        // This call requires the client to pass what players/bots it knows about to filter the response back!

                        let coopMatch = this.getCoopMatch(info.serverId);
                        if(coopMatch == null || coopMatch == undefined)
                        {
                            output = JSON.stringify({});
                            return output; 
                        }

                        //
                        let charactersToSend:any[] = [];
                        let playersToFilterOut:string[] = info.pL;
                        for(var c of coopMatch.Characters) {
                            if(!playersToFilterOut.includes(c.accountId)) {
                                charactersToSend.push(c);
                            }
                        }

                        output = JSON.stringify(charactersToSend);
                        // console.log(output);
                        return output;
                    }
                },
                {
                    url: "/coop/server/update",
                    action: (url, info, sessionId, output) => {
                        if(info === undefined || info.serverId === undefined) {

                            if(JSON.stringify(info).charAt(0) === '[') {
                                for(var item of info) {
                                    let coopMatch = this.getCoopMatch(item.serverId);
                                    if(coopMatch === undefined)
                                        break;

                                    coopMatch.ProcessData(item, logger);
                                }
                                output = JSON.stringify({});
                                return output; 
                            }

                            console.error("/coop/server/update -- no info or serverId provided");
                            output = JSON.stringify({ response: "ERROR" });
                            return JSON.stringify({ response: "ERROR" });
                        }

                        // let timeCheck = Date.now();

                        // console.log(info);
                        let coopMatch = this.getCoopMatch(info.serverId);
                        if(coopMatch == null || coopMatch == undefined)
                        {
                            console.error("/coop/server/update -- no coopMatch found to update");

                            output = JSON.stringify({});
                            return output; 
                        }

                        coopMatch.ProcessData(info, logger);
                        

                        // 
                        // console.log(Date.now() - timeCheck);


                        output = JSON.stringify({});
                        return output;
                    }
                },
                {
                    url: "/coop/server/delete",
                    action: (url, info, sessionId, output) => {
                        // logger.info("Update a Coop Server");
                        console.log(info);
                        output = JSON.stringify({ response: "OK" });
                        return JSON.stringify({ response: "OK" });
                    }
                },
                {
                    url: "/coop/get-invites",
                    action: (url: string, info: any, sessionID: string, output: string): any => 
                    {
                        logger.info("Getting Coop Server Invites")
                        const obj = {
                            "players": [{}, {}],
                            "invite": [],
                            "group": []
                        };

                        output = JSON.stringify(obj);
                        return output;
                    }
                },
                {
                    url: "/coop/server-status",
                    action: (url, info, sessionId, output) => 
                    {
                        logger.info("Getting Coop Server Match Status")
                        return "";
                    }
                },
               
                
                
                
            ],
            "sit-coop"
            // "aki"
        );

        // Hook up to existing AKI static route
        staticRouterModService.registerStaticRouter(
            "MatchStaticRouter-SIT",
            [
                {
                    url: "/client/match/group/status",
                    action: (url: string, info: any, sessionID: string, output: string): any => 
                    {
                        logger.info("/client/match/group/status")
                        logger.info("Getting Coop Server Match Status")
                        const obj = {
                            "players": [],
                            "invite": [],
                            "group": []
                        };
                        output = JSON.stringify(obj);
                        return output;
                    }
                },
                // {
                //     url: "/client/match/group/current",
                //     action: (url: string, info: any, sessionID: string, output: string): any => 
                //     {
                //         logger.info("/client/match/group/current")
                //         logger.info("TODO: Look into Getting Group Current")

                //         const myAccount = this.saveServer.getProfile(sessionID);
                //         if(myAccount === undefined) { 
                //             console.log("own account cannot be found");
                //             return null;
                //         }
                //         let squadList: Friend[] = [];
                //         // console.log(allAccounts);
                //         // {
                //         //     let squadMember: Friend = {
                //         //         _id: myAccount.info.id,
                //         //         Info: {
                //         //             Level: myAccount.characters.pmc.Info.Level,
                //         //             Nickname: myAccount.info.username,
                //         //             Side: myAccount.characters.pmc.Info.Side,
                //         //             MemberCategory: MemberCategory.DEFAULT
                //         //         }
                //         //     };
                //         //     squadList.push(squadMember);
                //         // }


                //         const obj = {
                //             squad: squadList,
                //             raidSettings: {}
                //         };
                //         output = JSON.stringify({ data: obj, err: 0, errmsg: null });
                //         return output;
                //     }
                // },
                {
                    url: "/client/match/group/exit_from_menu",
                    action: (url: string, info: any, sessionID: string, output: string): any => 
                    {
                        logger.info("exit_from_menu")
                        output = JSON.stringify({});
                        return output;
                    }
                }
                ,{
                    url: "/client/match/group/exit_from_menu",
                    action: (url: string, info: any, sessionID: string, output: string): any => 
                    {
                        logger.info("exit_from_menu")
                        output = JSON.stringify({});
                        return output;
                    }
                },
                {
                    url: "/client/raid/person/killed",
                    action: (url: string, info: any, sessionID: string, output: string): any => 
                    {
                        logger.info("Person has been Killed!")
                        console.log(info);
                        output = JSON.stringify(info);
                        return output;
                    }
                },
                {
                    url: "/client/raid/createFriendlyAI",
                    action: (url: string, info: any, sessionID: string, output: string): any => 
                    {
                        // logger.info("Person has been Killed!")
                        console.log(info);
                        output = JSON.stringify(info);
                        return output;
                    }
                },
                {
                    url: "/client/match/raid/ready",
                    action: (url: string, info: any, sessionID: string, output: string): any => 
                    {
                        console.log(url);
                        console.log(info);
                        console.log(sessionID);
                        output = JSON.stringify({});
                        return output;
                    }
                },
                {
                    url: "/client/match/raid/not-ready",
                    action: (url: string, info: any, sessionID: string, output: string): any => 
                    {
                        console.log(url);
                        console.log(info);
                        console.log(sessionID);
                        output = JSON.stringify({});
                        return output;
                    }
                },
                {
                    url: "/client/match/group/invite/cancel-all",
                    action: (url: string, info: any, sessionID: string, output: string): any => 
                    {
                        console.log(url);
                        console.log(info);
                        console.log(sessionID);
                        output = JSON.stringify({});
                        return output;
                    }
                },
                {
                    url: "/client/match/available",
                    action: (url: string, info: any, sessionID: string, output: string): any => 
                    {
                        console.log(url);
                        console.log(info);
                        console.log(sessionID);
                        output = JSON.stringify(false);
                        return output;
                    }
                }
            ],
            "aki"
        );


        container.afterResolution("LocationCallbacks", (_t, result: LocationCallbacks) => {

            // result.getLocationData = (url: string, info: IEmptyRequestData, sessionID: string) => {


            // }

            result.getLocation = (url: string, info: IGetLocationRequestData, sessionID: string) => {

                // This is HACK to test out getting same loot on multiple clients
                if (this.locationData[info.locationId] === undefined) {
                    this.generateNewLootForLocation(info.locationId, sessionID);
                }

                // This is a HACK. For some reason (not figured out yet) the Loot field empties after it has been generated. So refilling it here.
                if (this.locationData[info.locationId].Data.Loot.length === 0
                    && this.locationData[info.locationId].GenerationDate > moment().add(-10, "minutes")
                    ) 
                {
                    this.locationData[info.locationId].Data.Loot = this.locationData[info.locationId].Loot;
                }
                else {
                    this.generateNewLootForLocation(info.locationId, sessionID);
                }

                return this.httpResponse.getBody(this.locationData[info.locationId].Data);

            }

            result.getAirdropLoot = (url: string, info: IEmptyRequestData, sessionID: string) => {

                let generatedLoot = this.locationController.getAirdropLoot();
                // let coopMatch = CoopMatch.CoopMatches[sessionID];
                // if(coopMatch !== undefined) {
                //     coopMatch.AirdropLoot = generatedLoot;
                // }
                // // TODO: Find the Coop Match I am in!
                // else {
                //     for(const cm in CoopMatch.CoopMatches) {
                //         generatedLoot = CoopMatch.CoopMatches[cm].AirdropLoot;
                //     }
                // }

                return this.httpResponse.noBody(generatedLoot);
                
            }

        }, {frequency: "Always"});

        container.afterResolution("LocationController", (_t, result: LocationController) => {

            result.get = (location: string) => {

                if (this.locationData2[location] === undefined) {

                    const name = location.toLowerCase().replace(" ", "");
                    this.locationData2[location] = result.generate(name);
                }
                
                return this.locationData2[location];
            }


        }, {frequency: "Always"});

        /**
         * WIP/UNUSED FEATURE: GET FRIENDS LIST
         */
        container.afterResolution("DialogueController", (_t, result: DialogueController) => 
        {
            // We want to replace the original method logic with something different
            result.getFriendList = (sessionID: string) => 
            {
                return this.getFriendsList(sessionID);
            }
            // The modifier Always makes sure this replacement method is ALWAYS replaced
        }, {frequency: "Always"});

        /**
         * MUST HAVE: REPLACE HTTP REQUEST HANDLER
         */
        container.afterResolution("AkiHttpListener", (_t, result: AkiHttpListener) => 
        {
            result.handle = (sessionId: string, req: IncomingMessage, resp: ServerResponse) => 
            {
                return this.sitHttpHandler(sessionId, req, resp, result);
            }
        }, {frequency: "Always"});
        
        /**
         * MUST HAVE: REPLACE GAME CONFIG SO IP CAN BE EXTERNAL
         */
        container.afterResolution("GameController", (_t, result: GameController) => 
        {
            // We want to replace the original method logic with something different
            result.getGameConfig = (sessionID: string) => 
            {
                return this.getGameConfig(sessionID);
            }
            // The modifier Always makes sure this replacement method is ALWAYS replaced
        }, {frequency: "Always"});


        /**
         * MUST HAVE: WEB SOCKET ON CONNECTION
         * wsOnConnection is "protected", need to get SPT-Aki to release it! *facepalm*
         */
        // container.afterResolution("WebSocketServer", (_t, result: WebSocketServer) => 
        // {
        //     const originalMethod = result.wsOnConnection;

        //     // We want to replace the original method logic with something different
        //     result.wsOnConnection = (ws: WebSocket, req: IncomingMessage) => 
        //     {
        //         // Strip request and break it into sections
        //         const splitUrl = req.url.substring(0, req.url.indexOf("?")).split("/");
        //         const sessionID = splitUrl.pop();

        //         ws.on("message", function message(msg) 
        //         {
        //             logger.info(`message from ${sessionID} ${msg}`);
        //         });

        //         // this.logger.info(this.localisationService.getText("websocket-player_connected", sessionID));

        //         // const logger = this.logger;
        //         // const msgToLog = this.localisationService.getText("websocket-received_message", sessionID);
        //         // ws.on("message", function message(msg) 
        //         // {
        //         //     logger.info(`${msgToLog} ${msg}`);
        //         // });

        //         // this.webSockets[sessionID] = ws;

        //         // if (this.websocketPingHandler) 
        //         // {
        //         //     clearInterval(this.websocketPingHandler);
        //         // }

        //         // this.websocketPingHandler = setInterval(() => 
        //         // {
        //         //     this.logger.debug(this.localisationService.getText("websocket-pinging_player", sessionID));

        //         //     if (ws.readyState === WebSocket.OPEN) 
        //         //     {
        //         //         ws.send(JSON.stringify(this.defaultNotification));
        //         //     }
        //         //     else 
        //         //     {
        //         //         this.logger.debug(this.localisationService.getText("websocket-socket_lost_deleting_handle"));
        //         //         clearInterval(this.websocketPingHandler);
        //         //         delete this.webSockets[sessionID];
        //         //     }
        //         // }, this.httpConfig.webSocketPingDelayMs);
        //     }
        //      // The modifier Always makes sure this replacement method is ALWAYS replaced
        //  }, {frequency: "Always"});
    }

    public generateNewLootForLocation(locationId:string, sessionID:string) {
        this.locationData[locationId] = {};
        this.locationData[locationId].Data = this.locationController.get(locationId);
        this.locationData[locationId].Loot = this.locationData[locationId].Data.Loot;
        this.locationData[locationId].GenerationDate = new Date(Date.now());

        const ownedCoopMatch = this.getCoopMatch(sessionID);
        if(ownedCoopMatch !== undefined) {
            ownedCoopMatch.Loot = this.locationData[locationId].Loot;
        }
    }

    public getFriendsList(sessionID: string): IGetFriendListDataResponse
    {
        console.log("getFriendsList");
        const friends = this.getFriendsForUser(sessionID);

        return {
            "Friends": friends,
            "Ignore": [],
            "InIgnoreList": []
        };
    }

    public getFriendsForUser(sessionID: string): Friend[]
    {
        const allAccounts = this.saveServer.getProfiles();
		const myAccount = this.saveServer.getProfile(sessionID);
		if(myAccount === undefined) { 
			console.log("own account cannot be found");
			return null;
		}
        let friendList: Friend[] = [];
        // console.log(allAccounts);
        for (const id in allAccounts)
        {
            if(id == sessionID)
                continue;
            let accountProfile = this.saveServer.getProfile(id);
            let friend: Friend = {
                _id: accountProfile.info.id,
                Info: {
                    Level: accountProfile.characters.pmc.Info.Level,
                    Nickname: accountProfile.info.username,
                    Side: accountProfile.characters.pmc.Info.Side,
                    MemberCategory: MemberCategory.DEFAULT
                }
            };
            friendList.push(friend);
        }

        return friendList;
    }

    public getGameConfig(sessionID: string): IGameConfigResponse
    {
        let externalIp = `http://${this.coopConfig.externalIP}:6969`;

        if(this.coopConfig.useExternalIPFinder) { 
            console.log(`============================================================`);
            console.log(`COOP: Auto-External-IP-Finder`);
            externalIp = "http://" + this.externalIPFinder.IP + ":6969";
            console.log(externalIp);
            console.log(`============================================================`);
        }

        const config: IGameConfigResponse = {
            languages: this.databaseServer.getTables().locales.languages,
            ndaFree: false,
            reportAvailable: false,
            twitchEventMember: false,
            lang: "en",
            aid: sessionID,
            taxonomy: 6,
            activeProfileId: `pmc${sessionID}`,
            backend: {
                Lobby: externalIp,
                Trading: externalIp,
                Messaging: externalIp,
                Main: externalIp,
                RagFair: externalIp,
            },
            utc_time: new Date().getTime() / 1000,
            totalInGame: 1
        };

        return config;
    }


    /**
     * This replaces Aki's Http Handler with a much better one that can asyncronously handle large POST requests without an error
     * @param sessionId 
     * @param req 
     * @param resp 
     * @param result 
     */
    public sitHttpHandler(sessionId: string, req: IncomingMessage, resp: ServerResponse, result: AkiHttpListener)
    {
        // TODO: cleanup into interface IVerbHandler
        switch (req.method)
        {
            case "GET":
            {
                const response = result.getResponse(sessionId, req, null);
                result.sendResponse(sessionId, req, resp, null, response);
                break;
            }
            case "POST":
            {
                req.on("data", async (data: any) =>
                {
                    if (sessionId === undefined)
                        sessionId = "launcher";

                    const requestLength = parseInt(req.headers["content-length"]);
                            
                    if (!this.httpBufferHandler.putInBuffer(sessionId, data, requestLength))
                    {
                        resp.writeContinue();
                    }
                });

                req.on("end", async () =>
                {
                    if (sessionId === undefined)
                        sessionId = "launcher";

                    const data = this.httpBufferHandler.getFromBuffer(sessionId);
                    const value = (req.headers["debug"] === "1") ? data.toString() : zlib.inflateSync(data);
                    if (req.headers["debug"] === "1") 
                    {
                        console.log(value.toString());
                    }
                    this.httpBufferHandler.resetBuffer(sessionId);
                    
                    const response = result.getResponse(sessionId, req, value);
                    result.sendResponse(sessionId, req, resp, value, response);
                });

                
                break;
            }
            case "PUT":
            {
                req.on("data", (data) =>
                {
                    // receive data
                    //if ("expect" in req.headers)
                    {
                        const requestLength = parseInt(req.headers["content-length"]);
                            
                        if (!this.httpBufferHandler.putInBuffer(req.headers.sessionid, data, requestLength))
                        {
                            resp.writeContinue();
                        }
                    }
                });
                    
                req.on("end", async () =>
                {
                    const data = this.httpBufferHandler.getFromBuffer(sessionId);
                    this.httpBufferHandler.resetBuffer(sessionId);
                    
                    let value = zlib.inflateSync(data);
                    if (!value)
                    {
                        value = data;
                    }
                    const response = result.getResponse(sessionId, req, value);
                    result.sendResponse(sessionId, req, resp, value, response);
                });
                break;
            }
            default:
            {
                break;
            }
        }
    }




    postDBLoad(container: DependencyContainer): void {
        Mod.container = container;
        const locations = Mod.container.resolve<DatabaseServer>("DatabaseServer").getTables().locations;
        this.updateExtracts(locations);
    }

    private updateExtracts(locations: any):void
    {
        // Initialize an array of all of the location names
        const locationNames = [
            "bigmap",
            "factory4_day",
            "factory4_night",
            "interchange",
            "laboratory",
            "lighthouse",
            "rezervbase",
            "shoreline",
            "tarkovstreets",
            "woods"
        ];
        
        // Loop through each location
        for (const location of locationNames)
        {
            // Loop through each extract
            for (const extract in locations[location].base.exits)
            {
                const extractName = locations[location].base.exits[extract].Name;

                // Make extracts available no matter what side of the map you spawned.
                const newEntryPoint = this.getEntryPoints(locations[location].base.Id);
                if (locations[location].base.exits[extract].EntryPoints !== newEntryPoint)
                {
                    locations[location].base.exits[extract].EntryPoints = newEntryPoint;
                }
                
                    
                // If this is a train extract... Move on to the next extract.
                if (locations[location].base.exits[extract].PassageRequirement === "Train")
                {
                    continue;
                }

                if (locations[location].base.exits[extract].PassageRequirement === "ScavCooperation")
                {
                    locations[location].base.exits[extract].PassageRequirement = "TransferItem";
                    locations[location].base.exits[extract].RequirementTip = "EXFIL_Item";
                }

                locations[location].base.exits[extract].ExfiltrationType = "Individual";
                locations[location].base.exits[extract].PlayersCount = 0;
            }
        }
    }

    private getEntryPoints(location:string):string
    {
        switch (location) {
            case "bigmap":
                return "Customs,Boiler Tanks";
            case "factory4_day":
                return "Factory";
            case "factory4_night":
                return "Factory";
            case "Interchange":
                return "MallSE,MallNW";
            case "laboratory":
                return "Common";
            case "Lighthouse":
                return "Tunnel,North";
            case "RezervBase":
                return "Common";
            case "Shoreline":
                return "Village,Riverside";
            case "TarkovStreets":
                return "E1_2,E6_1,E2_3,E3_4,E4_5,E5_6,E6_1"
            case "Woods":
                return "House,Old Station";
            default:
                return "";
        }
    }

}
module.exports = {mod: new Mod()}