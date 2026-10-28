# Settings update — 2026-10-24

Dealt mail adds one App-specific preference: **Mark dealt mail as read** / **将已处理邮件标为已读**. It defaults on, saves only `mark_dealt_read` through the existing conflict-aware config save, and participates in unsaved/discard handling. Saving a failure keeps the draft and restores the displayed saved value. The runner uses the saved value on its next enabled wake. Category labeling always applies; mail stays in Inbox. Dealt history and Undo are actions next to the digest, outside Settings.

The top-right gear opens Connection, AI, Language and theme, Data and App-specific. Language, theme, palettes and the scheduled classifier preference have no duplicate header controls. The classifier text in the header/page is status only. Refresh, filters, cleanup review and Undo remain actions in their original views.

Connection Save is local; Connect / reload reads the selected private source. Complete shared/independent choices are explicit, incomplete overrides stay disconnected, other origins remain isolated, and original connection bytes remain for older pages. AI runs in the scheduled backend: Anthropic and Gmail credentials belong in repository Actions secrets, with no browser AI key. Data explains repository-managed mail/history; this digest cannot export or restore a whole mailbox.

Change Scheduled classification under App-specific and explicitly Save. The existing version/merge queue retains unrelated settings. Save/discard cleanup drafts first. Failure keeps the input draft, restores the previous displayed state and reports that saving was not confirmed. Cleanup settings retain their own per-field save behavior. Reset changes appearance and shortcuts only; it keeps mail and connection. The distributable template carries the same runtime, logos and checks as the main app.

右上齿轮统一管理五部分设置；语言、主题、配色和定时分类不再有页头重复控件。分类文字仅显示状态，刷新、筛选、清理审核与撤销仍保留。定时分类需在应用专属中更改并保存；先处理清理设置草稿，保存失败时保留输入并显示未确认。AI 凭据继续由定时后台的仓库密钥管理，浏览器不新增 AI 密钥，也不提供虚假的整邮箱备份或恢复。重置只改外观与快捷键，保留邮件与连接。
