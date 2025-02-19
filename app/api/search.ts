import axios, { AxiosInstance } from "axios";
import { format } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";

interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  publishedAt: string;
  siteName: string;
  siteIcon: string;
}

interface SearchResponse {
  data: {
    webPages: {
      value: Array<{
        url: string;
        name: string;
        summary: string;
        dateLastCrawled: string;
        siteName: string;
        siteIcon: string;
      }>;
    };
  };
  code: number;
  msg?: string;
}

const formatSearchResult = (result: SearchResult, index: number): string => {
  return (
    `[webpage ${index} begin]\n` +
    `URL: ${result.url}\n` +
    `title: ${result.title}\n` +
    `snippet: ${result.snippet}\n` +
    `published_at: ${result.publishedAt}\n` +
    `site_name: ${result.siteName}\n` +
    `site_icon: ${result.siteIcon}\n` +
    `[webpage ${index} end]`
  );
};

const formatSearchResultMarkdown = (
  result: SearchResult,
  index: number,
): string => {
  const getCircledNumber = (num: number): string => {
    if (num >= 1 && num <= 20) {
      return String.fromCharCode(0x2460 + num - 1); // Unicode ①~⑳
    }
    return `(${num})`; // Fallback for numbers >20
  };

  const circled = getCircledNumber(index + 1);
  return `[${circled} ${result.title}](${result.url})`;
};

type WebSearchResult = { search_results: string[]; markdown: string };
const createWebSearch = () => {
  const config = {
    apiUrl: process.env.SILICON_CHAT_SEARCH_ENDPOINT,
    apiKey: process.env.SILICON_CHAT_SEARCH_API_KEY,
  };
  if (!config.apiUrl || !config.apiKey) {
    throw new Error("Missing required environment variables for web search");
  }
  let session: AxiosInstance | null = null;

  const createSession = () => {
    session = axios.create({
      baseURL: config.apiUrl,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
    });
    return session;
  };

  const search = async (
    query: string,
    count: number = 5,
  ): Promise<SearchResult[]> => {
    try {
      if (!session) createSession();

      const response = await session!.post<SearchResponse>("", {
        query,
        freshness: "oneWeek",
        summary: true,
        count,
      });

      if (response.data.code !== 200 || !response.data.data?.webPages?.value) {
        throw new Error(response.data.msg || "Unknown error");
      }

      return response.data.data.webPages.value.map((page) => ({
        url: page.url,
        title: page.name,
        snippet: page.summary,
        publishedAt: page.dateLastCrawled,
        siteName: page.siteName,
        siteIcon: page.siteIcon,
      }));
    } catch (error) {
      throw new Error(
        `Search failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  const formatResults = (results: SearchResult[]): WebSearchResult => ({
    search_results: results.map((result, index) =>
      formatSearchResult(result, index + 1),
    ),
    markdown: results
      .map((result, index) => formatSearchResultMarkdown(result, index))
      .join("\n"),
  });

  const generateAnswer = (
    query: string,
    searchResults: SearchResult[],
    isChinese: boolean,
  ): string => {
    const formattedResults = JSON.stringify(
      formatResults(searchResults),
      null,
      2,
    );
    const currentDate = format(new Date(), "yyyy年MM月dd日", {
      locale: isChinese ? zhCN : enUS,
    });

    return isChinese
      ? `${formattedResults}\n当前日期：${currentDate}\n问题：${query}`
      : `${formattedResults}\nCurrent Date: ${currentDate}\nQuestion: ${query}`;
  };

  const closeSession = async () => {
    if (session) {
      // Axios doesn't require explicit closing, but reset the instance
      session = null;
    }
  };

  return {
    search,
    formatResults,
    generateAnswer,
    closeSession,
  };
};

export const WebSearchTool = async (
  query: string,
): Promise<WebSearchResult> => {
  const searcher = createWebSearch();
  try {
    const results = await searcher.search(query);
    return searcher.formatResults(results);
  } finally {
    await searcher.closeSession();
  }
};
