# 薪迹 0.5.2 当前双端方案：整体架构与数据流

## 阅读顺序

先看下方项目总图理解模块和交互，再沿一次工资记录查看来源、计算、保存、同步与阅读。图中的边表示数据或调用关系；是否已在真实设备、真实云端验收仍以验证登记为准。

```forgeflow-map
{
  "version": 1,
  "nodes": [
    {
      "id": "salary-ui",
      "label": "Windows / Android 共用界面",
      "layer": "用户界面",
      "summary": "Vue 界面展示工资档案、核对、年度看板、原图、同步与设置；通过平台桥接使用原生能力。",
      "status": "implemented",
      "technology": [
        "Vue 3",
        "TypeScript",
        "WebView2",
        "Capacitor"
      ],
      "source": "src/App.vue"
    },
    {
      "id": "salary-feishu",
      "label": "电脑飞书工资页",
      "layer": "外部来源",
      "summary": "Windows 采集要求用户先打开并展开指定工资页；没有从服务端直接读取工资数据的接口。",
      "status": "implemented",
      "technology": [
        "飞书桌面端",
        "Windows UI Automation"
      ],
      "source": "windows/SalaryCollector/Program.cs"
    },
    {
      "id": "salary-screenshot",
      "label": "手机系统截图与用户选择",
      "layer": "外部来源",
      "summary": "Android 由用户在工资页自行截屏，再选择添加到对应记录；应用不能直接读取或静默截取其他应用页面。",
      "status": "implemented",
      "technology": [
        "Android 系统截图",
        "系统图片选择器"
      ],
      "source": "README.md"
    },
    {
      "id": "salary-collector",
      "label": "Windows 工资页采集器",
      "layer": "Windows 本机能力",
      "summary": "读取已展开页面的可访问性文本，校验月份与字段后形成结构化来源；这条路线不依赖截图 OCR。",
      "status": "implemented",
      "technology": [
        ".NET Framework",
        "Windows UI Automation"
      ],
      "source": "windows/SalaryCollector/Program.cs"
    },
    {
      "id": "salary-win-host",
      "label": "Windows 桌面宿主",
      "layer": "Windows 本机能力",
      "summary": "WinForms/WebView2 消息桥负责采集请求、本地账本和原图、文件操作及 WebDAV 调用。",
      "status": "implemented",
      "technology": [
        "WinForms",
        "WebView2",
        ".NET Framework"
      ],
      "source": "windows/SalaryDesktop/Program.cs"
    },
    {
      "id": "salary-android-host",
      "label": "Android 原生插件",
      "layer": "Android 本机能力",
      "summary": "Capacitor 插件承接文件、原图、凭据、WebDAV 和系统安装器能力；Android 不执行当前 Windows 飞书文本采集。",
      "status": "implemented",
      "technology": [
        "Capacitor",
        "Java",
        "Android SDK"
      ],
      "source": "android/app/src/main/java/com/flylabs/salary/SalaryNativePlugin.java"
    },
    {
      "id": "salary-domain",
      "label": "共享工资领域规则",
      "layer": "共享逻辑",
      "summary": "解析版本化账本并执行金额核算、差额解释和合并；金额使用整数分，未知金额保留 null。",
      "status": "implemented",
      "technology": [
        "TypeScript",
        "纯函数"
      ],
      "source": "src/domain/ledger.ts"
    },
    {
      "id": "salary-win-data",
      "label": "Windows 私有数据目录",
      "layer": "本机数据",
      "summary": "保存工资账本、来源和原始截图；同步凭据由 DPAPI 本机保护，数据目录与安装目录分离。",
      "status": "implemented",
      "technology": [
        "原子文件写入",
        "DPAPI"
      ],
      "source": "windows/SalaryDesktop/LocalStore.cs"
    },
    {
      "id": "salary-android-data",
      "label": "Android 应用私有数据",
      "layer": "本机数据",
      "summary": "保存工资账本与已关联原图；应用卸载会移除本机数据，同步密码由 Keystore 本机保护。",
      "status": "implemented",
      "technology": [
        "Android 私有目录",
        "Keystore"
      ],
      "source": "android/app/src/main/java/com/flylabs/salary/LedgerStore.java"
    },
    {
      "id": "salary-webdav",
      "label": "坚果云 WebDAV 同步",
      "layer": "外部同步",
      "summary": "双端已实现主动同步账本、原图及删除标记的代码；真实坚果云双端往返与真机持久化仍需独立验证。没有薪迹自建后端。",
      "status": "implemented",
      "technology": [
        "WebDAV",
        "HTTPS",
        "SHA-256"
      ],
      "source": "src/platform/sync.ts"
    }
  ],
  "edges": [
    {
      "from": "salary-feishu",
      "to": "salary-collector",
      "label": "读取已展开页面的可访问性文本",
      "status": "implemented"
    },
    {
      "from": "salary-collector",
      "to": "salary-win-host",
      "label": "返回经校验的结构化工资来源",
      "status": "implemented"
    },
    {
      "from": "salary-ui",
      "to": "salary-win-host",
      "label": "WebView2 消息桥请求本机操作",
      "status": "implemented"
    },
    {
      "from": "salary-ui",
      "to": "salary-android-host",
      "label": "Capacitor 插件请求本机操作",
      "status": "implemented"
    },
    {
      "from": "salary-ui",
      "to": "salary-domain",
      "label": "账本解析、核算、合并与展示",
      "status": "implemented"
    },
    {
      "from": "salary-win-host",
      "to": "salary-win-data",
      "label": "持久化账本、来源和原图",
      "status": "implemented"
    },
    {
      "from": "salary-screenshot",
      "to": "salary-android-host",
      "label": "用户选择原始截图后复制保存",
      "status": "implemented"
    },
    {
      "from": "salary-android-host",
      "to": "salary-android-data",
      "label": "持久化账本和原图",
      "status": "implemented"
    },
    {
      "from": "salary-win-host",
      "to": "salary-webdav",
      "label": "WebDAV 主动同步代码；真实云往返待验",
      "status": "implemented"
    },
    {
      "from": "salary-android-host",
      "to": "salary-webdav",
      "label": "WebDAV 主动同步代码；真机往返待验",
      "status": "implemented"
    }
  ]
}
```

