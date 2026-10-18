import {test} from 'node:test';
import {decide,eventEnd,DAY} from '../mail/scripts/rules.mjs';
import {message,NOW} from '../eval/synthetic.mjs';
const check=x=>{if(!x)throw Error('Calendar expectation failed');};
test('Google Calendar subject dates are recognized conservatively, invalid/local-clock dates stay',()=>{
  const m=message({subject:'Invitation: project @ Wed Oct 1, 2026'});check(decide(m,{},new Date(NOW)).rule==='O3');
  for(const s of ['Invitation: 2026-02-30','Invitation: 2026-01-01T10:00:00','Invitation: Feb 30, 2026'])check(eventEnd(s)===null);
  const end=eventEnd('Invitation: 2026-01-01T10:00:00Z');check(!decide({...m,subject:'Invitation: 2026-01-01T10:00:00Z'},{},new Date(end+DAY)).rule);
  check(decide(message({subject:'Reminder: webinar starts in 1 hour'}),{},new Date(NOW)).rule==='O3');
});
