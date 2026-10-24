# Public Settings build

The vendored runtime contains only this app’s capability and legacy theme key. It has no host address or registry of other apps. The manifest identifies the app-scoped build and hashes its files.

Ordinary standalone copies use their own connection. They cannot inherit or edit a shared connection; manager links are absent. This app’s own existing AI key remains editable when the app supports it. Mail classification credentials remain on the backend.

A hosting build may insert these inert HTML meta tags before the runtime loads:

```html
<meta name="settings-host" content="same-origin-v1">
<meta name="settings-manager" content="/?app=Mail-Sorter#keys-and-connections">
```

The runtime accepts only HTTP(S), the current origin and a root-path manager URL. Missing, malformed or cross-origin context leaves the copy isolated. These tags are deployment output, absent from the public source. They configure a shared browser origin; they are not an authentication boundary. The host must provide its own access control.

公开版本只保留本应用的能力与旧主题键，不携带主机地址或其他应用清单。独立副本使用自己的连接，不继承共享连接，也不显示管理入口。托管构建可在加载前加入上述同源标记；标记缺失、无效或跨源时仍保持独立。此标记用于同源配置，不代替主机的访问控制。邮件分类凭证仍留在后端。
