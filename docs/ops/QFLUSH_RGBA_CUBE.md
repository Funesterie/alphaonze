# Qflush RGBA Cube

Qflush RGBA Cube is a neutral planning layer for Qflush.

It does not replace the existing flows. It projects incoming objects into four stable lanes, deduplicates repeated payloads, sorts work by priority, then returns a route plan that workers can consume.

```txt
Object
-> projection
-> RGBA vector
-> route plan
-> worker / MCP / memory / media pipeline
```

## Faces

- `R` memory: conversation context, summaries, Neo4j memory.
- `G` tools: MCP tools, terminal/control requests, guarded dispatch.
- `B` data: files, images, audio, video, documents, JSON/binary payloads.
- `A` orchestration: jobs, queues, workflow plans, priority scheduling.

## Flow

`qflush.rgba.multiload.v1`

Input shape:

```json
{
  "sessionId": "conversation-id",
  "accountTier": "basic | family | premium | founder | admin",
  "items": [
    {
      "payload": "text, JSON, file metadata, media metadata, etc.",
      "contentType": "text/plain",
      "priority": "basic"
    }
  ]
}
```

By default, the flow returns hashes, sizes, lanes and route metadata, not raw payload previews. Set `includePreview: true` only for local debugging.

## API

- `GET /api/qflush/cube/status`
- `POST /api/qflush/cube/plan`
- `POST /api/qflush/run` with `flow: "qflush.rgba.multiload.v1"`

## Why

The practical use case is to stop repeated files or repeated image prompts from flooding the queue. A repeated upload in the same session keeps one packet and records the duplicate. Admin/founder jobs get higher priority, while public/basic jobs stay in a lower lane.
