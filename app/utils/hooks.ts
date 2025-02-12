import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { collectModelsWithDefaultModel } from "./model";
import { SiliconFlow } from "../constant";

export function useAllModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const models = useMemo(() => {
    return collectModelsWithDefaultModel(
      configStore.models,
      [configStore.customModels, accessStore.customModels].join(","),
      accessStore.defaultModel,
    );
  }, [
    accessStore.customModels,
    accessStore.defaultModel,
    configStore.customModels,
    configStore.models,
  ]);

  return models
    .filter((m) => m.provider?.id === "siliconflow")
    .filter((m) => {
      return (
        (m.name.toLowerCase().includes("deepseek") &&
          !m.name.toLowerCase().includes("distill") &&
          (m.name.toLowerCase().includes("r1") ||
            m.name.toLowerCase().includes("v3"))) ||
        SiliconFlow.SummaryModels.includes(m.name)
      );
    });
}
