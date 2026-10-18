// Body text is transient: callers receive only sanitized request text or typed evidence.
export function redact(text){
  return String(text||'').normalize('NFKC')
    .replace(/https?:\/\/[^\s<>"']+/gi,url=>url.split(/[?#]/,1)[0])
    .replace(/\b(?:cvv|cvc|security\s+code)\s*[:=\-]?\s*\d{3,4}\b/gi,'[REDACTED SECURITY CODE]')
    .replace(/\b\d{3,4}\s*(?:is\s+(?:your\s+)?)?(?:cvv|cvc|security\s+code)\b/gi,'[REDACTED SECURITY CODE]')
    .replace(/\b(?=[A-Za-z0-9_-]{16,}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/g,'[REDACTED TOKEN]')
    .replace(/\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b/gi,'[REDACTED ACCOUNT]')
    .replace(/\b(?:account|acct|card|账户|账号|卡号)(?:\s+(?:number|no\.?|ending(?: in)?))?\s*[:#*xX -]*[A-Z0-9][A-Z0-9 *xX-]{2,34}/gi,'[REDACTED ACCOUNT]')
    .replace(/(?<!\d)\d(?:[ -]?\d){3,}(?!\d)/g,'[REDACTED NUMBER]');
}
export function stripHistory(value){
  let s=String(value||'').slice(0,131072);
  s=s.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi,'');
  const quoted=s.search(/<(?:blockquote)\b|<[^>]*class=["'][^"']*(?:gmail_quote|yahoo_quoted)/i);if(quoted>=0)s=s.slice(0,quoted);
  s=s.replace(/<(?:br|\/p|\/div|\/tr|\/li)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' ')
    .replace(/&nbsp;/gi,' ').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#(?:x([a-f\d]+)|(\d+));/gi,(_,hex,dec)=>{const n=parseInt(hex||dec,hex?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';});
  const kept=[];for(const line of s.split(/\r?\n/)){
    if(/^\s*(?:On .{0,200}wrote:|From:\s|Sent:\s|[-_]{2,}\s*(?:Original Message|Forwarded message)|Begin forwarded message:|在.{0,100}写道[:：])/i.test(line))break;
    if(/^\s*>/.test(line))continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/[\t ]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}
export const safeText=(value,limit=4000)=>redact(stripHistory(value)).slice(0,limit);
// Extract calendar evidence before redaction removes numeric dates. Never return prose.
export function bodyEvidence(value,now=new Date()){
  const text=stripHistory(value);
  if(/receipt|invoice|payment (?:has been |was )?received|subscription has renewed|renewal receipt|收据|续费成功/i.test(text))return {kind:'keep',category:'finance'};
  if(/security breach|unauthori[sz]ed access|account compromised|账号被盗/i.test(text))return {kind:'keep',category:'security'};
  if(/subscription will renew|upcoming renewal|即将续费/i.test(text))return {kind:'keep',category:'security'};
  const end=text.match(/(?:^|\n)DTEND(?:;VALUE=DATE)?:([0-9]{8})(?:T([0-9]{6})Z)?(?:\r?$|\n)/m);
  if(end){const d=end[1],t=end[2],iso=`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${t?t.slice(0,2)+':'+t.slice(2,4)+':'+t.slice(4,6):'23:59:59'}Z`,n=Date.parse(iso);
    if(Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===iso.slice(0,10))return {kind:'event',end:n+(t?0:12*3600000)};
  }
  const offer=text.match(/(?:valid until|offer ends|sale ends|有效期至)\s*(20\d{2}-\d{2}-\d{2})/i);
  if(offer&&Date.parse(offer[1]+'T23:59:59Z')+12*3600000>=Date.parse(now))return {kind:'longOffer'};
  return null;
}
export function modelInput(m,c,body=''){
  const input={from:safeText(m.from,200),subject:safeText(m.subject,300),bulk:m.bulk===true};
  if(c.read_bodies&&body)input.body=safeText(body,c.body_max_chars);
  return input;
}
