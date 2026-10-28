// Pure settings module, shared with the board. No environment or filesystem access.
export const RULE_IDS = ['O1','O2','O3','O4','O5','O6','O7'];
export const CATEGORIES = [
  {key:'people', label:'People'}, {key:'finance',label:'Money'},
  {key:'official',label:'Official'}, {key:'travel',label:'Travel'},
  {key:'security',label:'Accounts'}, {key:'school',label:'School'},
  {key:'job',label:'Jobs'}, {key:'health',label:'Health'}, {key:'other',label:'Unsorted'}
];
export const DEFAULTS = {
  schema_version: 1, enabled:false, read_bodies:false, mark_dealt_read:true, second_mailbox_enabled:false, frequency_hours:24,
  approval_mode:'every_run', primary_only:false, keep_items:500, max_per_run:120,
  max_backfill:3000, max_sent:50000, log_runs:500, max_retries:3,
  body_max_chars:4000, body_fetch_bytes:32768, label_prefix:'AI/',
  categories:CATEGORIES, protected:{senders:[],domains:[],labels:[]}, sender_labels:{},
  rules:Object.fromEntries(RULE_IDS.map(id=>[id,{enabled:true,action:'archive',auto:false,clean_days:28}]))
};
const boolean = (v,k) => { if (typeof v !== 'boolean') throw Error('Invalid setting: '+k); };
export function settings(input={}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid settings');
  // Legacy archive_categories must never bypass the approval boundary.
  if (input.archive_categories?.length) throw Error('Migrate archive_categories to reviewed cleanup rules');
  const c={...structuredClone(DEFAULTS),...input,
    protected:{...structuredClone(DEFAULTS.protected),...input.protected},
    rules:Object.fromEntries(RULE_IDS.map(id=>[id,{...DEFAULTS.rules[id],...input.rules?.[id]}]))};
  for(const k of ['enabled','read_bodies','primary_only','mark_dealt_read','second_mailbox_enabled']) boolean(c[k],k);
  if (!['every_run','eligible_rules'].includes(c.approval_mode)) throw Error('Invalid approval mode');
  const bounds={frequency_hours:[1,720],keep_items:[1,5000],max_per_run:[1,3000],max_backfill:[1,10000],max_sent:[1,100000],log_runs:[28,2000],max_retries:[1,5],body_max_chars:[128,8000],body_fetch_bytes:[1024,65536]};
  for(const [k,[lo,hi]] of Object.entries(bounds)) if(!Number.isInteger(c[k])||c[k]<lo||c[k]>hi) throw Error('Invalid setting: '+k);
  if (!/^AI\/[\p{L}\p{N}/ _-]*$/u.test(c.label_prefix)||c.label_prefix.length>80) throw Error('Invalid label prefix');
  const keys=CATEGORIES.map(x=>x.key);
  if(!Array.isArray(c.categories)||c.categories.length!==keys.length || new Set(c.categories.map(x=>x.key)).size!==keys.length || c.categories.some(x=>!keys.includes(x.key)||typeof x.label!=='string'||!x.label.trim()||x.label.length>60||/[\r\n]/.test(x.label))) throw Error('Invalid keep labels');
  for(const k of ['senders','domains','labels']) if(!Array.isArray(c.protected[k])||c.protected[k].some(x=>typeof x!=='string'||!x.trim()||x.length>200||/[\r\n]/.test(x))) throw Error('Invalid protected list');
  if(!c.sender_labels||typeof c.sender_labels!=='object'||Array.isArray(c.sender_labels)||Object.entries(c.sender_labels).some(([s,k])=>!s.includes('@')||!keys.includes(k))) throw Error('Invalid sender label');
  for(const id of RULE_IDS){const r=c.rules[id];boolean(r.enabled,id);boolean(r.auto,id);if(!['archive','trash'].includes(r.action)||!Number.isInteger(r.clean_days)||r.clean_days<28||r.clean_days>365)throw Error('Invalid rule setting: '+id);}
  // Pick known fields only: legacy notes/model preferences are not runtime safety permissions.
  return Object.fromEntries(Object.keys(DEFAULTS).map(k=>[k,c[k]]));
}
