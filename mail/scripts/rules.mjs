import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {settings} from './settings.mjs';
export const RULES=JSON.parse(readFileSync(new URL('../rules.json',import.meta.url),'utf8'));
// Supervisor decision: specific eligible rules precede bulk/Promotions fallback.
export const RULE_PRECEDENCE=Object.freeze(['O1','O2','O3','O7','O6','O5','O4']);
const definitions=Object.fromEntries(RULES.map(r=>[r.id,r]));
export const DAY=86400000;
export const fingerprint=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const policyHash=c=>fingerprint({settings:settings(c),rules:RULES,precedence:RULE_PRECEDENCE,accountSecurity:1,tunedNotices:1});
export const address=s=>{const m=String(s||'').match(/<([^<>]+)>/);return (m?m[1]:String(s||'')).trim().toLowerCase();};
// Verified legacy keep-worthy categories from the live sorter's configuration; never protect bulk/junk labels wholesale.
export const LEGACY_KEEP_LABELS=['AI/重要待办','AI/求职招聘','AI/财务账单','AI/学校学术','AI/账号安全'];
const age=(m,now)=> m.date?(new Date(now)-new Date(m.date))/DAY:NaN;
const routine=/new (?:sign.in|login)|password (?:was )?changed|新(?:的)?登录|密码已更改/i;
const code=/verification code|your (?:one.time |security |login )?code is|one.time (?:code|password)|confirm your email|verify your email|sign.in link|验证码|验证链接/i;
const incident=/suspicious|unauthori[sz]ed|compromis|breach|security (?:incident|vulnerability)|recovery|recover your|action required|可疑|泄露|恢复/i;
// K5 signals are independent of sender, Gmail tab, bulk status and word order.
// A routine login may age into O7; adding credentials/changing terms never does.
const accountChange=/\b(?:tokens?|passkeys?|terms|2fa|mfa|two[ -]factor|multi[ -]factor)\b|\baccount\b.{0,60}\b(?:creat(?:ed|ion)|clos(?:ed|ure)|deactivat(?:ed|ion))\b|\b(?:creat(?:ed|ing)|clos(?:ed|ing)|deactivat(?:ed|ing))\b.{0,60}\baccount\b|\bpassword\b.{0,40}\b(?:reset|request|recover|expir)|\b(?:reset|recover)\b.{0,40}\bpassword\b|账号.*(?:创建|关闭)|令牌|通行密钥|条款|双(?:重|因素)验证/i;
const accountSecurityNotice=s=>accountChange.test(s)||/\b(?:sign[\s\u2010-\u2015-]?in|log[\s\u2010-\u2015-]?in|passwords?|security|recovery|trusted device|account data|authori[sz]ation)\b|登录|密码|账号安全/i.test(s);
const newsletter=/newsletter|\bdigest\b|weekly (?:roundup|reading)|订阅|周报/i;
const shipping=/\bshipped\b|out for delivery|\bdelivered\b|order is on its way|shipment|delivery (?:is )?scheduled|物流|已送达/i;
const receipt=/receipt|invoice|statement|order confirm|payment confirm|payment (?:received|processed|successful)|cash deposit|deposit (?:credited|received)|funds (?:received|credited|deposited)|transfer confirm|e.transfer|tax (?:slip|document)|\b(?:T4|T5|1099)\b|收据|账单|订单确认/i;
const newsletterNotice=m=>newsletter.test(String(m.subject||''))||/^newsletters?[-+_.](?:no.?reply|digest|daily|weekly)[-+_.@]/i.test(address(m.from));
const newsletterLaunch=s=>/\b(?:introducing|launching|welcome to|subscribe to|sign up for)\b.*\b(?:newsletter|digest)\b/i.test(s);
const socialPost=m=>m.tab==='social'&&m.bulk===true&&/\b(?:tweeted:|posted:|shared (?:a )?post:|daily rundown:)/i.test(String(m.subject||''));
const bulkReminder=m=>m.bulk===true&&/^(?:final\s+)?reminder\s*:/i.test(String(m.subject||''));
const eventTopic=/\b(?:webinar|event|workshop|conference|session|meeting)\b/i;
const calendarInvitation=s=>/(?:^|updated\s+|cancelled\s+|calendar\s+)invitation\s*:|\binvitation\b.*\b(?:calendar|meeting|event|webinar|conference|workshop)\b|\b(?:calendar|meeting|event|webinar|conference|workshop)\b.*\binvitation\b/i.test(s);
// A past year bounds an election's latest possible end; a current/future year
// cannot date it. Role address + school category distinguish automated ballots.
function schoolElectionEnd(m){
  const s=String(m.subject||'');
  if(!/^elections?@/i.test(address(m.from))||!/\b(?:election|voting|vote)\b/i.test(s))return null;
  const years=[...s.matchAll(/\b20\d{2}\b/g)].map(x=>Number(x[0]));
  return years.length?Date.UTC(Math.max(...years),11,31,23,59,59,999)+12*3600000:null;
}
function relativeEventEnd(m){
  if(m.bulk!==true||!eventTopic.test(String(m.subject||''))||!/\btomorrow\b/i.test(String(m.subject||'')))return null;
  const date=new Date(m.date);if(!Number.isFinite(date.getTime()))return null;
  return Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()+1,23,59,59,999)+12*3600000;
}
export function keepCategory(m,c){
  const s=String(m.subject||''), a=address(m.from), d=a.split('@')[1]||'';
  if(m.bodyEvidence?.kind==='keep'&&['finance','security'].includes(m.bodyEvidence.category))return m.bodyEvidence.category;
  if(c.sender_labels[a])return c.sender_labels[a];
  if(m.everWritten===true||m.threadParticipated===true)return 'people';
  if(receipt.test(s))return 'finance';
  if(/(?:^|\.)(?:gc\.ca|canada\.ca|gov|gov\.uk)$/.test(d)||(!socialPost(m)&&/contract|agreement|notice of assessment|insurance policy|lease agreement|immigration|合同|移民/i.test(s)))return 'official';
  if(/booking confirm|itinerary|boarding pass|flight ticket|hotel reservation|check.in (?:opens|reminder)|行程|机票/i.test(s))return 'travel';
  if(incident.test(s)||(!code.test(s)&&(accountChange.test(s)||(!routine.test(s)&&/\b(?:passwords?|security)\b|密码|账号安全/i.test(s)))))return 'security';
  if(/\.(?:edu|ac\.uk|edu\.cn|utoronto\.ca|ubc\.ca)$/.test(d)||/course (?:enrol|registration)|professor|tuition|课程|学费/i.test(s))return 'school';
  if(/application (?:received|status)|interview|job offer|recruiter|面试|录用/i.test(s))return 'job';
  if(/clinic|prescription|pharmacy|medical appointment|insurance claim|patient|诊所|处方/i.test(s))return 'health';
  if(m.bulk===false&&!/no.?reply|notification|mailer|automated|support@/i.test(a)&&m.personal===true)return 'people';
  return null;
}
export function protectedReason(m,c){
  const a=address(m.from),d=a.split('@')[1]||'';
  if(c.protected.senders.some(x=>address(x)===a)||c.protected.domains.some(x=>d===x.toLowerCase()||d.endsWith('.'+x.toLowerCase())))return 'protected sender';
  const labels=new Set(m.labels||[]), keepLabels=c.categories.filter(x=>x.key!=='other').map(x=>c.label_prefix+x.label);
  if([...keepLabels,...c.protected.labels,...LEGACY_KEEP_LABELS].some(x=>labels.has(x)))return 'keep label';
  if(m.starred===true)return 'starred';
  if(m.threadParticipated===true||m.everWritten===true||(m.important===true&&m.replied===true))return 'participated';
  return null;
}
export function safetyKnown(m){
  return typeof m.gmailId==='string'&&/^\d+$/.test(m.gmailId)&&typeof m.threadId==='string'&&/^\d+$/.test(m.threadId)&&m.protectionComplete===true&&Array.isArray(m.labels)&&['starred','important','replied','threadParticipated','everWritten'].every(k=>typeof m[k]==='boolean');
}
// Only ISO date/time with explicit zone or an unambiguous calendar date; local-time guesses stay put.
export function eventEnd(text){
  const source=String(text);
  // A date with a local clock but no explicit offset is ambiguous, including Google Calendar's local-time form.
  const iso=source.match(/\b(20\d{2}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2}))?)\b/);
  if(!iso){const natural=source.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})\b/i);if(!natural)return null;
    const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'],month=months.indexOf(natural[1].slice(0,3).toLowerCase()),day=Number(natural[2]),n=Date.UTC(Number(natural[3]),month,day,23,59,59,999);
    return new Date(n).getUTCMonth()===month&&new Date(n).getUTCDate()===day?n+12*3600000:null;
  }
  if(iso[1].length===10&&source.slice(iso.index+10).match(/^T\d|^\s+\d{1,2}:\d{2}/))return null;
  const dateOnly=iso[1].length===10;
  const n=Date.parse(dateOnly?iso[1]+'T23:59:59.999Z':iso[1]);
  if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==iso[1].slice(0,10)&&dateOnly)return null;
  return n+(dateOnly?12*3600000:0);
}
export function decide(m,input={},now=new Date()){
  const c=settings(input),s=String(m.subject||''), a=age(m,now), keep=keepCategory(m,c), protect=protectedReason(m,c);
  const result={category:keep||'other',action:m.needsReply===true,rule:null,reason:'Uncertain; left in place'};
  const electionEnd=schoolElectionEnd(m),pastElection=keep==='school'&&!c.sender_labels[address(m.from)]&&electionEnd!==null&&new Date(now).getTime()>electionEnd+definitions.O3.days*DAY;
  if(protect||(keep&&!pastElection))return {...result,reason:protect?'Protected; left in place':'Keep signal'};
  if(!safetyKnown(m)||!Number.isFinite(a)||a<0||m.inInbox!==true||m.classificationFailed===true)return result;
  const isNewsletter=newsletterNotice(m),isBulkReminder=bulkReminder(m);
  const structuredDate=/\b20\d{2}-\d{2}-\d{2}(?=T|\b)/.test(s);
  const relativeEnd=structuredDate?null:relativeEventEnd(m);
  const end=eventEnd(s)??(m.bodyEvidence?.kind==='event'&&Number.isFinite(m.bodyEvidence.end)?m.bodyEvidence.end:null)??relativeEnd;
  const invite=/invitation|event reminder|calendar|邀请|活动提醒/i.test(s),reminder=/reminder:.*(?:starts in|starting in)|提醒.*(?:小时|分钟)/i.test(s);
  const futureYear=[...s.matchAll(/\b20\d{2}\b/g)].some(x=>Number(x[0])>new Date(now).getUTCFullYear());
  const calendar=calendarInvitation(s),eventNotPast=end!==null&&new Date(now).getTime()<=end+definitions.O3.days*DAY;
  const unreadDate=structuredDate&&end===null;
  // No-body limits apply before broad tab/notification fallbacks.
  if(newsletterLaunch(s)||m.longOffer===true||(calendar&&end===null)||((calendar||isBulkReminder)&&eventNotPast)||((isBulkReminder||invite||eventTopic.test(s))&&(futureYear||unreadDate))||(/\b(?:subscription|membership)\b.*\b(?:renew|renewal)\b/i.test(s)&&!/\b(?:receipt|invoice|renewed|offer|discount)\b/i.test(s)))return result;
  const routineOnly=routine.test(s)&&!code.test(s);
  const hits=[];const hit=(id,yes)=>{if(c.rules[id].enabled&&yes&&(!routineOnly||id==='O7'))hits.push(id);};
  hit('O1',code.test(s)&&a>definitions.O1.days);
  const carrier=m.shippingSender===true||(m.notificationSender===true&&/\b(?:your (?:package|parcel|shipment)|delivery (?:is )?scheduled)\b/i.test(s));
  hit('O2',shipping.test(s)&&carrier&&a>(/\bdelivered\b|已送达/i.test(s)?definitions.O2.delivered_days:definitions.O2.days));
  hit('O3',pastElection||((invite||isBulkReminder||relativeEnd!==null)&&end!==null&&new Date(now).getTime()>end+definitions.O3.days*DAY)||((reminder||isBulkReminder)&&end===null&&a>definitions.O3.reminder_days));
  hit('O4',(!isNewsletter||m.tab==='promotions')&&(m.tab==='promotions'||(m.bulk===true&&/sale|offer|discount|promotion|% off|促销|优惠/i.test(s)))&&a>definitions.O4.days);
  hit('O5',m.bulk===true&&isNewsletter&&a>definitions.O5.days);
  hit('O6',!accountSecurityNotice(s)&&!incident.test(s)&&!routine.test(s)&&!code.test(s)&&!isNewsletter&&!shipping.test(s)&&((m.tab==='social')||(m.tab==='updates'&&(m.bulk===true||m.notificationSender===true))||m.notificationSender===true)&&a>definitions.O6.days);
  hit('O7',!incident.test(s)&&!accountChange.test(s)&&routine.test(s)&&a>definitions.O7.days);
  const selected=RULE_PRECEDENCE.find(id=>hits.includes(id));
  if(selected&&!result.action) return {...result,category:'other',rule:selected,reason:definitions[selected].name};
  return result;
}
