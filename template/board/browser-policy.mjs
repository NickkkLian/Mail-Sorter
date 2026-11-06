import rules from '../mail/scripts/rule-data.mjs';
import {policyDocument,RULE_PRECEDENCE} from '../mail/scripts/policy-document.mjs';

export async function browserPolicyHash(config){
  const document=policyDocument(config,rules,RULE_PRECEDENCE);
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(document)));
  return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
