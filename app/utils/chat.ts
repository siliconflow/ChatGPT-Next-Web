import {
  CACHE_URL_PREFIX,
  UPLOAD_URL,
  REQUEST_TIMEOUT_MS,
} from "@/app/constant";
import { RequestMessage } from "@/app/client/api";
import Locale from "@/app/locales";
import {
  EventStreamContentType,
  fetchEventSource,
} from "@fortaine/fetch-event-source";
import { prettyObject } from "./format";
import { fetch as tauriFetch } from "./stream";
import {
  SearchIndexes,
  SearchResultEntry,
  SearchResults,
} from "../search_templates";

export function compressImage(file: Blob, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (readerEvent: any) => {
      const image = new Image();
      image.onload = () => {
        let canvas = document.createElement("canvas");
        let ctx = canvas.getContext("2d");
        let width = image.width;
        let height = image.height;
        let quality = 0.9;
        let dataUrl;

        do {
          canvas.width = width;
          canvas.height = height;
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
          ctx?.drawImage(image, 0, 0, width, height);
          dataUrl = canvas.toDataURL("image/jpeg", quality);

          if (dataUrl.length < maxSize) break;

          if (quality > 0.5) {
            // Prioritize quality reduction
            quality -= 0.1;
          } else {
            // Then reduce the size
            width *= 0.9;
            height *= 0.9;
          }
        } while (dataUrl.length > maxSize);

        resolve(dataUrl);
      };
      image.onerror = reject;
      image.src = readerEvent.target.result;
    };
    reader.onerror = reject;

    if (file.type.includes("heic")) {
      try {
        const heic2any = require("heic2any");
        heic2any({ blob: file, toType: "image/jpeg" })
          .then((blob: Blob) => {
            reader.readAsDataURL(blob);
          })
          .catch((e: any) => {
            reject(e);
          });
      } catch (e) {
        reject(e);
      }
    }

    reader.readAsDataURL(file);
  });
}

export async function preProcessImageContent(
  content: RequestMessage["content"],
) {
  if (typeof content === "string") {
    return content;
  }
  const result = [];
  for (const part of content) {
    if (part?.type == "image_url" && part?.image_url?.url) {
      try {
        const url = await cacheImageToBase64Image(part?.image_url?.url);
        result.push({ type: part.type, image_url: { url } });
      } catch (error) {
        console.error("Error processing image URL:", error);
      }
    } else {
      result.push({ ...part });
    }
  }
  return result;
}

const imageCaches: Record<string, string> = {};
export function cacheImageToBase64Image(imageUrl: string) {
  if (imageUrl.includes(CACHE_URL_PREFIX)) {
    if (!imageCaches[imageUrl]) {
      const reader = new FileReader();
      return fetch(imageUrl, {
        method: "GET",
        mode: "cors",
        credentials: "include",
      })
        .then((res) => res.blob())
        .then(
          async (blob) =>
            (imageCaches[imageUrl] = await compressImage(blob, 256 * 1024)),
        ); // compressImage
    }
    return Promise.resolve(imageCaches[imageUrl]);
  }
  return Promise.resolve(imageUrl);
}

export function base64Image2Blob(base64Data: string, contentType: string) {
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: contentType });
}

export function uploadImage(file: Blob): Promise<string> {
  if (!window._SW_ENABLED) {
    // if serviceWorker register error, using compressImage
    return compressImage(file, 256 * 1024);
  }
  const body = new FormData();
  body.append("file", file);
  return fetch(UPLOAD_URL, {
    method: "post",
    body,
    mode: "cors",
    credentials: "include",
  })
    .then((res) => res.json())
    .then((res) => {
      // console.log("res", res);
      if (res?.code == 0 && res?.data) {
        return res?.data;
      }
      throw Error(`upload Error: ${res?.msg}`);
    });
}

export function removeImage(imageUrl: string) {
  return fetch(imageUrl, {
    method: "DELETE",
    mode: "cors",
    credentials: "include",
  });
}

