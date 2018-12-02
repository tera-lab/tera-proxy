const DiscordURL = "https://discord.gg/dUNDDtw";

// Check node/electron version
let BigIntSupported = false;
try { BigIntSupported = eval('1234n === 1234n'); } catch (_) {}

if(['11.0.0', '11.1.0'].includes(process.versions.node)) {
  console.error('ERROR: Node.JS 11.0 and 11.1 contain a critical bug preventing timers from working properly. Please install version 11.2 or later!');
  process.exit();
} else if(process.versions.modules < 64 || !BigIntSupported) {
  if(!!process.versions.electron) {
    console.error('ERROR: Your version of Electron is too old to run tera-proxy!');
    console.error('ERROR: If you are using Arborean Apparel, download the latest release from:');
    console.error('ERROR: https://github.com/iribae/arborean-apparel/releases');
    console.error('ERROR: Otherwise, please ask in the #help channel of %s!', DiscordURL);
  } else {
    console.error('ERROR: Your installed version of Node.JS is too old to run tera-proxy!');
    console.error('ERROR: Please install the latest version from https://nodejs.org/en/download/current/');
  }
  process.exit();
}

// Load and validate configuration
const {region: REGION, updatelog: UPDATE_LOG, dnsservers: DNS_SERVERS} = (() => {
    try {
        return require("../config.json");
    } catch(_) {
        console.log("ERROR: Whoops, looks like you've fucked up your config.json!");
        console.log("ERROR: Try to fix it yourself or ask in the #help channel of %s!", DiscordURL);
        process.exit(1);
    }
})();

const REGIONS = require("./regions");
const currentRegion = REGIONS[REGION];
if (!currentRegion) {
  console.error("Invalid region: " + REGION);
  return;
}

const REGION_SHORT = REGION.toLowerCase().split('-')[0];
const isConsole = currentRegion["console"];
const { customServers, listenHostname, hostname } = currentRegion;
const hostnames = [].concat(hostname, currentRegion.altHostnames || []);
const fs = require("fs");
const path = require("path");

// Region migration
let migratedFile = null;
switch(REGION) {
 case "EU": {
   if (currentRegion.customServers["30"] || currentRegion.customServers["31"] || currentRegion.customServers["32"] || currentRegion.customServers["33"] || currentRegion.customServers["34"] || currentRegion.customServers["35"])
     migratedFile = "res/servers-eu.json";
   break;
 }
 case "TH": {
   if (currentRegion.customServers["2"] || !currentRegion.customServers["1"])
     migratedFile = "res/servers-th.json";
   break;
 }
 case "JP": {
   if (!currentRegion.customServers["5073"])
     migratedFile = "res/servers-jp.json";
   break;
 }
}

if (migratedFile) {
 try {
   fs.unlinkSync(path.join(__dirname, migratedFile));
   console.log(`Due to a change in the server list by the publisher, your server configuration for region ${REGION} was reset. Please restart proxy for the changes to take effect!`);
 } catch (e) {
   console.log(`ERROR: Unable to migrate server list for region ${REGION}: ${e}`);
 }
 return;
}

// No migration required
console.log(`[sls] Tera-Proxy configured for region ${REGION}!`);

let why;
try { why = require("why-is-node-running"); }
catch (_) {}

const net = require("net");
const dns = require("dns");
const hosts = require("./hosts");
const ProcessListener = require("./process-listener");

function removeHosts() {
  for (let x of hostnames)
    hosts.remove(listenHostname, x);

  console.log("[sls] server list overridden reverted")
}

if (!isConsole) {
  try {
    removeHosts();
  } catch (e) {
    switch (e.code) {
     case "EACCES":
      console.error(`ERROR: Hosts file is set to read-only.

  * Make sure no anti-virus software is running.
  * Locate "${e.path}", right click the file, click 'Properties', uncheck 'Read-only' then click 'OK'.`);
      break;
     case "EBUSY":
      console.error(`ERROR: Hosts file is busy and cannot be written to.

  * Make sure no anti-virus software is running.
  * Try deleting "${e.path}".`);
      break;
     case "EPERM":
      console.error(`ERROR: Insufficient permission to modify hosts file.

  * Make sure no anti-virus software is running.
  * Right click TeraProxy.bat and select 'Run as administrator'.`);
      break;
     case "ENOENT":
      console.error(`ERROR: Unable to write to hosts file.

  * Make sure no anti-virus software is running.
  * Right click TeraProxy.bat and select 'Run as administrator'.`);
      break;
     default:
      throw e;
    }

    return;
  }
}

const moduleBase = path.join(__dirname, "..", "node_modules");
let modules;

