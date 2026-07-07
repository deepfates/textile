import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";

import type { ModelId, ModelConfig } from "../../../shared/models";
import type { ModelSortOption, Screen } from "../types";
import type { MenuParams } from "./useMenuSystem";
import { useModels } from "./useModels";
import type {
  ModelEditorField,
  ModelFormState,
} from "../components/ModelEditor";

const createEmptyModelForm = (): ModelFormState => ({
  id: "" as ModelId | "",
  name: "",
  maxTokens: 1024,
  defaultTemp: 0.7,
});

interface UseModelCatalogArgs {
  currentModelId: ModelId;
  setMenuParams: React.Dispatch<React.SetStateAction<MenuParams>>;
  setScreen: React.Dispatch<React.SetStateAction<Screen>>;
  setDrawerTab: (tab: "settings" | "models" | "stories") => void;
  setExpandedModel: React.Dispatch<
    React.SetStateAction<ModelId | "__new__" | null>
  >;
  selectedModelIndex: number;
  setSelectedModelIndex: React.Dispatch<React.SetStateAction<number>>;
  selectedModelField: number;
  setSelectedModelField: React.Dispatch<React.SetStateAction<number>>;
}

export function useModelCatalog({
  currentModelId,
  setMenuParams,
  setScreen,
  setDrawerTab,
  setExpandedModel,
  selectedModelIndex,
  setSelectedModelIndex,
  selectedModelField,
  setSelectedModelField,
}: UseModelCatalogArgs) {
  const {
    models,
    loading: modelsLoading,
    error: modelsError,
    saving: modelsSaving,
    createModel,
    updateModel,
    deleteModel,
    getModelName,
  } = useModels();

  const [modelSort, setModelSort] = useState<ModelSortOption>("name-asc");
  const [modelForm, setModelForm] = useState<ModelFormState>(() =>
    createEmptyModelForm(),
  );
  const [modelEditorMode, setModelEditorMode] = useState<"create" | "edit">(
    "create",
  );
  const [editingModelId, setEditingModelId] = useState<ModelId | null>(null);
  const [modelFormError, setModelFormError] = useState<string | null>(null);
  const [pendingModelSelection, setPendingModelSelection] =
    useState<ModelId | null>(null);

  const sortedModelEntries = useMemo(() => {
    if (!models) return [] as Array<[ModelId, ModelConfig]>;
    const entries = Object.entries(models) as Array<[ModelId, ModelConfig]>;
    return [...entries].sort((a, b) => {
      const nameA = a[1].name.toLowerCase();
      const nameB = b[1].name.toLowerCase();
      const compare = nameA.localeCompare(nameB);
      return modelSort === "name-desc" ? -compare : compare;
    });
  }, [models, modelSort]);

  const modelOrder = useMemo(
    () => sortedModelEntries.map(([modelId]) => modelId),
    [sortedModelEntries],
  );

  const modelEditorFields = useMemo<ModelEditorField[]>(() => {
    const base: ModelEditorField[] = [
      "id",
      "name",
      "maxTokens",
      "defaultTemp",
      "save",
      "cancel",
    ];

    return modelEditorMode === "edit" ? [...base, "delete"] : base;
  }, [modelEditorMode]);

  const currentModelEditorField =
    modelEditorFields[selectedModelField] ?? modelEditorFields[0] ?? "id";

  const cycleModelSort = useCallback((_delta: -1 | 1 = 1) => {
    setModelSort((prev) => (prev === "name-asc" ? "name-desc" : "name-asc"));
  }, []);

  const handleModelFormChange = useCallback(
    <Key extends keyof ModelFormState>(
      field: Key,
      value: ModelFormState[Key],
    ) => {
      setModelForm((prev) => ({
        ...prev,
        [field]: value,
      }));
    },
    [],
  );

  const handleStartNewModel = useCallback(() => {
    setModelEditorMode("create");
    setEditingModelId(null);
    setModelForm(createEmptyModelForm());
    setModelFormError(null);
    setSelectedModelField(0);
    setScreen("drawer");
    setDrawerTab("models");
    setExpandedModel("__new__");
  }, [setDrawerTab, setExpandedModel, setScreen, setSelectedModelField]);

  const handleEditModel = useCallback(
    (modelId: ModelId) => {
      const config = models?.[modelId];
      if (!config) return;
      setModelEditorMode("edit");
      setEditingModelId(modelId);
      setModelForm({
        id: modelId,
        name: config.name,
        maxTokens: config.maxTokens,
        defaultTemp: config.defaultTemp,
      });
      setModelFormError(null);
      setSelectedModelField(0);
      setScreen("drawer");
      setDrawerTab("models");
      setExpandedModel(modelId);
    },
    [models, setDrawerTab, setExpandedModel, setScreen, setSelectedModelField],
  );

  const showModelsMenu = useCallback(
    (focusModelId?: ModelId | null) => {
      const targetId =
        focusModelId ??
        (models && models[currentModelId] ? currentModelId : modelOrder[0]);
      if (targetId) {
        const index = modelOrder.indexOf(targetId);
        if (index >= 0) {
          setSelectedModelIndex(index + 2);
        }
      } else {
        setSelectedModelIndex(1);
      }
      setModelFormError(null);
      setScreen("drawer");
      setDrawerTab("models");
      setExpandedModel(null);
    },
    [
      currentModelId,
      modelOrder,
      models,
      setDrawerTab,
      setExpandedModel,
      setScreen,
      setSelectedModelIndex,
    ],
  );

  const handleCancelModelEdit = useCallback(() => {
    if (
      modelEditorMode === "edit" &&
      editingModelId &&
      models?.[editingModelId]
    ) {
      const config = models[editingModelId];
      setModelForm({
        id: editingModelId,
        name: config.name,
        maxTokens: config.maxTokens,
        defaultTemp: config.defaultTemp,
      });
    } else {
      setModelForm(createEmptyModelForm());
      setEditingModelId(null);
      setModelEditorMode("create");
    }
    setModelFormError(null);
    showModelsMenu(editingModelId);
  }, [editingModelId, modelEditorMode, models, showModelsMenu]);

  const handleModelEditorHighlight = useCallback(
    (field: ModelEditorField) => {
      const index = modelEditorFields.indexOf(field);
      if (index >= 0) {
        setSelectedModelField(index);
      }
    },
    [modelEditorFields, setSelectedModelField],
  );

  const handleDeleteModel = useCallback(
    async (modelId: ModelId) => {
      const totalModels = models ? Object.keys(models).length : 0;
      if (totalModels <= 1) {
        setModelFormError("At least one model must remain.");
        return;
      }

      const modelName = models?.[modelId]?.name ?? modelId;
      if (!window.confirm(`Delete model "${modelName}"?`)) {
        return;
      }

      try {
        const updated = await deleteModel(modelId);
        setModelFormError(null);

        if (currentModelId === modelId) {
          const remainingIds = Object.keys(updated) as ModelId[];
          if (remainingIds.length > 0) {
            setMenuParams((prev) => ({ ...prev, model: remainingIds[0] }));
          }
        }

        if (editingModelId === modelId) {
          const remainingEntries = Object.entries(updated) as Array<
            [ModelId, ModelConfig]
          >;
          if (remainingEntries.length > 0) {
            const [firstId, config] = remainingEntries[0];
            setEditingModelId(firstId);
            setModelEditorMode("edit");
            setModelForm({
              id: firstId,
              name: config.name,
              maxTokens: config.maxTokens,
              defaultTemp: config.defaultTemp,
            });
            setPendingModelSelection(firstId);
            setSelectedModelField(0);
          } else {
            setEditingModelId(null);
            setModelEditorMode("create");
            setModelForm(createEmptyModelForm());
            setSelectedModelField(0);
          }
        }
      } catch (err) {
        setModelFormError(
          err instanceof Error ? err.message : "Failed to delete model",
        );
      }
    },
    [
      currentModelId,
      deleteModel,
      editingModelId,
      models,
      setMenuParams,
      setSelectedModelField,
    ],
  );

  const handleSubmitModel = useCallback(async () => {
    const trimmedId = `${modelForm.id ?? ""}`.trim();
    const trimmedName = modelForm.name.trim();
    if (!trimmedId) {
      setModelFormError("Model ID is required.");
      return;
    }
    if (!trimmedName) {
      setModelFormError("Model name is required.");
      return;
    }
    if (!Number.isFinite(modelForm.maxTokens) || modelForm.maxTokens <= 0) {
      setModelFormError("Max tokens must be greater than 0.");
      return;
    }
    if (
      Number.isNaN(modelForm.defaultTemp) ||
      modelForm.defaultTemp < 0 ||
      modelForm.defaultTemp > 2
    ) {
      setModelFormError("Default temperature must be between 0 and 2.");
      return;
    }

    try {
      let nextFocusId: ModelId | null = null;
      if (modelEditorMode === "create") {
        const newId = trimmedId as ModelId;
        await createModel(newId, {
          name: trimmedName,
          maxTokens: modelForm.maxTokens,
          defaultTemp: modelForm.defaultTemp,
        });
        setModelEditorMode("edit");
        setEditingModelId(newId);
        setModelForm({
          id: newId,
          name: trimmedName,
          maxTokens: modelForm.maxTokens,
          defaultTemp: modelForm.defaultTemp,
        });
        setPendingModelSelection(newId);
        setMenuParams((prev) => ({ ...prev, model: newId }));
        nextFocusId = newId;
      } else if (editingModelId) {
        await updateModel(editingModelId, {
          name: trimmedName,
          maxTokens: modelForm.maxTokens,
          defaultTemp: modelForm.defaultTemp,
        });
        setModelForm({
          id: editingModelId,
          name: trimmedName,
          maxTokens: modelForm.maxTokens,
          defaultTemp: modelForm.defaultTemp,
        });
        setPendingModelSelection(editingModelId);
        nextFocusId = editingModelId;
      }
      setModelFormError(null);
      showModelsMenu(nextFocusId);
    } catch (err) {
      setModelFormError(
        err instanceof Error ? err.message : "Failed to save model",
      );
    }
  }, [
    createModel,
    editingModelId,
    modelEditorMode,
    modelForm,
    setMenuParams,
    showModelsMenu,
    updateModel,
  ]);

  const handleModelEditorAdjust = useCallback(
    (field: ModelEditorField, delta: number) => {
      if (field === "maxTokens") {
        setModelForm((prev) => ({
          ...prev,
          maxTokens: Math.max(1, prev.maxTokens + delta * 64),
        }));
        setModelFormError(null);
      } else if (field === "defaultTemp") {
        setModelForm((prev) => ({
          ...prev,
          defaultTemp: Math.max(
            0,
            Math.min(2, Number((prev.defaultTemp + delta * 0.1).toFixed(1))),
          ),
        }));
        setModelFormError(null);
      }
    },
    [],
  );

  const handleModelEditorActivate = useCallback(
    (field: ModelEditorField) => {
      switch (field) {
        case "id": {
          if (modelEditorMode === "edit") return;
          const input = window.prompt(
            "Model ID",
            `${modelForm.id ?? "provider/model"}`.trim(),
          );
          if (input === null) return;
          const trimmed = input.trim();
          setModelForm((prev) => ({
            ...prev,
            id: (trimmed as ModelId | "") ?? ("" as ModelId | ""),
          }));
          setModelFormError(null);
          break;
        }
        case "name": {
          const input = window.prompt("Display Name", modelForm.name.trim());
          if (input === null) return;
          setModelForm((prev) => ({ ...prev, name: input.trim() }));
          setModelFormError(null);
          break;
        }
        case "maxTokens": {
          const input = window.prompt("Max Tokens", `${modelForm.maxTokens}`);
          if (input === null) return;
          const parsed = Number.parseInt(input, 10);
          if (!Number.isNaN(parsed) && parsed > 0) {
            setModelForm((prev) => ({ ...prev, maxTokens: parsed }));
            setModelFormError(null);
          } else {
            setModelFormError("Max tokens must be a positive number.");
          }
          break;
        }
        case "defaultTemp": {
          const input = window.prompt(
            "Default Temperature",
            modelForm.defaultTemp.toFixed(1),
          );
          if (input === null) return;
          const parsed = Number.parseFloat(input);
          if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 2) {
            setModelForm((prev) => ({
              ...prev,
              defaultTemp: Number(parsed.toFixed(1)),
            }));
            setModelFormError(null);
          } else {
            setModelFormError("Temperature must be between 0 and 2.");
          }
          break;
        }
        case "save":
          void handleSubmitModel();
          break;
        case "cancel":
          handleCancelModelEdit();
          break;
        case "delete":
          if (editingModelId) void handleDeleteModel(editingModelId);
          break;
      }
    },
    [
      editingModelId,
      handleCancelModelEdit,
      handleDeleteModel,
      handleSubmitModel,
      modelEditorMode,
      modelForm.defaultTemp,
      modelForm.id,
      modelForm.maxTokens,
      modelForm.name,
    ],
  );

  const navigateModelsList = useCallback(
    (key: string, scrollCurrentMenuItemIntoView: (index: number) => void) => {
      const baseOffset = 2;
      const totalItems = modelOrder.length + baseOffset;
      switch (key) {
        case "ArrowUp":
        case "ArrowDown": {
          const delta = key === "ArrowUp" ? -1 : 1;
          setSelectedModelIndex((prev) => {
            const n = (prev + delta + totalItems) % totalItems;
            scrollCurrentMenuItemIntoView(n);
            return n;
          });
          return;
        }
        case "ArrowLeft":
          if (selectedModelIndex === 0) cycleModelSort(-1);
          return;
        case "ArrowRight":
          if (selectedModelIndex === 0) cycleModelSort(1);
          return;
        case "Enter": {
          if (selectedModelIndex === 0) {
            cycleModelSort(1);
          } else if (selectedModelIndex === 1) {
            handleStartNewModel();
          } else {
            const modelId = modelOrder[selectedModelIndex - baseOffset];
            if (modelId) handleEditModel(modelId);
          }
          return;
        }
        case "Backspace": {
          if (selectedModelIndex >= baseOffset) {
            const modelId = modelOrder[selectedModelIndex - baseOffset];
            if (modelId) void handleDeleteModel(modelId);
          }
          return;
        }
      }
    },
    [
      cycleModelSort,
      handleDeleteModel,
      handleEditModel,
      handleStartNewModel,
      modelOrder,
      selectedModelIndex,
      setSelectedModelIndex,
    ],
  );

  const navigateModelEditor = useCallback(
    (key: string) => {
      const total = modelEditorFields.length;
      if (!total) return;
      switch (key) {
        case "ArrowUp":
        case "ArrowDown": {
          const delta = key === "ArrowUp" ? -1 : 1;
          setSelectedModelField((prev) => {
            const n = (prev + delta + total) % total;
            handleModelEditorHighlight(modelEditorFields[n]);
            return n;
          });
          return;
        }
        case "ArrowLeft":
          handleModelEditorAdjust(modelEditorFields[selectedModelField], -1);
          return;
        case "ArrowRight":
          handleModelEditorAdjust(modelEditorFields[selectedModelField], 1);
          return;
        case "Enter":
          handleModelEditorActivate(modelEditorFields[selectedModelField]);
          return;
        case "Backspace":
          handleCancelModelEdit();
          return;
      }
    },
    [
      handleCancelModelEdit,
      handleModelEditorActivate,
      handleModelEditorAdjust,
      handleModelEditorHighlight,
      modelEditorFields,
      selectedModelField,
      setSelectedModelField,
    ],
  );

  useEffect(() => {
    const total = modelOrder.length + 2;
    setSelectedModelIndex((prev) => {
      const maxIndex = Math.max(0, total - 1);
      return prev > maxIndex ? maxIndex : prev;
    });
  }, [modelOrder, setSelectedModelIndex]);

  useEffect(() => {
    if (selectedModelField >= modelEditorFields.length) {
      setSelectedModelField(0);
    }
  }, [modelEditorFields, selectedModelField, setSelectedModelField]);

  useEffect(() => {
    if (!pendingModelSelection) return;
    const index = modelOrder.indexOf(pendingModelSelection);
    if (index >= 0) {
      setSelectedModelIndex(index + 2);
    }
    setPendingModelSelection(null);
  }, [modelOrder, pendingModelSelection, setSelectedModelIndex]);

  useEffect(() => {
    if (!editingModelId) return;
    const index = modelOrder.indexOf(editingModelId);
    if (index >= 0) {
      setSelectedModelIndex((prev) => (prev === index + 2 ? prev : index + 2));
    }
  }, [editingModelId, modelOrder, setSelectedModelIndex]);

  useEffect(() => {
    if (!models) return;
    if (editingModelId && !models[editingModelId]) {
      const fallbackId = modelOrder[0];
      if (fallbackId) {
        handleEditModel(fallbackId);
        const index = modelOrder.indexOf(fallbackId);
        if (index >= 0) {
          setSelectedModelIndex(index + 2);
        }
      } else {
        handleStartNewModel();
      }
    }
  }, [
    editingModelId,
    handleEditModel,
    handleStartNewModel,
    modelOrder,
    models,
    setSelectedModelIndex,
  ]);

  useEffect(() => {
    if (!models) return;
    if (!models[currentModelId]) {
      const fallbackId = modelOrder[0];
      if (fallbackId) {
        setMenuParams((prev) => ({ ...prev, model: fallbackId }));
      }
    }
  }, [currentModelId, modelOrder, models, setMenuParams]);

  return {
    models,
    modelsLoading,
    modelsError,
    modelsSaving,
    getModelName,
    modelSort,
    sortedModelEntries,
    modelOrder,
    modelForm,
    modelEditorMode,
    editingModelId,
    modelFormError,
    modelEditorFields,
    currentModelEditorField,
    cycleModelSort,
    handleModelFormChange,
    handleStartNewModel,
    handleEditModel,
    handleCancelModelEdit,
    handleDeleteModel,
    handleSubmitModel,
    handleModelEditorHighlight,
    handleModelEditorActivate,
    navigateModelsList,
    navigateModelEditor,
  };
}
