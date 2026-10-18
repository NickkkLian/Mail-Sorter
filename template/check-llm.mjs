// Provider request shapes, failures and evaluator wiring use injected fetch functions.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const r=spawnSync(process.execPath,['--import','./scripts/offline-guard.mjs','--test','test/stage2.test.mjs'],{cwd:fileURLToPath(new URL('./',import.meta.url)),stdio:'inherit',env:{PATH:process.env.PATH}});
process.exitCode=r.status??1;