export function stream(
  chatPath: string,
  requestPayload: any,
  headers: any,
  tools: any[],
  funcs: Record<string, Function>,
  controller: AbortController,
  parseSSE: (text: string, runTools: any[]) => string | undefined,
  processToolMessage: (
    requestPayload: any,
    toolCallMessage: any,
    toolCallResult: any[],
  ) => void,
  options: any,
) {
  let responseText = "";
  let remainText = "";
  let finished = false;
  let running = false;
  let runTools: any[] = [];
  let responseRes: Response;

  // animate response to make it looks smooth
  function animateResponseText() {
    if (finished || controller.signal.aborted) {
      responseText += remainText;
      console.log("[Response Animation] finished");
      if (responseText?.length === 0) {
        options.onError?.(new Error("服务器繁忙"));
      }
      return;
    }

    if (remainText.length > 0) {
      const fetchCount = Math.max(1, Math.round(remainText.length / 60));
      const fetchText = remainText.slice(0, fetchCount);
      responseText += fetchText;
      remainText = remainText.slice(fetchCount);
      options.onUpdate?.(responseText, fetchText);
    }

    requestAnimationFrame(animateResponseText);
  }

  // start animaion
  animateResponseText();

  const finish = () => {
    if (!finished) {
      if (!running && runTools.length > 0) {
        const toolCallMessage = {
          role: "assistant",
          tool_calls: [...runTools],
        };
        running = true;
        runTools.splice(0, runTools.length); // empty runTools
        return Promise.all(
          toolCallMessage.tool_calls.map((tool) => {
            options?.onBeforeTool?.(tool);
            return Promise.resolve(
              // @ts-ignore
              funcs[tool.function.name](
                // @ts-ignore
                tool?.function?.arguments
                  ? JSON.parse(tool?.function?.arguments)
                  : {},
              ),
            )
              .then((res) => {
                let content = res.data || res?.statusText;
                // hotfix #5614
                content =
                  typeof content === "string"
                    ? content
                    : JSON.stringify(content);
                if (res.status >= 300) {
                  return Promise.reject(content);
                }
                return content;
              })
              .then((content) => {
                options?.onAfterTool?.({
                  ...tool,
                  content,
                  isError: false,
                });
                return content;
              })
              .catch((e) => {
                options?.onAfterTool?.({
                  ...tool,
                  isError: true,
                  errorMsg: e.toString(),
                });
                return e.toString();
              })
              .then((content) => ({
                name: tool.function.name,
                role: "tool",
                content,
                tool_call_id: tool.id,
              }));
          }),
        ).then((toolCallResult) => {
          processToolMessage(requestPayload, toolCallMessage, toolCallResult);
          setTimeout(() => {
            // call again
            console.debug("[ChatAPI] restart");
            running = false;
            chatApi(chatPath, headers, requestPayload, tools); // call fetchEventSource
          }, 60);
        });
        return;
      }
      if (running) {
        return;
      }
      console.debug("[ChatAPI] end");
      finished = true;
      options.onFinish(responseText + remainText, responseRes); // 将res传递给onFinish
    }
  };

  controller.signal.onabort = finish;

  function chatApi(
    chatPath: string,
    headers: any,
    requestPayload: any,
    tools: any,
  ) {
    const chatPayload = {
      method: "POST",
      body: JSON.stringify({
        ...requestPayload,
        tools: tools && tools.length ? tools : undefined,
      }),
      signal: controller.signal,
      headers,
    };
    const requestTimeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );
    fetchEventSource(chatPath, {
      fetch: tauriFetch as any,
      ...chatPayload,
      async onopen(res) {
        clearTimeout(requestTimeoutId);
        const contentType = res.headers.get("content-type");
        console.log("[Request] response content type: ", contentType);
        responseRes = res;

        if (contentType?.startsWith("text/plain")) {
          responseText = await res.clone().text();
          return finish();
        }

        if (
          !res.ok ||
          !res.headers
            .get("content-type")
            ?.startsWith(EventStreamContentType) ||
          res.status !== 200
        ) {
          const responseTexts = [responseText];
          let extraInfo = await res.clone().text();
          try {
            const resJson = await res.clone().json();
            extraInfo = prettyObject(resJson);
          } catch {}

          if (res.status === 401) {
            responseTexts.push(Locale.Error.Unauthorized);
          }

          if (extraInfo) {
            responseTexts.push(extraInfo);
          }

          responseText = responseTexts.join("\n\n");

          return finish();
        }
      },
      onmessage(msg) {
        if (msg.data === "[DONE]" || finished) {
          return finish();
        }
        const text = msg.data;
        // Skip empty messages
        if (!text || text.trim().length === 0) {
          return;
        }
        try {
          const chunk = parseSSE(text, runTools);
          if (chunk) {
            remainText += chunk;
          }
        } catch (e) {
          console.error("[Request] parse error", text, msg, e);
        }
      },
      onclose() {
        finish();
      },
      onerror(e) {
        options?.onError?.(e);
        throw e;
      },
      openWhenHidden: true,
    });
  }
  console.debug("[ChatAPI] start");
  chatApi(chatPath, headers, requestPayload, tools); // call fetchEventSource
}

