// Preloaded by checks. Any accidental network or server operation fails before it leaves this process.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
const blocked=()=>{throw Error('Network forbidden in offline checks');};
for(const [object,names]of [[net,['connect','createConnection','createServer']],[tls,['connect','createServer']],[http,['request','get','createServer']],[https,['request','get','createServer']]])for(const name of names)object[name]=blocked;
globalThis.fetch=blocked;
syncBuiltinESMExports();
