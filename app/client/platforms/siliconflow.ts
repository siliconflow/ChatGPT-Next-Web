"use client";
// azure and openai, using same models. so using same LLMApi.
import {
  ApiPath,
  SILICONFLOW_BASE_URL,
  SiliconFlow,
  DEFAULT_MODELS,
  REQUEST_TIMEOUT_MS_FOR_THINKING,
  SILICONCHAT_BASE_URL,
} from "@/app/constant";
import {
  useAccessStore,
  useAppConfig,
  useChatStore,
  ChatMessageTool,
  usePluginStore,
} from "@/app/store";
import { preProcessImageContent, streamWithThink } from "@/app/utils/chat";
import {
  ChatOptions,
  getHeaders,
  LLMApi,
  LLMModel,
  SpeechOptions,
} from "../api";
import { getClientConfig } from "@/app/config/client";
import {
  getMessageTextContent,
  getMessageTextContentWithoutThinking,
  isVisionModel,
} from "@/app/utils";
import { RequestPayload } from "./openai";
import { fetch } from "@/app/utils/stream";
import { Cookies } from "react-cookie";
import { SearchIndexes, SearchResults } from "@/app/search_templates";
export interface SiliconFlowListModelResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    root: string;
  }>;
}

export class SiliconflowApi implements LLMApi {
  private disableListModels = true;

  path(path: string, opts: { isSearch?: boolean } = {}): string {
    const accessStore = useAccessStore.getState();

    let baseUrl = "";

    if (accessStore.useCustomConfig) {
      baseUrl = accessStore.siliconflowUrl;
    }

    if (baseUrl.length === 0) {
      const isApp = !!getClientConfig()?.isApp;
      const apiPath = ApiPath.SiliconFlow;
      baseUrl = isApp ? SILICONFLOW_BASE_URL : apiPath;
    }

    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }
    if (
      !baseUrl.startsWith("http") &&
      !baseUrl.startsWith(ApiPath.SiliconFlow)
    ) {
      baseUrl = "https://" + baseUrl;
    }

    const isVercelBuild = !!getClientConfig()?.isVercelBuild;
    baseUrl = SILICONFLOW_BASE_URL;
    if (opts.isSearch || accessStore.isConfMode()) {
      baseUrl = ApiPath.SiliconFlow;
    }
    if (opts.isSearch && isVercelBuild) {
      baseUrl = SILICONCHAT_BASE_URL;
    }

    console.log("[Proxy Endpoint] ", baseUrl, path);