function populateModulesList() {
  modules = [];
  for (let i = 0, k = -1, arr = fs.readdirSync(moduleBase), len = arr.length; i < len; ++i) {
    const name = arr[i];
    if (name[0] === "." || name[0] === "_")
      continue;
    if (!name.endsWith(".js") && !fs.lstatSync(path.join(moduleBase, name)).isDirectory())
      continue;
    modules[++k] = name;
  }
}


const servers = new Map();
let hostsTimeout = null;

function customServerCallback(server) {
  const { address, port } = server.address();
  console.log(`[game] listening on ${address}:${port}`);
}

function listenHandler(err) {
  if (err) {
    const { code } = err;
    if (code === "EADDRINUSE") {
      console.error("ERROR: Another instance of TeraProxy is already running, please close it then try again.");
      process.exit();
    }
    else if (code === "EACCES") {
      let port = currentRegion.port;
      console.error("ERROR: Another process is already using port " + port + ".\nPlease close or uninstall the application first:");
      return require("./netstat")(port);
    }
    throw err;
  }

  if (!isConsole) {
    ProcessListener("TERA.exe", () => {
      for (let x of hostnames)
        hosts.set(listenHostname, x);

      console.log("[sls] server list overridden");
      clearTimeout(hostsTimeout)
      hostsTimeout = setTimeout(removeHosts, 1000*60*2);
    }, removeHosts, 5000);
  }

  for (let i = servers.entries(), step; !(step = i.next()).done; ) {
    const [id, server] = step.value;
    const currentCustomServer = customServers[id];

    server.listen(currentCustomServer.port, currentCustomServer.ip || "127.0.0.1", customServerCallback.bind(null, server));
  }
}

let lastUpdateResult = {"protocol_data": {}, "failed": [], "legacy": [], "updated": []};

function onConnectionError(err) {
  switch(err.code) {
    case 'ETIMEDOUT':
      console.error(`ERROR: Unable to connect to game server at ${err.address}:${err.port} (timeout)! Common reasons for this are:`);
      console.error("- An unstable internet connection or a geo-IP ban");
      console.error("- Game server maintenance");
      break;
    case 'ECONNRESET':
    case 'EPIPE':
      console.error(`ERROR: ${err.code} - Connection to game server was closed unexpectedly. Common reasons for this are:`);
      console.error("- A disconnect caused by an unstable internet connection");
      console.error("- An exploit/cheat or broken module that got you kicked");
      break;
    default:
      console.warn(err);
      break;
  }
}

let activeConnections = new Set;

function runServ(target, socket) {
  const { Connection, RealClient } = require("tera-proxy-game");

  const connection = new Connection({
    "region": REGION_SHORT,
    "console": !!isConsole,
    "classic": !!currentRegion["classic"],
    "protocol_data": lastUpdateResult["protocol_data"],
  });
  const client = new RealClient(connection, socket);
  const srvConn = connection.connect(client, {
    host: target.ip,
    port: target.port
  });

  // Load modules
  for (let mod of lastUpdateResult["failed"])
    console.log("WARNING: Module %s could not be updated and will not be loaded!", mod.name);
  for (let mod of lastUpdateResult["legacy"])
    console.log("WARNING: Module %s does not support auto-updating!", mod.name);

  let versioncheck_modules = lastUpdateResult["legacy"].slice(0);
  for (let mod of lastUpdateResult["updated"]) {
    mod.options.rootFolder = path.join(moduleBase, mod.name);
    if (mod.options.loadOn === "connect") {
      // Load default modules first
      for (let mod of versioncheck_modules) {
        if (mod.name === 'command' || mod.name === 'tera-game-state')
          connection.dispatch.load(mod.name, module, mod.options);
      }

      // Then load other modules
      for (let mod of versioncheck_modules) {
        if (mod.name !== 'command' && mod.name !== 'tera-game-state')
          connection.dispatch.load(mod.name, module, mod.options);
      }
    } else if(!mod.options.loadOn || mod.options.loadOn === "versioncheck") {
      versioncheck_modules.push(mod);
    }
  }

  connection.dispatch.on("init", () => {
    // Load default modules first
    for (let mod of versioncheck_modules) {
      if (mod.name === 'command' || mod.name === 'tera-game-state')
        connection.dispatch.load(mod.name, module, mod.options);
    }

    // Then load other modules
    for (let mod of versioncheck_modules) {
      if (mod.name !== 'command' && mod.name !== 'tera-game-state')
        connection.dispatch.load(mod.name, module, mod.options);
    }
  });

  // Initialize server connection
  let remote = "???";

  socket.on("error", onConnectionError);

  srvConn.on("connect", () => {
    remote = socket.remoteAddress + ":" + socket.remotePort;
    console.log("[connection] routing %s to %s:%d", remote, srvConn.remoteAddress, srvConn.remotePort);

    activeConnections.add(connection);
  });

  srvConn.on("error", (err) => {
    onConnectionError(err);
    activeConnections.delete(connection);
  });

  srvConn.on("close", () => {
    console.log("[connection] %s disconnected", remote);
    console.log("[proxy] unloading user modules");
    for (let i = 0, arr = Object.keys(require.cache), len = arr.length; i < len; ++i) {
      const key = arr[i];
      if (key.startsWith(moduleBase)) {
        delete require.cache[key];
      }
    }

    activeConnections.delete(connection);
  });
}

