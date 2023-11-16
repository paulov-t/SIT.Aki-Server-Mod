import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { IncomingMessage } from "http";
import WebSocket, { RawData } from "ws";
import { CoopMatch } from "./CoopMatch";

export class WebSocketHandler {

    public webSockets: Record<string, WebSocket.WebSocket> = {};
    logger: ILogger;
    public static Instance: WebSocketHandler;

    constructor(
        webSocketPort: number
        , logger: ILogger
        )
        { 
            WebSocketHandler.Instance = this;
            this.logger = logger;
            const webSocketServer = new WebSocket.Server({
                "port": webSocketPort,
                perMessageDeflate: {
                    zlibDeflateOptions: {
                      // See zlib defaults.
                      chunkSize: 1024,
                      memLevel: 7,
                      level: 3
                    },
                    zlibInflateOptions: {
                      chunkSize: 10 * 1024
                    },
                    // Other options settable:
                    clientNoContextTakeover: true, // Defaults to negotiated value.
                    serverNoContextTakeover: true, // Defaults to negotiated value.
                    serverMaxWindowBits: 10, // Defaults to negotiated value.
                    // Below options specified as default values.
                    concurrencyLimit: 10, // Limits zlib concurrency for perf.
                    threshold: 1024 // Size (in bytes) below which messages
                    // should not be compressed if context takeover is disabled.
                }
            });
    
            webSocketServer.addListener("listening", () => 
            {
                console.log(`=======================================================================`);
                console.log(`COOP MOD: Web Socket Server is listening on ${webSocketPort}`);
                console.log(`A temporary Web Socket Server until SPT-Aki open theirs up for modding!`);
                console.log(`=======================================================================`);
            });
    
            webSocketServer.addListener("connection", this.wsOnConnection.bind(this));
        }

    protected wsOnConnection(ws: WebSocket.WebSocket, req: IncomingMessage): void 
    {
        const wsh = this;
        // Strip request and break it into sections
        const splitUrl = req.url.substring(0, req.url.indexOf("?")).split("/");

        const sessionID = splitUrl.pop();

        // get url params
        //const urlParams = this.getUrlParams(req.url);

        if(this.webSockets[sessionID] !== undefined)
        {
            if(this.webSockets[sessionID].readyState == WebSocket.OPEN)
            {
                console.log(`${sessionID} is already connected to Coop Web Socket!`);
                ws.close();
                return;
            }
        }
        
        ws.on("message", async function message(msg) 
        {
            wsh.processMessage(msg);
        });

        ws.on("close", async (code: number, reason: Buffer) =>
        {
            wsh.processClose(ws, sessionID);
        });
        
        this.webSockets[sessionID] = ws;
        console.log(`${sessionID} has connected to Coop Web Socket`);
    }

    private TryParseJsonArray(msg: string) {

        if(msg.charAt(0) === '[') {
           var jsonArray = JSON.parse(msg);

           return jsonArray;
        }

        return undefined;

    }

    private async processMessage(msg: RawData) {

        const msgStr = msg.toString();

        this.processMessageString(msgStr);
    }

    private async processClose(ws: WebSocket, sessionId: string) {

        // console.log("processClose");
        // console.log(ws);
        console.log(`Web Socket ${sessionId} has disconnected`);

        if(this.webSockets[sessionId] !== undefined)
            delete this.webSockets[sessionId];

    }

    private async processMessageString(msgStr: string) {

        // If is SIT serialized string -- This is NEVER stored.
        if(msgStr.startsWith("SIT")) {
            // console.log(`received ${msgStr}`);
            const messageWithoutSITPrefix = msgStr.substring(3, msgStr.length);
            // const serverId = messageWithoutSITPrefix.substring(0, 24); // get serverId (MongoIds are 24 characters)
            const serverId = messageWithoutSITPrefix.substring(0, 27); // get serverId post 0.13.5.0.* these are 27 (pmc{Id})
            // console.log(`server Id is ${serverId}`);

            const messageWithoutSITPrefixes = messageWithoutSITPrefix.substring(27, messageWithoutSITPrefix.length); 

            const match = CoopMatch.CoopMatches[serverId];
            if(match !== undefined) {
                match.ProcessData(messageWithoutSITPrefixes, this.logger);
            }
            return;
        }

        var jsonArray = this.TryParseJsonArray(msgStr);
        if(jsonArray !== undefined) {
            for(const key in jsonArray) {
                this.processObject(jsonArray[key]);
            }
        }

        if(msgStr.charAt(0) !== '{')
            return;

        var jsonObject = JSON.parse(msgStr);

        this.processObject(jsonObject);
    }

    private async processObject(jsonObject: any) {

        const match = CoopMatch.CoopMatches[jsonObject["serverId"]];
        if(match !== undefined) {

            if(jsonObject["connect"] == true) {
                match.PlayerJoined(jsonObject["profileId"]);
            }
            else {
                // console.log("found match");
                match.ProcessData(jsonObject, this.logger);
            }
        } else {
            this.sendToAllWebSockets(JSON.stringify(jsonObject));
        }
    }

    public sendToAllWebSockets(data: string) {
        this.sendToWebSockets(Object.keys(this.webSockets), data);
    }

    public sendToWebSockets(sessions: string[], data: string) {
        for(let session of sessions) {
            if(this.webSockets[session] !== undefined)
            {
                if (this.webSockets[session].readyState === WebSocket.OPEN) 
                {
                    this.webSockets[session].send(data);
                }
                else 
                {
                    delete this.webSockets[session];
                }
            }
        }
    }

    public areThereAnyWebSocketsOpen(sessions: string[]):boolean {
        
        for(let session of sessions) {
            if(this.webSockets[session] !== undefined)
            {
                // if (this.webSockets[session].readyState === WebSocket.OPEN) 
                    return true;
            }
        }

        return false;
    }

    public closeWebSocketSession(session: string, reason: string) {
        if(this.webSockets[session] !== undefined) {
            if(this.webSockets[session].readyState === WebSocket.OPEN) {
                this.webSockets[session].send(JSON.stringify({ "endSession": true, reason: reason }));
                this.webSockets[session].close();
            }
            delete this.webSockets[session];
        }
    }

    private getUrlParams(url: string):Record<string, string> {

        let urlParams: Record<string, string> = {};

        url.substring(url.indexOf("?")+1).split("&").forEach(param => {
            
            const paramSplit = param.split("=");

            urlParams[paramSplit[0]] = paramSplit[1];
        });

        return urlParams;
    }
}

// class SITWebSocketServer extends WebSocketServer
// {
// }