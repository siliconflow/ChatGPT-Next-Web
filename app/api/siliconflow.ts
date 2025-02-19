import { getServerSideConfig } from "@/app/config/server";
import {
  SILICONFLOW_BASE_URL,
  ApiPath,
  ModelProvider,
  ServiceProvider,
  DEFAULT_SYSTEM_TEMPLATE,
  DEFAULT_SYSTEM_TEMPLATE_R1,
  DEFAULT_SYSTEM_TEMPLATE_V3,
} from "@/app/constant";
import { prettyObject } from "@/app/utils/format";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/api/auth";
import { isModelNotavailableInServer } from "@/app/utils/model";
import { RequestMessage } from "../typing";
import { WebSearchTool } from "./search";
import {
  fillSearchTemplateWith,
  search_answer_zh_template,
} from "./search_templates";

const serverConfig = getServerSideConfig();

export async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  console.log("[SiliconFlow Route] params ", params);

  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const authResult = auth(req, ModelProvider.SiliconFlow);
  if (authResult.error) {
    return NextResponse.json(authResult, {
      status: 401,
    });
  }

  try {
    const response = await request(req);
    return response;
  } catch (e) {
    console.error("[SiliconFlow] ", e);
    return NextResponse.json(prettyObject(e));
  }
}

export function fillTemplateWith(
  input: string,
  modelConfig: { model: string; template?: string },
) {
  // Find the model in the DEFAULT_MODELS array that matches the modelConfig.model
  const vars = {
    ServiceProvider: ServiceProvider.SiliconFlow,
    model: modelConfig.model,
    time: new Date().toString(),
    input: input,
    current_date: new Date().toLocaleDateString(),
  };

  let output = modelConfig.template ?? DEFAULT_SYSTEM_TEMPLATE;

  // remove duplicate
  if (input.startsWith(output)) {
    output = "";
  }

  // must contains {{input}}
  const inputVar = "{{input}}";
  if (!output.includes(inputVar)) {
    output += "\n" + inputVar;
  }

  Object.entries(vars).forEach(([name, value]) => {
    const regex = new RegExp(`{{${name}}}`, "g");
    output = output.replace(regex, value.toString()); // Ensure value is a string
  });

  return output;
}