const autoUpdate = require("./update");

function createServ(target, socket) {
  socket.setNoDelay(true);

  populateModulesList();
  runServ(target, socket);
}

const SlsProxy = require("tera-proxy-sls");
const proxy = new SlsProxy(currentRegion);

function startProxy() {
  if(!isConsole) {
    dns.setServers(DNS_SERVERS || ["8.8.8.8", "8.8.4.4"]);

    // For some reason, node's http request timeout doesn't always work, so add a workaround here.
    let slsTimeout = setTimeout(() => {
      console.error("ERROR: Timeout while trying to load the server list.");
      console.error("This is NOT a proxy issue. Your connection to the official servers is not working properly!");
      console.error("Try restarting/resetting your router and your computer. That might solve the issue.");
      process.exit(1);
    }, 5000);

    proxy.fetch((err, gameServers) => {
      if (err) {
        console.error(`ERROR: Unable to load the server list: ${err}`);
        console.error("This is almost always caused by");
        console.error(" - your setup (invasive virus scanners, viruses, ...)");
        console.error(" - your internet connection (unstable/broken connection, improper configuration, geo-IP ban from the game region you're trying to play on, ...)");
        console.error(" - game servers being down for maintenance");
        console.error("Please test if you can regularly play the game (without proxy). If you can't, it's not a proxy issue, but one of the above.");
        console.error("You can also try restarting/resetting your router and your computer.");
        process.exit(1);
      }

      for (let i = 0, arr = Object.keys(customServers), len = arr.length; i < len; ++i) {
        const id = arr[i];
        const target = gameServers[id];
        if (!target) {
          console.error(`[sls] WARNING: Server ${id} not found`);
          continue;
        }

        const server = net.createServer(createServ.bind(null, target));
        servers.set(id, server);
      }

      proxy.listen(listenHostname, listenHandler);
      clearTimeout(slsTimeout);
    });
  } else {
    for (let i = 0, arr = Object.keys(customServers), len = arr.length; i < len; ++i) {
      const id = arr[i];
      const target = customServers[id]["remote"];

      const server = net.createServer(createServ.bind(null, target));
      servers.set(id, server);
    }

    listenHandler();
  }

  // TODO: this is a dirty hack, implement this stuff properly
  for (let mod of lastUpdateResult["updated"]) {
    mod.options.rootFolder = path.join(moduleBase, mod.name);
    if (mod.options.loadOn === "startup") {
      console.log(`[proxy] Initializing module ${mod.name}`);
      require(mod.name)(REGION_SHORT);
    }
  }
}

populateModulesList();
autoUpdate(moduleBase, modules, UPDATE_LOG, true, REGION_SHORT).then((updateResult) => {
  if(!updateResult["tera-data"])
    console.log("WARNING: There were errors updating tera-data. This might result in further errors.");

  delete require.cache[require.resolve("tera-data-parser")];
  delete require.cache[require.resolve("tera-proxy-game")];

  lastUpdateResult = updateResult;
  startProxy();
}).catch((e) => {
  console.log("ERROR: Unable to auto-update: %s", e);
})

const isWindows = process.platform === "win32";

function cleanExit() {
  console.log("terminating...");

  activeConnections.forEach((connection) => { connection.close(); });
  activeConnections.clear();

  if(!isConsole) {
    try {
      removeHosts();
    }
    catch (_) {}

    proxy.close();
  }

  for (let i = servers.values(), step; !(step = i.next()).done; )
    step.value.close();

  if (isWindows) {
    process.stdin.pause();
  }

  setTimeout(() => {
    why && why();
    process.exit();
  }, 5000).unref();
}

if (isWindows) {
  require("readline").createInterface({
    input: process.stdin,
    output: process.stdout
  }).on("SIGINT", () => process.emit("SIGINT"));
}

process.on("SIGHUP", cleanExit);
process.on("SIGINT", cleanExit);
process.on("SIGTERM", cleanExit);