    return [baseUrl, path].join("/");
  }

  extractMessage(res: any) {
    return res.choices?.at(0)?.message?.content ?? "";
  }

  speech(options: SpeechOptions): Promise<ArrayBuffer> {
    throw new Error("Method not implemented.");
  }

  async chat(options: ChatOptions) {
    const visionModel = isVisionModel(options.config.model);
    const messages: ChatOptions["messages"] = [];
    for (const v of options.messages) {
      if (v.role === "assistant") {
        const content = getMessageTextContentWithoutThinking(v);
        messages.push({ role: v.role, content });
      } else {
        const content = visionModel
          ? await preProcessImageContent(v.content)
          : getMessageTextContent(v);
        messages.push({ role: v.role, content });
      }
    }

    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...{
        model: options.config.model,
        providerName: options.config.providerName,
      },
    };

    const requestPayload: RequestPayload = {
      messages,
      stream: options.config.stream,
      model: modelConfig.model,
      temperature: modelConfig.temperature,
      presence_penalty: modelConfig.presence_penalty,
      frequency_penalty: modelConfig.frequency_penalty,
      top_p: modelConfig.top_p,
      // max_tokens: Math.max(modelConfig.max_tokens, 1024),
      // Please do not ask me why not send max_tokens, no reason, this param is just shit, I dont want to explain anymore.
    };

    console.log("[Request] openai payload: ", requestPayload);

    const shouldStream = !!options.config.stream;
    const controller = new AbortController();
    options.onController?.(controller);

    try {
      const chatPath = this.path(SiliconFlow.ChatPath, {
        isSearch: modelConfig.model.endsWith("-Search"),
      });
      const chatPayload = {
        method: "POST",
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
        headers: getHeaders(),
      };

      // console.log(chatPayload);

      // Use extended timeout for thinking models as they typically require more processing time
      const requestTimeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS_FOR_THINKING * 2,
      );

      if (shouldStream) {
        const [tools, funcs] = usePluginStore
          .getState()
          .getAsTools(
            useChatStore.getState().currentSession().mask?.plugin || [],
          );
        return streamWithThink(
          chatPath,
          requestPayload,
          getHeaders(),
          tools as any,
          funcs,
          controller,
          // parseSSE
          (text: string, runTools: ChatMessageTool[]) => {
            // console.log("parseSSE", text, runTools);
            const json = JSON.parse(text);
            const choices = json.choices as Array<{
              finish_reason: string;
              delta: {
                content: string | null;
                tool_calls: ChatMessageTool[];
                reasoning_content: string | null;
                search_results: SearchResults | undefined;
                search_indexes: SearchIndexes | undefined;
              };
            }>;
            if (choices[0].finish_reason === "risky") {
              return {
                isThinking: false,
                content: undefined,
                shouldRecall: true,
              };
            }
            if (!!choices[0].delta.search_indexes) {
              console.log("[Search Indexes]", choices[0].delta.search_indexes);
              return {
                isThinking: false,
                search_indexes: choices[0].delta.search_indexes,
                content: undefined,
              };
            }
            if (!!choices[0].delta.search_results) {
              console.log("[Search Results]", choices[0].delta.search_results);
              return {
                isThinking: false,
                search_results: choices[0].delta.search_results,
                content: "",
              };
            }
            const tool_calls = choices[0]?.delta?.tool_calls;
            if (tool_calls?.length > 0) {
              const index = tool_calls[0]?.index;
              const id = tool_calls[0]?.id;
              const args = tool_calls[0]?.function?.arguments;
              if (id) {
                runTools.push({
                  id,
                  type: tool_calls[0]?.type,
                  function: {
                    name: tool_calls[0]?.function?.name as string,
                    arguments: args,
                  },
                });
              } else {
                // @ts-ignore
                runTools[index]["function"]["arguments"] += args;
              }
            }
            const reasoning = choices[0]?.delta?.reasoning_content;
            const content = choices[0]?.delta?.content;

            // Skip if both content and reasoning_content are empty or null
            if (
              (!reasoning || reasoning.length === 0) &&
              (!content || content.length === 0)
            ) {
              return {
                isThinking: false,
                content: "",
              };
            }

            if (reasoning && reasoning.length > 0) {
              return {
                isThinking: true,
                content: reasoning,
              };
            } else if (content && content.length > 0) {
              return {
                isThinking: false,
                content: content,
              };
            }

            return {
              isThinking: false,
              content: "",
            };
          },
          // processToolMessage, include tool_calls message and tool call results
          (
            requestPayload: RequestPayload,
            toolCallMessage: any,
            toolCallResult: any[],
          ) => {
            // @ts-ignore
            requestPayload?.messages?.splice(
              // @ts-ignore
              requestPayload?.messages?.length,
              0,
              toolCallMessage,
              ...toolCallResult,
            );
          },
          options,
        );
      } else {
        const res = await fetch(chatPath, chatPayload);
        clearTimeout(requestTimeoutId);

        const resJson = await res.json();
        const message = this.extractMessage(resJson);
        options.onFinish(message, res);
      }
    } catch (e) {
      console.log("[Request] failed to make a chat request", e);
      options.onError?.(e as Error);
    }
  }
  async usage() {
    return {
      used: 0,
      total: 0,
    };
  }

  async models(): Promise<LLMModel[]> {
    if (this.disableListModels) {
      return DEFAULT_MODELS.slice();
    }

    const res = await fetch(this.path(SiliconFlow.ListModelPath), {
      method: "GET",
      headers: {
        ...getHeaders(),
      },
    });

    const resJson = (await res.json()) as SiliconFlowListModelResponse;
    const chatModels = resJson.data;
    console.log("[Models]", chatModels);

    if (!chatModels) {
      return [];
    }

    let seq = 1000; //同 Constant.ts 中的排序保持一致
    return chatModels.map((m) => ({
      name: m.id,
      available: true,
      sorted: seq++,
      provider: {
        id: "siliconflow",
        providerName: "SiliconFlow",
        providerType: "siliconflow",
        sorted: 14,
      },
    }));
  }
}

export function retrieveAPIKeyFromCookies() {
  const cookies = new Cookies();
  const sfak = cookies.get("sfak");
  return sfak;
}

export function deleteAPIKeyFromCookies() {
  const cookies = new Cookies();
  cookies.remove("sfak");
}
