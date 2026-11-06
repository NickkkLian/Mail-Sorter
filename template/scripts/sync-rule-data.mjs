import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const rules=JSON.parse(fs.readFileSync(path.join(root,'mail/rules.json'),'utf8'));
const text='// Generated from mail/rules.json by scripts/sync-rule-data.mjs.\nexport default '+JSON.stringify(rules,null,2)+';\n';
fs.writeFileSync(path.join(root,'mail/scripts/rule-data.mjs'),text);
if(fs.existsSync(path.join(root,'template/mail/scripts')))fs.writeFileSync(path.join(root,'template/mail/scripts/rule-data.mjs'),text);
