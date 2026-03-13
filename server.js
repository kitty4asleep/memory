import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());
const port = process.env.PORT || 3000;

const serverInfo = { name: "memory-mcp", version: "0.2.0" };

// Supabase 配置
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const MEM_TABLE = process.env.SUPABASE_MEM_TABLE || "memories";
const DIARY_TABLE = process.env.SUPABASE_DIARY_TABLE || "diary";

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase not configured");
  }
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...options.headers
  };
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

const handleRpc = async (body = {}) => {
  const { jsonrpc, id, method, params = {} } = body;
  if (jsonrpc !== "2.0" || typeof id === "undefined") {
    return {
      status: 400,
      json: {
        jsonrpc: "2.0",
        error: { code: -32600, message: "Invalid Request" },
        id: null
      }
    };
  }

  // 初始化
  if (method === "initialize") {
    return {
      status: 200,
      json: {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params.protocolVersion || "2025-03-26",
          serverInfo,
          capabilities: { tools: {} }
        }
      }
    };
  }

  // 列工具
  if (method === "tools/list") {
    return {
      status: 200,
      json: {
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "memory_add",
              description: "Store a memory entry in Supabase",
              inputSchema: {
                type: "object",
                properties: {
                  content: { type: "string" },
                  title: { type: "string" },
                  owner: { type: "string" }
                },
                required: ["content"],
                additionalProperties: false
              }
            },
            {
              name: "memory_search",
              description: "Search recent memories in Supabase by keyword",
              inputSchema: {
                type: "object",
                properties: {
                  query: { type: "string" },
                  limit: { type: "number" }
                },
                required: ["query"],
                additionalProperties: false
              }
            },
            {
              name: "diary_add",
              description: "Add a diary entry written by Glacier",
              inputSchema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  content: { type: "string" },
                  mood: { type: "string" },
                  date: { type: "string" },   // 可选 yyyy-mm-dd
                  author: { type: "string" }  // 默认 Glacier
                },
                required: ["content"],
                additionalProperties: false
              }
            },
            {
              name: "diary_list_recent",
              description: "List recent diary entries",
              inputSchema: {
                type: "object",
                properties: {
                  limit: { type: "number" }
                },
                required: [],
                additionalProperties: false
              }
            }
          ]
        }
      }
    };
  }

  // 调工具
  if (method === "tools/call") {
    const { name, arguments: args = {} } = params;

    // 写记忆
    if (name === "memory_add") {
      try {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
          throw new Error("Supabase not configured");
        }
        const content = String(args.content || "");
        const title = args.title ? String(args.title) : null;
        const owner = args.owner ? String(args.owner) : "mimi";

        const payload = { content, owner };
        if (title) payload.title = title;

        const data = await supabaseRequest(
          `${MEM_TABLE}`,
          {
            method: "POST",
            body: JSON.stringify([payload]),
            headers: {
              Prefer: "return=representation"
            }
          }
        );

        const stored = Array.isArray(data) ? data[0] : data;

        return {
          status: 200,
          json: {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: `stored memory id=${stored.id || "unknown"}`
                }
              ]
            }
          }
        };
      } catch (e) {
        return {
          status: 500,
          json: {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32010,
              message: "memory_add failed: " + String(e)
            }
          }
        };
      }
    }

    // 搜记忆
    if (name === "memory_search") {
      try {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
          throw new Error("Supabase not configured");
        }
        const query = String(args.query || "");
        const limit = Number(args.limit || 5);

        const encodedQuery = encodeURIComponent(`%${query}%`);
        const path =
          `${MEM_TABLE}?` +
          `content=ilike.${encodedQuery}` +
          `&order=created_at.desc` +
          `&limit=${limit}`;

        const data = await supabaseRequest(path, { method: "GET" });

        const lines = (data || []).map((row) => {
          const created = row.created_at || "";
          const title = row.title || "";
          return `[${created}] ${title} ${row.content || ""}`;
        });

        const text =
          lines.length > 0
            ? lines.join("\n")
            : "no memory matched";

        return {
          status: 200,
          json: {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text }]
            }
          }
        };
      } catch (e) {
        return {
          status: 500,
          json: {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32011,
              message: "memory_search failed: " + String(e)
            }
          }
        };
      }
    }

    // 写日记
    if (name === "diary_add") {
      try {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
          throw new Error("Supabase not configured");
        }
        const content = String(args.content || "");
        const title = args.title ? String(args.title) : null;
        const mood = args.mood ? String(args.mood) : null;
        const author = args.author ? String(args.author) : "Glacier";
        const date = args.date ? String(args.date) : null;

        const payload = { content, author };
        if (title) payload.title = title;
        if (mood) payload.mood = mood;
        if (date) payload.date = date;

        const data = await supabaseRequest(
          `${DIARY_TABLE}`,
          {
            method: "POST",
            body: JSON.stringify([payload]),
            headers: {
              Prefer: "return=representation"
            }
          }
        );

        const stored = Array.isArray(data) ? data[0] : data;

        return {
          status: 200,
          json: {
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: `stored diary id=${stored.id || "unknown"}`
                }
              ]
            }
          }
        };
      } catch (e) {
        return {
          status: 500,
          json: {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32020,
              message: "diary_add failed: " + String(e)
            }
          }
        };
      }
    }

    // 列最近日记
    if (name === "diary_list_recent") {
      try {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
          throw new Error("Supabase not configured");
        }
        const limit = Number(args.limit || 5);

        const path =
          `${DIARY_TABLE}?` +
          `order=created_at.desc` +
          `&limit=${limit}`;

        const data = await supabaseRequest(path, { method: "GET" });

        const lines = (data || []).map((row) => {
          const d = row.date || row.created_at || "";
          const title = row.title || "";
          const mood = row.mood ? `【${row.mood}】` : "";
          const author = row.author || "";
          return `${d} ${mood} ${title} (${author})\n${row.content || ""}`;
        });

        const text =
          lines.length > 0
            ? lines.join("\n\n---\n\n")
            : "no diary entries yet";

        return {
          status: 200,
          json: {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text }]
            }
          }
        };
      } catch (e) {
        return {
          status: 500,
          json: {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32021,
              message: "diary_list_recent failed: " + String(e)
            }
          }
        };
      }
    }

    return {
      status: 400,
      json: {
        jsonrpc: "2.0",
        id,
        error: { code: -32001, message: "Unknown tool" }
      }
    };
  }

  return {
    status: 400,
    json: {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found" }
    }
  };
};

// 入口
app.post("/", async (req, res) => {
  console.log("POST / body:", req.body);
  const r = await handleRpc(req.body);
  res.status(r.status).json(r.json);
});
app.post("/mcp", async (req, res) => {
  console.log("POST /mcp body:", req.body);
  const r = await handleRpc(req.body);
  res.status(r.status).json(r.json);
});

// 健康检查
app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/", (req, res) => res.send("Memory MCP server is running"));

app.listen(port, () => console.log("memory-mcp server up on", port));
