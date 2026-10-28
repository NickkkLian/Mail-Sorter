// Browser-safe stable identity. Legacy unscoped items belong to primary only.
export const mailboxOf=x=>x?.mailbox===undefined?'primary':x.mailbox;
export const mailKey=x=>mailboxOf(x)==='primary'?String(x.gmailId):mailboxOf(x)+':'+x.gmailId;