async function request(req: NextRequest) {
  const controller = new AbortController();

  // alibaba use base url or just remove the path
  let path = `${req.nextUrl.pathname}`.replaceAll(ApiPath.SiliconFlow, "");

  let baseUrl = serverConfig.siliconFlowUrl || SILICONFLOW_BASE_URL;

  if (!baseUrl.startsWith("http")) {
    baseUrl = `https://${baseUrl}`;
  }

  if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }

  console.log("[Proxy] ", path);
  console.log("[Base Url]", baseUrl);

  const timeoutId = setTimeout(
    () => {
      controller.abort();
    },
    10 * 60 * 1000,
  );

  const fetchUrl = `${baseUrl}${path}`;
  const fetchOptions: RequestInit = {
    headers: {
      "Content-Type": "application/json",
      Authorization: req.headers.get("Authorization") ?? "",
      "X-SiliconCloud-Source": "chat",
    },
    method: req.method,
    body: req.body,
    redirect: "manual",
    // @ts-ignore
    duplex: "half",
    signal: controller.signal,
  };

  const clonedBody = await req.text();
  const jsonBody = JSON.parse(clonedBody) as {
    model?: string;
    messages?: Array<{ role: string; content: string }>;
    stream?: boolean;
  };

  let t = DEFAULT_SYSTEM_TEMPLATE;
  if (jsonBody.model?.toLowerCase().includes("v3"))
    t = DEFAULT_SYSTEM_TEMPLATE_V3;
  if (jsonBody.model?.toLowerCase().includes("r1"))
    t = DEFAULT_SYSTEM_TEMPLATE_R1;
  const SYSTEM_PROMPT: RequestMessage = {
    role: "system",
    content: fillTemplateWith("", {
      template: t,
      model: (jsonBody.model || "").replace("Pro/", ""),
    }),
  };
  if (jsonBody.messages) {
    jsonBody.messages = [
      SYSTEM_PROMPT,
      ...jsonBody.messages.filter((m) => m.role !== "system"),
    ];
  } else {
    jsonBody.messages = [SYSTEM_PROMPT];
  }
  let searchPrependResult = "";
  const isSearch = jsonBody.stream && jsonBody.model?.includes("Search");
  if (isSearch) {
    const lastIndex = jsonBody.messages.length - 1;
    if (lastIndex >= 0 && jsonBody.messages[lastIndex].role === "user") {
      const lastUserMessage = jsonBody.messages[lastIndex];
      const searchRes = await WebSearchTool(lastUserMessage.content);
      searchPrependResult = searchRes.markdown + "\n";
      jsonBody.messages[lastIndex] = {
        role: "user",
        content: fillSearchTemplateWith(
          search_answer_zh_template,
          lastUserMessage.content,
          JSON.stringify(searchRes.search_results),
        ),
      };
    }
    jsonBody.model = jsonBody.model?.replace("-Search", "");
  }
  fetchOptions.body = JSON.stringify(jsonBody);

  // #1815 try to refuse some request to some models
  if (serverConfig.customModels && req.body) {
    try {
      const clonedBody = await req.text();
      fetchOptions.body = clonedBody;

      const jsonBody = JSON.parse(clonedBody) as { model?: string };

      // not undefined and is false
      if (
        isModelNotavailableInServer(
          serverConfig.customModels,
          jsonBody?.model as string,
          ServiceProvider.SiliconFlow as string,
        )
      ) {
        return NextResponse.json(
          {
            error: true,
            message: `you are not allowed to use ${jsonBody?.model} model`,
          },
          {
            status: 403,
          },
        );
      }
    } catch (e) {
      console.error(`[SiliconFlow] filter`, e);
    }
  }
  try {
    const res = await fetch(fetchUrl, fetchOptions);

    // to prevent browser prompt for credentials
    const newHeaders = new Headers(res.headers);
    newHeaders.delete("www-authenticate");
    // to disable nginx buffering
    newHeaders.set("X-Accel-Buffering", "no");

    const transformedStream =
      res.body && isSearch
        ? new ReadableStream({
            async start(controller) {
              const reader = res.body?.getReader();
              const encoder = new TextEncoder();
              const decoder = new TextDecoder();
              const message0 = {
                id: "01951d652447569f44138d05bccd4e86",
                object: "chat.completion.chunk",
                created: 1739954922,
                model: "Pro/deepseek-ai/DeepSeek-R1",
                choices: [
                  {
                    index: 0,
                    delta: {
                      content: "",
                      reasoning_content: "",
                      role: "assistant",
                    },
                    finish_reason: null,
                    content_filter_results: {
                      hate: { filtered: false },
                      self_harm: { filtered: false },
                      sexual: { filtered: false },
                      violence: { filtered: false },
                    },
                  },
                ],
                system_fingerprint: "",
                usage: {
                  prompt_tokens: 2155,
                  completion_tokens: 0,
                  total_tokens: 2155,
                },
              };
              type msg = typeof message0;
              let searchInjected = false;
              try {
                while (true && reader) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  if (!searchInjected) {
                    let msg0 = null;
                    const prefixData = "data: ";
                    const suffixLineBreak = "\n\n";
                    const msg_0_str = decoder.decode(value);
                    const regex = /^data: (.*)\n\n$/;
                    const match = msg_0_str.match(regex);

                    if (match && match[1]) {
                      msg0 = JSON.parse(match[1]) as msg;
                      if (!!msg0.choices[0].delta.reasoning_content) {
                        msg0.choices[0].delta.reasoning_content = `${searchPrependResult}${msg0.choices[0].delta.reasoning_content}`;
                        searchInjected = true;
                      }
                      if (!!msg0.choices[0].delta.content) {
                        msg0.choices[0].delta.content = `${searchPrependResult}${msg0.choices[0].delta.reasoning_content}`;
                        searchInjected = true;
                      }
                    }

                    if (searchInjected) {
                      const customData = encoder.encode(
                        prefixData + JSON.stringify(msg0) + suffixLineBreak,
                      );
                      controller.enqueue(customData);
                    } else {
                      controller.enqueue(value);
                    }
                  } else {
                    controller.enqueue(value);
                  }
                }
              } catch (error) {
                controller.error(error);
              } finally {
                controller.close();
              }
            },
          })
        : res.body;

    return new Response(transformedStream, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
