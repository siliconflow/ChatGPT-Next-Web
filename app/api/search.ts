import axios from "axios";
import { format } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import {
  SearchIndexDelta,
  SearchIndexDeltaExample,
  SearchQueryDelta,
  SearchQueryDeltaExample,
  SearchResultDelta,
  SearchResultDeltaExample,
} from "../search_templates";

interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  publishedAt: string;
  siteName: string;
  siteIcon: string;
}

export type WebSearchResult = {
  search_results: string[];
  deltas: {
    index: SearchIndexDelta;
    result: SearchResultDelta;
    query: SearchQueryDelta;
  };
};

const formatSearchResult = (result: SearchResult, index: number): string =>
  `[webpage ${index} begin]\n` +
  `URL: ${result.url}\n` +
  `title: ${result.title}\n` +
  `snippet: ${result.snippet}\n` +
  `published_at: ${result.publishedAt}\n` +
  `site_name: ${result.siteName}\n` +
  `site_icon: ${result.siteIcon}\n` +
  `[webpage ${index} end]`;

const responseExample = {
  code: 200,
  log_id: "d71841ad20095f61",
  msg: null,
  data: {
    _type: "SearchResponse",
    queryContext: {
      originalQuery: "阿里巴巴2024年的esg报告",
    },
    webPages: {
      webSearchUrl: "",
      totalEstimatedMatches: 8912791,
      value: [
        {
          id: null,
          name: "阿里巴巴发布2024年ESG报告　持续推进减碳与数字化普惠",
          url: "https://www.alibabagroup.com/document-1752073403914780672",
          displayUrl:
            "https://www.alibabagroup.com/document-1752073403914780672",
          snippet:
            "阿里巴巴集团发布《2024财年环境、社会和治理（ESG）报告》（下称“报告”），详细分享过去一年在ESG各方面取得的进展。报告显示，阿里巴巴扎实推进减碳举措，全集团自身运营净碳排放和价值链碳...",
          siteName: "www.alibabagroup.com",
          siteIcon:
            "https://th.bochaai.com/favicon?domain_url=https://www.alibabagroup.com/document-1752073403914780672",
          dateLastCrawled: "2024-07-22T00:00:00Z",
          cachedPageUrl: null,
          language: null,
          isFamilyFriendly: null,
          isNavigational: null,
        },
      ],
      someResultsRemoved: true,
    },
    images: {
      id: null,
      readLink: null,
      webSearchUrl: null,
      value: [
        {
          webSearchUrl: null,
          name: null,
          thumbnailUrl:
            "http://dayu-img.uc.cn/columbus/img/oc/1002/45628755e2db09ccf7e6ea3bf22ad2b0.jpg",
          datePublished: null,
          contentUrl:
            "http://dayu-img.uc.cn/columbus/img/oc/1002/45628755e2db09ccf7e6ea3bf22ad2b0.jpg",
          hostPageUrl:
            "https://mparticle.uc.cn/article_org.html?uc_param_str=frdnsnpfvecpntnwprdssskt#!wm_cid=632457937121448960!!wm_id=b3f0578cbbd8434da8e437702e399f91",
          contentSize: null,
          encodingFormat: null,
          hostPageDisplayUrl:
            "https://mparticle.uc.cn/article_org.html?uc_param_str=frdnsnpfvecpntnwprdssskt#!wm_cid=632457937121448960!!wm_id=b3f0578cbbd8434da8e437702e399f91",
          width: 553,
          height: 311,
          thumbnail: null,
        },
        {
          webSearchUrl: null,
          name: null,
          thumbnailUrl:
            "http://image.uczzd.cn/15500294364735623464.jpg?id=0&from=export",
          datePublished: null,
          contentUrl:
            "http://image.uczzd.cn/15500294364735623464.jpg?id=0&from=export",
          hostPageUrl:
            "https://mparticle.uc.cn/article_org.html?uc_param_str=frdnsnpfvecpntnwprdssskt#!wm_cid=632457937121448960!!wm_id=b3f0578cbbd8434da8e437702e399f91",
          contentSize: null,
          encodingFormat: null,
          hostPageDisplayUrl:
            "https://mparticle.uc.cn/article_org.html?uc_param_str=frdnsnpfvecpntnwprdssskt#!wm_cid=632457937121448960!!wm_id=b3f0578cbbd8434da8e437702e399f91",
          width: 0,
          height: 0,
          thumbnail: null,
        },
      ],
      isFamilyFriendly: null,
    },
    videos: null,
  },
};
export const WebSearchTool = async (
  query: string,
): Promise<WebSearchResult> => {
  const apiUrl = process.env.SILICON_CHAT_SEARCH_ENDPOINT;
  const apiKey = process.env.SILICON_CHAT_SEARCH_API_KEY;

  if (!apiUrl || !apiKey) throw new Error("Missing search API configuration");

  try {
    const response = await axios.post(
      apiUrl,
      {
        query: query.length <= 2 ? `${query}  ` : query,
        freshness: "oneWeek",
        summary: true,
        count: 10,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 5000,
      },
    );

    const results: SearchResult[] =
      response.data.data?.webPages?.value?.map((page: any) => ({
        url: page.url,
        title: page.name,
        snippet: page.summary,
        publishedAt: page.dateLastCrawled,
        siteName: page.siteName,
        siteIcon: page.siteIcon,
      })) || [];

    const values =
      (response.data.data as typeof responseExample.data).webPages?.value || [];
    return {
      search_results: results.map((result, i) =>
        formatSearchResult(result, i + 1),
      ),
      deltas: {
        query: {
          ...SearchQueryDeltaExample,
          search_queries: ["QUERY PLACEHOLDER"],
        },
        result: {
          ...SearchResultDeltaExample,
          search_results: results.map((result) => ({
            url: result.url,
            title: result.title,
            snippet: result.snippet,
            published_at: new Date(result.publishedAt).getTime(),
            site_name: result.siteName,
            site_icon: result.siteIcon,
          })),
        },
        index: {
          ...SearchIndexDeltaExample,
          search_indexes: values.map((page: any, i: number) => ({
            url: page.url,
            cite_index: i + 1,
          })),
        },
      },
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      // Server responded with error status (4xx/5xx)
      const serverResponse = error.response?.data || "No response body";
      const statusCode = error.response?.status || "No status code";

      console.error("Server Error:", {
        status: statusCode,
        response: serverResponse,
        headers: error.response?.headers,
      });

      throw new Error(
        `Search failed [${statusCode}]: ${JSON.stringify(serverResponse)}`,
      );
    } else {
      throw new Error(
        `Search failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
};

// Helper function kept separate for clarity
export const formatAnswer = (query: string, isChinese: boolean): string => {
  const currentDate = format(new Date(), "yyyy年MM月dd日", {
    locale: isChinese ? zhCN : enUS,
  });
  return isChinese
    ? `当前日期：${currentDate}\n问题：${query}`
    : `Current Date: ${currentDate}\nQuestion: ${query}`;
};
