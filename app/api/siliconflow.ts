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

import {
  EventStreamContentType,
  fetchEventSource,
} from "@fortaine/fetch-event-source";
import { allowSearch, WebSearchResult, WebSearchTool } from "./search";
import {
  fillSearchTemplateWith,
  search_answer_zh_template,
} from "../search_templates";

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
  const isSearch = jsonBody.stream && jsonBody.model?.includes("Search");
  let searchRes: WebSearchResult | null = null;
  if (isSearch && jsonBody.messages) {
    try {
      const isAllowedToUseSearch = await allowSearch(
        req.headers.get("Authorization") || "",
      );
      const lastIndex = jsonBody.messages.length - 1;
      if (
        isAllowedToUseSearch &&
        lastIndex >= 0 &&
        jsonBody.messages[lastIndex].role === "user"
      ) {
        const lastUserMessage = jsonBody.messages[lastIndex];
        searchRes = await WebSearchTool(lastUserMessage.content);
        jsonBody.messages[lastIndex] = {
          role: "user",
          content: fillSearchTemplateWith(
            search_answer_zh_template,
            lastUserMessage.content,
            JSON.stringify(searchRes.search_results),
          ),
        };
      }
    } catch (error) {
      console.error("[SiliconFlow] Search Error", error);
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
  req.signal.addEventListener("abort", () => {
    controller.abort();
  });
  if (isSearch) {
    return fetchAndPostProcess(fetchUrl, fetchOptions, searchRes);
  }
  try {
    const res = await fetch(fetchUrl, fetchOptions);

    // to prevent browser prompt for credentials
    const newHeaders = new Headers(res.headers);
    newHeaders.delete("www-authenticate");
    // to disable nginx buffering
    newHeaders.set("X-Accel-Buffering", "no");
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
async function fetchAndPostProcess(
  fetchUrl: string,
  fetchOptions: RequestInit,
  searchResult: WebSearchResult | null,
) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const requestHeaders = new Headers(fetchOptions.headers);
  const processedHeaders = Object.fromEntries(requestHeaders) as Record<
    string,
    string
  >;

  let openResolve: (value: Response | PromiseLike<Response>) => void;
  let openReject: (reason?: any) => void;

  const openPromise = new Promise<Response>((resolve, reject) => {
    openResolve = resolve;
    openReject = reject;
  });

  let responseText = "";

  let searchResultSent = false;
  fetchEventSource(fetchUrl, {
    ...fetchOptions,
    signal: fetchOptions.signal,
    headers: processedHeaders,
    async onopen(res) {
      const contentType = res.headers.get("content-type");

      if (contentType?.startsWith("text/plain")) {
        responseText = await res.clone().text();
        return openResolve(
          new Response(responseText, {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
          }),
        );
      }

      if (
        !res.ok ||
        !res.headers.get("content-type")?.startsWith(EventStreamContentType) ||
        res.status !== 200
      ) {
        const responseTexts = [responseText];
        let extraInfo = await res.clone().text();
        try {
          const resJson = await res.clone().json();
          extraInfo = prettyObject(resJson);
        } catch {}

        if (res.status === 401) {
          responseTexts.push("Unauthorized");
        }

        if (extraInfo) {
          responseTexts.push(extraInfo);
        }
        return openResolve(
          new Response(responseTexts.join("\n"), {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
          }),
        );
      }
      return openResolve(
        new Response(readable, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        }),
      );
    },
    onmessage(event) {
      if (!searchResultSent) {
        type Choices = Array<{
          delta: any;
        }>;
        if (searchResult) {
          for (const k of ["index", "query", "result"]) {
            const chuck = JSON.parse(event.data) as { choices: Choices };
            const key = k as keyof typeof searchResult.deltas;
            chuck.choices = [{ delta: searchResult.deltas[key] }];
            writer.write(encoder.encode(`data: ${JSON.stringify(chuck)}\n\n`));
          }
        } else {
          const chuck = JSON.parse(event.data) as { choices: Choices };
          chuck.choices = [
            {
              delta: {
                content: null,
                reasoning_content: "⚠️ Search Failed\n",
                role: "assistant",
              },
            },
          ];
          writer.write(encoder.encode(`data: ${JSON.stringify(chuck)}\n\n`));
        }
        searchResultSent = true;
      }
      const data = event.data ? `data: ${event.data}\n` : "";
      const eventStr = [
        event.event ? `event: ${event.event}\n` : "",
        data,
        event.id ? `id: ${event.id}\n` : "",
        event.retry ? `retry: ${event.retry}\n` : "",
        "\n",
      ].join("");
      writer.write(encoder.encode(eventStr));
    },
    onclose() {
      writer.close();
    },
    onerror(e) {
      writer.abort(e);
      throw e;
    },
    openWhenHidden: true,
  });

  return await openPromise;
}
