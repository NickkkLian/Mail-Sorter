// Deliberately fictional, deterministic 200-message release fixture; no private source data.
export const NOW='2026-10-17T12:00:00.000Z';
export function message(overrides={}){
  return {uid:1,gmailId:'1001',threadId:'2001',from:'notices@service.example',subject:'Unknown notice',date:'2026-01-01T12:00:00.000Z',tab:'primary',labels:[],bulk:false,starred:false,important:false,replied:false,threadParticipated:false,everWritten:false,protectionComplete:true,inInbox:true,...overrides};
}
export function synthetic(){
  const items=[];const add=(m,expected)=>{const n=items.length+1;items.push({id:'s'+n,message:message({...m,uid:n,gmailId:String(1000+n),threadId:String(2000+n)}),expected});};
  const old=[
    {subject:'Your verification code'}, // replaced below with the precise regular wording
    {subject:'Your package delivered',shippingSender:true},
    {subject:'Invitation: demo @ 2026-01-01T10:00:00Z'},
    {subject:'Seasonal sale',tab:'promotions',bulk:true},
    {subject:'Weekly newsletter digest',bulk:true},
    {subject:'Someone viewed your profile',tab:'social'},
    {subject:'New sign-in to your account'}
  ];old[0].subject='Verification code for your sign-in';
  for(let r=0;r<7;r++)for(let n=0;n<10;n++)add({...old[r],subject:old[r].subject+' #'+n,date:new Date(Date.parse(NOW)-(120+n)*86400000).toISOString()},{kind:'outdated',rule:'O'+(r+1)});
  const keeps=[['people',{subject:'Hello from a colleague',everWritten:true}],['finance',{subject:'Your order confirmation receipt'}],['official',{subject:'Your lease agreement'}],['travel',{subject:'Booking confirmation and itinerary'}],['security',{subject:'Suspicious sign-in security incident'}],['school',{subject:'Course registration'}],['job',{subject:'Interview invitation'}],['health',{subject:'Prescription ready at pharmacy'}]];
  for(const [category,m]of keeps)for(let n=0;n<10;n++)add({...m,subject:m.subject+' #'+n},{kind:'keep',category});
  const uncertain=[{subject:'Unknown notice'},{subject:'Invitation: future event @ 2027-01-01T10:00:00Z'},{subject:'Verify your email',starred:true},{subject:'Sale receipt',tab:'promotions'},{subject:'Delivered',shippingSender:false},{subject:'Reminder: something sometime'},{subject:'New message',tab:'updates',threadParticipated:true},{subject:'Weekly newsletter',bulk:false},{subject:'Security incident action required'},{subject:'Verification code',protectionComplete:false}];
  for(let i=0;i<50;i++)add(uncertain[i%uncertain.length],{kind:'uncertain'});
  return {schema_version:1,synthetic:true,now:NOW,items};
}
