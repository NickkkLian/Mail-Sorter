import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decide,DAY,RULES,RULE_PRECEDENCE,policyHash,fingerprint} from '../mail/scripts/rules.mjs';
import {settings} from '../mail/scripts/settings.mjs';
import {emptyState,runCycle} from '../mail/scripts/core.mjs';
import {message,NOW} from '../eval/synthetic.mjs';

const now=new Date(NOW),config=settings({enabled:true});
const aged=(subject,days=120,extra={})=>message({subject,date:new Date(now-days*DAY).toISOString(),...extra});
const notification=extra=>aged('Application sent to an employer',30,{tab:'updates',bulk:true,notificationSender:true,...extra});
const election=extra=>aged('2024 student council election',400,{from:'Elections <elections@ballot.university.edu>',personal:true,...extra});

test('O6 recognizes automated job/app updates from metadata and keeps its 14-day minimum',()=>{
  for(const subject of ['Application sent to an employer','A company is hiring interns','Build pipeline failed','A new release is ready']){
    assert.equal(decide(notification({subject}),config,now).rule,'O6');
  }
  assert.equal(decide(notification({tab:'primary'}),config,now).rule,'O6');
  assert.equal(decide(notification({notificationSender:false}),config,now).rule,'O6');
  assert.equal(decide(notification({date:new Date(now-14*DAY).toISOString()}),config,now).rule,null);
  assert.equal(decide(notification({date:new Date(now-14*DAY-1).toISOString()}),config,now).rule,'O6');
  for(const subject of ['Cash deposit credited','Payment received','Your invoice is ready','Trusted device added to your account','Account data sharing authorization']){
    assert.equal(decide(notification({subject}),config,now).rule,null);
  }
  assert.equal(decide(notification({subject:'Interview invitation'}),config,now).rule,null);
  assert.equal(decide(notification({subject:'Job offer'}),config,now).rule,null);
});
test('O5 recognizes editorial newsletter roles without treating retail mailing addresses as issues',()=>{
  const editorial=aged('Morning edition',61,{from:'News <newsletters-noreply@publisher.example>',bulk:true});
  assert.equal(decide(editorial,config,now).rule,'O5');
  assert.equal(decide({...editorial,date:new Date(now-60*DAY).toISOString()},config,now).rule,null);
  assert.equal(decide({...editorial,bulk:false},config,now).rule,null);
  assert.equal(decide(aged('Tickets available for a concert',120,{from:'Offers <newsletter@shop.example>',bulk:true,tab:'promotions'}),config,now).rule,'O4');
  assert.equal(decide(aged('Monthly newsletter',39,{bulk:true,tab:'promotions'}),config,now).rule,'O4');
  assert.equal(decide(aged('Monthly newsletter',30,{bulk:true,tab:'promotions'}),config,now).rule,null);
  assert.equal(decide(aged('Monthly newsletter',61,{bulk:true,tab:'promotions'}),config,now).rule,'O5');
  for(const subject of ['Introducing our newsletter','Launching a new digest','Subscribe to our newsletter','Welcome to the newsletter']){
    assert.equal(decide(aged(subject,120,{bulk:true,tab:'promotions',notificationSender:true}),config,now).rule,null);
  }
});
test('O2 recognizes carrier notifications while retaining 7/30-day thresholds and verified hints',()=>{
  const delivered=aged('Your package was delivered',8,{notificationSender:true,shippingSender:false});
  assert.equal(decide(delivered,config,now).rule,'O2');
  assert.equal(decide({...delivered,date:new Date(now-7*DAY).toISOString()},config,now).rule,null);
  assert.equal(decide({...delivered,date:new Date(now-7*DAY-1).toISOString()},config,now).rule,'O2');
  assert.equal(decide({...delivered,notificationSender:false},config,now).rule,null);
  const scheduled=aged('A parcel delivery is scheduled for tomorrow',31,{notificationSender:true});
  assert.equal(decide(scheduled,config,now).rule,'O2');
  assert.equal(decide({...scheduled,date:new Date(now-30*DAY).toISOString()},config,now).rule,null);
  assert.equal(decide({...scheduled,subject:'Invoice for your delivery'},config,now).rule,null);
  assert.equal(delivered.shippingSender,false);
});
test('O3 applies the two-day bulk-reminder fallback and reads explicit relative event dates',()=>{
  const reminder=aged('FINAL REMINDER: community summit',3,{bulk:true});
  assert.equal(decide(reminder,config,now).rule,'O3');
  assert.equal(decide({...reminder,date:new Date(now-2*DAY).toISOString()},config,now).rule,null);
  assert.equal(decide({...reminder,date:new Date(now-2*DAY-1).toISOString()},config,now).rule,'O3');
  assert.equal(decide({...reminder,bulk:false},config,now).rule,null);
  const relative=aged('Tomorrow: join our workshop',10,{bulk:true});
  assert.equal(decide(relative,config,now).rule,'O3');
  assert.equal(decide({...relative,date:new Date(now-DAY).toISOString()},config,now).rule,null);
  assert.equal(decide({...reminder,subject:'Reminder: invoice payment due'},config,now).rule,null);
  assert.equal(decide({...reminder,subject:'Reminder: reset your password'},config,now).rule,null);
});
test('O3 dates automated school elections conservatively and never overrides stored or sender protection',()=>{
  assert.equal(decide(election(),config,now).rule,'O3');
  assert.equal(decide(election(),config,now).category,'other');
  for(const subject of ['Student council election','2026 student council election','2024 recap: 2027 student election']){
    assert.equal(decide(election({subject}),config,now).rule,null);
  }
  assert.equal(decide(election({from:'Professor <person@university.edu>'}),config,now).rule,null);
  assert.equal(decide(election(),{sender_labels:{'elections@ballot.university.edu':'school'}},now).rule,null);
  assert.equal(decide(election({labels:['AI/School']}),config,now).rule,null);
});
test('broader metadata rules respect undated/future invites, unread dates, renewals and long offers',()=>{
  const subjects=['Invitation: annual conference','An invitation to our webinar','Invitation: meeting @ 2027-01-01T10:00:00Z',
    'REMINDER: meeting @ 2027-01-01T10:00:00Z','REMINDER: meeting @ 2026-12-01T10:00','Tomorrow: workshop @ 2026-12-01T10:00',
    'Subscription will renew','Membership renewal date is upcoming'];
  for(const subject of subjects)for(const tab of ['updates','promotions']){
    assert.equal(decide(aged(subject,120,{tab,bulk:true,notificationSender:true}),config,now).rule,null,subject);
  }
  assert.equal(decide(notification({longOffer:true}),config,now).rule,null);
  assert.equal(decide(aged('A renewal discount offer',120,{tab:'promotions',bulk:true}),config,now).rule,'O4');
});
test('quoted legal words in social posts are notifications, while real official/financial mail stays',()=>{
  assert.equal(decide(aged('An analyst posted: Discussion of an employment contract',40,{tab:'social',bulk:true}),config,now).rule,'O6');
  assert.equal(decide(aged('Your employment contract',40,{tab:'social',bulk:true}),config,now).rule,null);
  assert.equal(decide(aged('A department posted: contract policy',40,{from:'Office <notices@authority.gov>',tab:'social',bulk:true}),config,now).rule,null);
  assert.equal(decide(aged('A statement is ready',40,{tab:'social',bulk:true}),config,now).rule,null);
});
test('all new cleanup paths preserve PLAN vetoes, original metadata and explicit approvals',()=>{
  const examples=[notification(),aged('Your package delivered',20,{notificationSender:true}),
    aged('Monthly newsletter',120,{bulk:true}),aged('REMINDER: annual summit',120,{bulk:true}),election(),
    aged('An analyst tweeted: contracts in the news',120,{tab:'social',bulk:true})];
  for(const mail of examples){
    assert(decide(mail,config,now).rule);
    const before=structuredClone(mail);
    for(const patch of [{starred:true},{important:true,replied:true},{everWritten:true},{threadParticipated:true},
      {needsReply:true},{protectionComplete:false},{inInbox:false},{classificationFailed:true},
      {labels:['AI/财务账单']},{labels:['AI/学校学术']},{labels:['AI/Money']},{bodyEvidence:{kind:'keep',category:'finance'}}]){
      assert.equal(decide({...mail,...patch},config,now).rule,null);
    }
    assert.equal(decide(mail,{protected:{senders:[mail.from]}},now).rule,null);
    const domain=mail.from.match(/@([^>]+)>?$/)[1];
    assert.equal(decide(mail,{protected:{domains:[domain]}},now).rule,null);
    assert.deepEqual(mail,before);
  }
});
test('an expired inferred school notice is proposed without first adding a keep label',async()=>{
  const mail=election(),state=emptyState();let labels=0,cleans=0;
  const mailbox={scan:async()=>({messages:[mail],done:true,uidValidity:'1'}),get:async()=>mail,
    addLabel:async()=>{labels++;},archive:async()=>{cleans++;}};
  await runCycle({config,state,mailbox,persist:async()=>{},now});
  assert.equal(state.proposal.items.length,1);assert.equal(state.proposal.items[0].rule,'O3');
  assert.equal(labels,0);assert.equal(cleans,0);
});
test('notification-policy changes invalidate existing approvals and automatic history',()=>{
  const before=fingerprint({settings:settings(config),rules:RULES,precedence:RULE_PRECEDENCE,accountSecurity:1});
  assert.notEqual(policyHash(config),before);
});
