# 大会演示

## 依赖项
- 已经运行的 SiliconLLM 实例，或能够直接访问 SiliconCloud API
- docker 环境

## 使用 docker 运行

创建 `.env` 文件
```env
SILICONFLOW_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SILICONFLOW_URL=http://127.0.0.1:8000
SILICON_CHAT_SEARCH_ENDPOINT=SEARCH_ENDPOINT_TO_USE
SILICON_CHAT_SEARCH_API_KEY=sk-yyyyyyyyyyyyyyyyyyyyyyyyyyyy
```
```bash
podman run --rm -p 3000:3000 --env-file .env oneflowinc/silicon-chat
```

###（注）
- 即时这个 SiliconLLM 实例不需要 API Key，也需要填写一个非空的 `SILICONFLOW_API_KEY` 环境变量让前端跳过认证。
- 也可以不创建 env 文件，直接使用 docker run 的 `--env` 参数传入环境变量。
