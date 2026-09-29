# Gemini 文生图 (Image Generation) 支持设计文档

## 1. 背景与目标
`dayan-gemini-proxy` 是一个部署在 Vercel 上的透明轻量 Gemini 反向代理（固定在 `iad1` 节点以绕过地域限制）。
随着 Google Gemini 图像生成模型升级（Imagen 逐步退役，全面迁移到以 `gemini-3.1-flash-image`、`gemini-3-pro-image` 为代表的原生 Nano Banana 多模态生图能力），本项目需要在保持原有透明反向代理能力的同时，扩展对 OpenAI 标准文生图接口（`POST /v1/images/generations`）的支持，便于三方前端客户端、OpenAI SDK 以及自动化工具无缝对接。

## 2. 接口契约与路由设计

### 2.1 路由规则
- `POST /v1/images/generations`（或匹配 `*/images/generations`）：进入文生图转译处理器 `api/images.js`。
- 其他所有请求（包括 Gemini 原生生图端点 `POST /v1beta/models/gemini-3.1-flash-image:generateContent`、对话、Embeddings、模型查询等）：原样透明转发至 `https://generativelanguage.googleapis.com`。

### 2.2 鉴权提取
支持从以下三处按序提取 API Key：
1. `Authorization: Bearer <API_KEY>`
2. `x-goog-api-key: <API_KEY>`
3. URL 查询参数 `?key=<API_KEY>`

若均缺失，返回 401 响应：
```json
{
  "error": {
    "message": "Missing API key in Authorization header or x-goog-api-key",
    "type": "invalid_request_error",
    "code": "invalid_api_key"
  }
}
```

### 2.3 请求转换规范（OpenAI -> Gemini）
- **模型验证（严格模式）**：
  必须指定有效的 Gemini 图像模型名称。支持的典型模型包括：
  - `gemini-3.1-flash-image`（Nano Banana 2，主力推荐）
  - `gemini-3-pro-image`（Nano Banana Pro）
  - `gemini-3.1-flash-lite-image`（Nano Banana 2 Lite）
  - `gemini-2.5-flash-image`（Nano Banana）
  - 允许前缀为 `gemini-` 且包含 `image` 的模型名称。
  - 若传入如 `dall-e-3` 或不传 `model`，返回 400 错误，并明确提示支持的 Gemini 图像模型列表。
- **Prompt 映射**：
  转换为 Gemini `contents`：
  ```json
  {
    "contents": [
      {
        "role": "user",
        "parts": [{ "text": prompt }]
      }
    ]
  }
  ```
- **Size / Aspect Ratio 映射**：
  OpenAI `size` 参数到 Gemini `aspectRatio` 的映射关系：
  - `1024x1024` -> `1:1`
  - `1024x1792` / `768x1344` -> `9:16`
  - `1792x1024` / `1344x768` -> `16:9`
  - `1024x1365` -> `3:4`
  - `1365x1024` -> `4:3`
  - 缺省或未匹配时：默认 `1:1`。
- **Generation Config**：
  ```json
  {
    "generationConfig": {
      "responseModalities": ["IMAGE"],
      "imageConfig": {
        "aspectRatio": mappedAspectRatio
      }
    }
  }
  ```

### 2.4 响应转换规范（Gemini -> OpenAI）
- 上游请求地址：`https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`
- **成功场景**：
  从 Gemini 响应 `candidates[0].content.parts[0].inlineData` 中提取 `data`（base64 字符串）和 `mimeType`（如 `image/png`）。
  自适应组装返回：
  ```json
  {
    "created": 1740000000,
    "data": [
      {
        "b64_json": "<base64_data>",
        "url": "data:<mimeType>;base64,<base64_data>"
      }
    ]
  }
  ```
- **错误场景**：
  转换 Google 错误为 OpenAI 标准错误对象：
  ```json
  {
    "error": {
      "message": "<friendly_message>",
      "type": "<error_type>",
      "code": "<error_code>"
    }
  }
  ```
  针对 `limit: 0` 错误特别标注：Google AI Studio Free Tier 目前对生图模型配额为 0，需绑定支付账户（Pay-as-you-go）。

## 3. 架构与目录组织
- `api/index.js`：全局请求拦截与路由派发，保留 OPTIONS 与健康检查。
- `api/images.js`：文生图协议转译模块（入参校验、构建上游请求、转换响应）。
- `test/images.test.js`：Node.js 原生单测（Mock 上游，覆盖鉴权、参数映射、正常返回、异常处理）。
- `scripts/test-images.js`：命令行 E2E 测试脚本，支持使用真实 API Key 对代理服务进行验证。
- `README.md`：更新使用说明，提供 OpenAI 客户端调用与 cURL 调用示例。

## 4. 零外部依赖设计
严格保持零生产依赖（Zero External Production Dependencies），仅使用 Node.js 原生标准库（`fetch`、`Readable`、`Buffer`、`URL`），确保 Vercel Serverless 冷启动最优化。