export function streamWithThink(
  chatPath: string,
  requestPayload: any,
  headers: any,
  tools: any[],
  funcs: Record<string, Function>,
  controller: AbortController,
  parseSSE: (
    text: string,
    runTools: any[],
  ) => {
    isThinking: boolean;
    content: string | undefined;
    shouldRecall?: boolean | undefined;
    search_results?: SearchResults | undefined;
    search_indexes?: SearchIndexes | undefined;
  },
  processToolMessage: (
    requestPayload: any,
    toolCallMessage: any,
    toolCallResult: any[],
  ) => void,
  options: any,
) {
  let responseText = "";
  let remainText = "";
  let responseTextThinking = "";
  let remainTextThinking = "";
  let responseTextSearch = "";
  let remainTextSearch = "";
  let finished = false;
  let running = false;
  let runTools: any[] = [];
  let responseRes: Response;
  let isInThinkingMode = false;
  let lastIsThinking = false;
  let lastIsThinkingTagged = false; //between <think> and </think> tags

  // animate response to make it looks smooth
  function animateResponseText() {
    if (finished || controller.signal.aborted) {
      responseTextThinking += remainTextThinking;
      responseTextSearch += remainTextSearch;
      responseText += remainText;
      console.log("[Response Animation] finished");
      if (responseText?.length === 0) {
        options.onError?.(new Error("服务器繁忙，请稍后再试"));
      }
      return;
    }

    if (remainTextSearch.length > 0) {
      const fetchCount = Math.max(1, Math.round(remainTextSearch.length / 60));
      const fetchText = remainTextSearch.slice(0, fetchCount);
      responseTextSearch += fetchText;
      remainTextSearch = remainTextSearch.slice(fetchCount);
      options.onUpdateSearch?.(responseTextSearch, fetchText);
    }

    if (remainTextSearch.length == 0 && remainTextThinking.length > 0) {
      const fetchCount = Math.max(
        1,
        Math.round(remainTextThinking.length / 60),
      );
      const fetchText = remainTextThinking.slice(0, fetchCount);
      responseTextThinking += fetchText;
      remainTextThinking = remainTextThinking.slice(fetchCount);
      options.onUpdateThinking?.(responseTextThinking, fetchText);
    }

    if (
      remainTextSearch.length == 0 &&
      remainTextThinking.length == 0 &&
      remainText.length > 0
    ) {
      const fetchCount = Math.max(1, Math.round(remainText.length / 60));
      const fetchText = remainText.slice(0, fetchCount);
      responseText += fetchText;
      remainText = remainText.slice(fetchCount);
      options.onUpdate?.(responseText, fetchText);
    }

    requestAnimationFrame(animateResponseText);
  }

  // start animaion
  animateResponseText();

  const finish = () => {
    if (!finished) {
      if (!running && runTools.length > 0) {
        const toolCallMessage = {
          role: "assistant",
          tool_calls: [...runTools],
        };
        running = true;
        runTools.splice(0, runTools.length); // empty runTools
        return Promise.all(
          toolCallMessage.tool_calls.map((tool) => {
            options?.onBeforeTool?.(tool);
            return Promise.resolve(
              // @ts-ignore
              funcs[tool.function.name](
                // @ts-ignore
                tool?.function?.arguments
                  ? JSON.parse(tool?.function?.arguments)
                  : {},
              ),
            )
              .then((res) => {
                let content = res.data || res?.statusText;
                // hotfix #5614
                content =
                  typeof content === "string"
                    ? content
                    : JSON.stringify(content);
                if (res.status >= 300) {
                  return Promise.reject(content);
                }
                return content;
              })
              .then((content) => {
                options?.onAfterTool?.({
                  ...tool,
                  content,
                  isError: false,
                });
                return content;
              })
              .catch((e) => {
                options?.onAfterTool?.({
                  ...tool,
                  isError: true,
                  errorMsg: e.toString(),
                });
                return e.toString();
              })
              .then((content) => ({
                name: tool.function.name,
                role: "tool",
                content,
                tool_call_id: tool.id,
              }));
          }),
        ).then((toolCallResult) => {
          processToolMessage(requestPayload, toolCallMessage, toolCallResult);
          setTimeout(() => {
            // call again
            console.debug("[ChatAPI] restart");
            running = false;
            chatApi(chatPath, headers, requestPayload, tools); // call fetchEventSource
          }, 60);
        });
        return;
      }
      if (running) {
        return;
      }
      console.debug("[ChatAPI] end");
      finished = true;
      options.onFinish(responseText + remainText, responseRes);
    }
  };

  controller.signal.onabort = finish;

  function chatApi(
    chatPath: string,
    headers: any,
    requestPayload: any,
    tools: any,
  ) {
    const chatPayload = {
      method: "POST",
      body: JSON.stringify({
        ...requestPayload,
        tools: tools && tools.length ? tools : undefined,
      }),
      signal: controller.signal,
      headers,
    };
    const requestTimeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );
    fetchEventSource(chatPath, {
      fetch: tauriFetch as any,
      ...chatPayload,
      async onopen(res) {
        clearTimeout(requestTimeoutId);
        const contentType = res.headers.get("content-type");
        console.log("[Request] response content type: ", contentType);
        responseRes = res;

        if (contentType?.startsWith("text/plain")) {
          responseText = await res.clone().text();
          return finish();
        }

        if (
          !res.ok ||
          !res.headers
            .get("content-type")
            ?.startsWith(EventStreamContentType) ||
          res.status !== 200
        ) {
          const responseTexts = [responseText];
          let extraInfo = await res.clone().text();
          try {
            const resJson = await res.clone().json();
            extraInfo = prettyObject(resJson);
          } catch {}

          if (res.status === 401) {
            responseTexts.push(Locale.Error.Unauthorized);
          }

          if (extraInfo) {
            responseTexts.push(extraInfo);
          }

          responseText = responseTexts.join("\n\n");

          return finish();
        }
      },
      onmessage(msg) {
        if (msg.data === "[DONE]" || finished) {
          return finish();
        }
        const text = msg.data;
        // Skip empty messages
        if (!text || text.trim().length === 0) {
          return;
        }
        try {
          const chunk = parseSSE(text, runTools);
          if (!!chunk.shouldRecall) {
            responseText = "👀 让我们换个话题聊聊吧";
          }
          if (chunk.search_indexes) {
            options.onUpdateSearchIndexes?.(chunk.search_indexes);
          }
          if (chunk.search_results) {
            const getCircledNumber = (num: number): string => {
              return num <= 20
                ? String.fromCharCode(0x2776 + num - 1)
                : `(${num})`;
            };

            const customFormatUnix = (timestamp: number): string => {
              const unixToDate = (timestamp: number): Date => {
                return new Date(timestamp); // Convert seconds to milliseconds
              };
              const date = unixToDate(timestamp);
              return (
                `${date.getFullYear()}-${(date.getMonth() + 1)
                  .toString()
                  .padStart(2, "0")}-${date
                  .getDate()
                  .toString()
                  .padStart(2, "0")} ` +
                `${date.getHours().toString().padStart(2, "0")}:${date
                  .getMinutes()
                  .toString()
                  .padStart(2, "0")}:${date
                  .getSeconds()
                  .toString()
                  .padStart(2, "0")}`
              );
            };

            const formatMarkdownLink = (
              result: SearchResultEntry,
              index: number,
            ): string =>
              `${getCircledNumber(index + 1)} [${result.title}](${
                result.url
              }) ${customFormatUnix(result.published_at)}\n> ${
                result.snippet
              }\n`;

            remainTextSearch = chunk.search_results
              .map(formatMarkdownLink)
              .join("\n");
          }
          // Skip if content is empty
          if (!chunk?.content || chunk.content.length === 0) {
            return;
          }

          // Check if thinking mode changed
          const isThinkingChanged = lastIsThinking !== chunk.isThinking;
          lastIsThinking = chunk.isThinking;

          if (chunk.content.startsWith("⚠️ Search Failed")) {
            console.log("[Request] Search Failed");
            options.onUpdateSearch?.(chunk.content, chunk.content);
            chunk.content = "";
          }

          if (chunk.isThinking) {
            // If in thinking mode
            if (!isInThinkingMode || isThinkingChanged) {
              isInThinkingMode = true;
            }
            remainTextThinking += chunk.content;
          } else {
            // If in normal mode
            if (isInThinkingMode || isThinkingChanged) {
              // If switching from thinking mode to normal mode
              isInThinkingMode = false;
            }
            remainText += chunk.content;
          }
        } catch (e) {
          console.error("[Request] parse error", text, msg, e);
          // Don't throw error for parse failures, just log them
        }
      },
      onclose() {
        finish();
      },
      onerror(e) {
        options?.onError?.(e);
        throw e;
      },
      openWhenHidden: true,
    });
  }
  console.debug("[ChatAPI] start");
  chatApi(chatPath, headers, requestPayload, tools); // call fetchEventSource
}
