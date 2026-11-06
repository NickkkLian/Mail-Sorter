import {settings} from './settings.mjs';
export const RULE_PRECEDENCE=Object.freeze(['O1','O2','O3','O7','O6','O5','O4']);

export function policyDocument(config,rules,precedence){
  return {settings:settings(config),rules,precedence,accountSecurity:2,tunedNotices:1};
}