## 一条记录怎样流动

1. 用户在飞书展开月份。Windows 采集器读取当前可访问文本，产出带月份、字段、金额原文和来源标识的结构化候选；不完整时停止，不让空值假扮金额。

2. 共享领域层用整数分解析和核算，生成应发、扣款、实发与差额。来源数据和推导结果分别进入本机账本；写入走原子替换与备份，读取失败呈现错误而非空档案。

3. 用户主动保存真实截图。原图进入平台私有目录，与工资记录以 ID 和哈希关联；界面只拿受控数据，不直接读取原生路径。删除原图产生持久删除状态。

4. 导出 JSON 只携带工资账本；坚果云 WebDAV 在固定目录交换工资增量、原图和删除标记。先合并工资，再处理已知记录的截图；上传后回读哈希，失败保留本机已成功部分，供下次重试。

5. Android 用同一套领域规则和 Vue 界面阅读、查看看板及截图，经 Capacitor 原生桥接持久化和导入。Windows 与 Android 的安装更新各走对应系统入口，不参与工资计算链路。

## 模块责任与边界

| 模块 | 负责 | 边界 |

| --- | --- | --- |

| Windows Collector / Desktop | 飞书可访问文本采集、文件与截图、本机保存及 WebDAV 桥接 | 不把未展开或无法证明完整的页面当作工资记录 |

| 共享 Vue/TypeScript 领域层 | 金额语义、核算、账本合并、年度统计与交互 | 不读取原生文件路径，不保存平台凭据 |

| Android 原生桥接 | 私有文件、截图导入、凭据、网络及系统安装器 | 不静默读取其他应用的工资页面 |

| JSON / WebDAV | 数据交换与冲突合并 | JSON 无截图；云端内容未端到端加密 |

## 当前实现与待验证

上述组件和链路按 0.5.2 源码与设计说明整理；浏览器、合成 WebDAV 与安装器测试各有独立证据。真实 Android 覆盖升级、真实坚果云双端原图往返及带数据的 Windows 更新仍应在对应验证登记中核对，不能仅凭图上的连线视为通过。细节见 D01–D06 档案。
